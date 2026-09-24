import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { pathToFileURL } from 'node:url';

export const DEFAULT_ARTIFACTS_URL =
  'https://docs.fivem.net/docs/server-download/?platform=legacy&os=linux';

export const FXSERVER_ARCHIVES_URL =
  'https://runtime.fivem.net/artifacts/fivem/build_proot_linux/master/';

const ARCHIVE_PATH_PATTERN = /\/(\d+)-([0-9a-f]{40})\/fx\.tar\.xz$/i;
const BUILD_SUBTITLE_PATTERN = /^build\s+(\d+)$/i;

function readAttribute(attributes, name) {
  const match = attributes.match(
    new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'),
  );

  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function artifactFromDownloadUrl(rawUrl) {
  const archiveBase = new URL(FXSERVER_ARCHIVES_URL);
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (
    url.origin !== archiveBase.origin ||
    !url.pathname.startsWith(archiveBase.pathname)
  ) {
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

function artifactFromEntry(entry, channel) {
  if (typeof entry?.downloadURL !== 'string') {
    return null;
  }

  const artifact = artifactFromDownloadUrl(entry.downloadURL);
  if (!artifact) {
    return null;
  }

  const subtitle =
    typeof entry.subtitle === 'string'
      ? entry.subtitle.trim().match(BUILD_SUBTITLE_PATTERN)
      : null;
  if (!subtitle) {
    throw new Error(`${channel} artifact does not have a numeric build subtitle`);
  }
  if (subtitle[1] !== artifact.version) {
    throw new Error(
      `${channel} build subtitle ${subtitle[1]} does not match archive build ${artifact.version}`,
    );
  }

  return artifact;
}

function addArchive(archivesByVersion, artifact) {
  const existing = archivesByVersion.get(artifact.version);
  if (existing && existing.url !== artifact.url) {
    throw new Error(
      `Server Download page contains conflicting URLs for build ${artifact.version}`,
    );
  }

  archivesByVersion.set(artifact.version, artifact);
}

function selectLatest(archivesByVersion, channel) {
  const archives = [...archivesByVersion.values()];
  if (archives.length === 0) {
    throw new Error(`Server Download page does not identify a valid ${channel} build`);
  }

  return archives.reduce((selected, candidate) =>
    BigInt(candidate.version) > BigInt(selected.version) ? candidate : selected,
  );
}

function readNextData(html) {
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (readAttribute(match[1], 'id') === '__NEXT_DATA__') {
      try {
        return JSON.parse(match[2]);
      } catch {
        throw new Error('Server Download page contains invalid __NEXT_DATA__ JSON');
      }
    }
  }

  throw new Error('Server Download page does not contain __NEXT_DATA__');
}

function readChannelArtifacts(legacy, channel) {
  const entries = legacy?.[channel]?.linux;
  const artifactsByVersion = new Map();

  for (const entry of Array.isArray(entries) ? entries : []) {
    const artifact = artifactFromEntry(entry, channel);
    if (artifact) {
      addArchive(artifactsByVersion, artifact);
    }
  }

  return artifactsByVersion;
}

export function parseServerDownloadPage(html, sourceUrl = DEFAULT_ARTIFACTS_URL) {
  const source = new URL(sourceUrl).href;
  const nextData = readNextData(html);
  const legacy = nextData?.props?.pageProps?.legacy;
  const latest = selectLatest(readChannelArtifacts(legacy, 'latest'), 'latest');
  const recommendedArtifacts = readChannelArtifacts(legacy, 'recommended');

  if (recommendedArtifacts.size > 1) {
    throw new Error('Server Download page identifies multiple recommended builds');
  }
  const recommended = selectLatest(recommendedArtifacts, 'recommended');

  return {
    source,
    latest,
    recommended,
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
  };

  return {
    ...changes,
    changed:
      previous?.source !== next.source ||
      changes.latest ||
      changes.recommended,
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
    throw new Error(`Server Download page request failed with HTTP ${response.status}`);
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
    latest_version: state.latest.version,
    latest_url: state.latest.url,
    recommended_version: state.recommended.version,
    recommended_url: state.recommended.url,
  };

  const output = Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  appendFileSync(process.env.GITHUB_OUTPUT, `${output}\n`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const html = await loadHtml(options);
  const state = parseServerDownloadPage(html, options.source);
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
      `latest=${state.latest.version} recommended=${state.recommended.version} changed=${changes.changed}`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
