import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { pathToFileURL } from 'node:url';

export const DEFAULT_ARTIFACTS_URL =
  'https://runtime.fivem.net/artifacts/fivem/build_proot_linux/master/';

const ARCHIVE_PATH_PATTERN = /\/(\d+)-([0-9a-f]{40})\/fx\.tar\.xz$/i;

function readAttribute(attributes, name) {
  const match = attributes.match(
    new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'),
  );

  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function decodeAttribute(value) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

function readableText(html) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replaceAll('&nbsp;', ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function artifactFromHref(rawHref, sourceUrl) {
  const source = new URL(sourceUrl);
  const href = decodeAttribute(rawHref);
  const url = new URL(href, source);

  if (url.origin !== source.origin || !url.pathname.startsWith(source.pathname)) {
    return null;
  }

  const match = url.pathname.match(ARCHIVE_PATH_PATTERN);
  if (!match) {
    return null;
  }

  return {
    version: match[1],
    url: url.href,
  };
}

function setLabeledChannel(current, candidate, channel) {
  if (current && current.url !== candidate.url) {
    throw new Error(`Artifact index contains multiple ${channel} builds`);
  }

  return candidate;
}

export function parseArtifactIndex(html, sourceUrl = DEFAULT_ARTIFACTS_URL) {
  const source = new URL(sourceUrl).href;
  const archivesByVersion = new Map();
  let recommended = null;
  let optional = null;

  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = readAttribute(match[1], 'href');
    if (!href) {
      continue;
    }

    const artifact = artifactFromHref(href, source);
    if (!artifact) {
      continue;
    }

    const existing = archivesByVersion.get(artifact.version);
    if (existing && existing.url !== artifact.url) {
      throw new Error(`Artifact index contains conflicting URLs for build ${artifact.version}`);
    }
    archivesByVersion.set(artifact.version, artifact);

    const label = readableText(match[2]);
    if (label.includes('RECOMMENDED')) {
      recommended = setLabeledChannel(recommended, artifact, 'recommended');
    }
    if (label.includes('OPTIONAL')) {
      optional = setLabeledChannel(optional, artifact, 'optional');
    }
  }

  const archives = [...archivesByVersion.values()];
  if (archives.length === 0) {
    throw new Error('Artifact index does not contain any valid FXServer archives');
  }

  const latest = archives.reduce((selected, candidate) =>
    BigInt(candidate.version) > BigInt(selected.version) ? candidate : selected,
  );

  if (!recommended) {
    throw new Error('Artifact index does not identify a recommended FXServer build');
  }

  return {
    source,
    latest,
    recommended,
    optional,
  };
}

function sameChannel(previous, next) {
  if (previous === null || next === null) {
    return previous === next;
  }

  return previous?.version === next?.version && previous?.url === next?.url;
}

export function compareStates(previous, next) {
  const changes = {
    latest: !sameChannel(previous?.latest ?? null, next.latest),
    recommended: !sameChannel(previous?.recommended ?? null, next.recommended),
    optional: !sameChannel(previous?.optional ?? null, next.optional),
  };

  return {
    ...changes,
    changed:
      previous?.source !== next.source ||
      changes.latest ||
      changes.recommended ||
      changes.optional,
  };
}

export function updateDockerfileArtifact(dockerfile, artifactUrl) {
  const argument = /^ARG FXSERVER_ARTIFACT_URL=.*$/m;
  if (!argument.test(dockerfile)) {
    throw new Error('Dockerfile does not define ARG FXSERVER_ARTIFACT_URL');
  }

  return dockerfile.replace(argument, `ARG FXSERVER_ARTIFACT_URL=${artifactUrl}`);
}

function parseArguments(argv) {
  const options = {
    source: process.env.ARTIFACTS_URL || DEFAULT_ARTIFACTS_URL,
    state: 'data/fxserver-versions.json',
    dockerfile: 'Dockerfile',
    html: null,
    write: false,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--write') {
      options.write = true;
    } else if (argument === '--json') {
      options.json = true;
    } else if (['--source', '--state', '--dockerfile', '--html'].includes(argument)) {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${argument} requires a value`);
      }
      options[argument.slice(2)] = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return options;
}

async function loadHtml(options) {
  if (options.html) {
    return readFileSync(options.html, 'utf8');
  }

  const response = await fetch(options.source, {
    headers: {
      'user-agent': 'hl-fxserver-version-checker/1.0',
    },
  });
  if (!response.ok) {
    throw new Error(`Artifact index request failed with HTTP ${response.status}`);
  }

  return response.text();
}

function writeActionsOutputs(state, changes) {
  if (!process.env.GITHUB_OUTPUT) {
    return;
  }

  const values = {
    changed: changes.changed,
    latest_changed: changes.latest,
    recommended_changed: changes.recommended,
    optional_changed: changes.optional,
    latest_version: state.latest.version,
    latest_url: state.latest.url,
    recommended_version: state.recommended.version,
    recommended_url: state.recommended.url,
    optional_version: state.optional?.version ?? '',
    optional_url: state.optional?.url ?? '',
  };

  const output = Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  appendFileSync(process.env.GITHUB_OUTPUT, `${output}\n`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const html = await loadHtml(options);
  const state = parseArtifactIndex(html, options.source);
  const previous = existsSync(options.state)
    ? JSON.parse(readFileSync(options.state, 'utf8'))
    : null;
  const changes = compareStates(previous, state);

  if (options.write && changes.changed) {
    writeFileSync(options.state, `${JSON.stringify(state, null, 2)}\n`);

    const dockerfile = readFileSync(options.dockerfile, 'utf8');
    const updatedDockerfile = updateDockerfileArtifact(dockerfile, state.latest.url);
    if (updatedDockerfile !== dockerfile) {
      writeFileSync(options.dockerfile, updatedDockerfile);
    }
  }

  writeActionsOutputs(state, changes);

  if (options.json) {
    console.log(JSON.stringify({ state, changes }, null, 2));
  } else {
    console.log(
      `latest=${state.latest.version} recommended=${state.recommended.version} optional=${state.optional?.version ?? 'none'} changed=${changes.changed}`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
