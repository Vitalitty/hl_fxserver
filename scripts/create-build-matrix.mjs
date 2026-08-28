import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const isTrue = (value) => value === true || value === 'true';

export function selectChannels({
  publishAll = false,
  latestChanged = false,
  recommendedChanged = false,
  optionalChanged = false,
} = {}) {
  const all = isTrue(publishAll);
  return {
    latest: all || isTrue(latestChanged),
    recommended: all || isTrue(recommendedChanged),
    optional: all || isTrue(optionalChanged),
  };
}

export function createBuildMatrix(state, rawImage, selectedChannels) {
  if (!rawImage) {
    throw new Error('IMAGE environment variable is required');
  }
  if (!state.latest || !state.recommended) {
    throw new Error('Version state must contain latest and recommended channels');
  }

  const image = rawImage.toLowerCase();
  const buildsByUrl = new Map();

  function addChannel(channel, artifact, tags) {
    if (!artifact || !selectedChannels[channel]) {
      return;
    }

    const build = buildsByUrl.get(artifact.url) || {
      url: artifact.url,
      channels: [],
      tags: new Set(),
    };
    build.channels.push(channel);
    for (const tag of tags) {
      build.tags.add(`${image}:${tag}`);
    }
    buildsByUrl.set(artifact.url, build);
  }

  addChannel('latest', state.latest, [state.latest.version, 'latest']);
  addChannel('recommended', state.recommended, [
    state.recommended.version,
    'recommended',
  ]);
  addChannel('optional', state.optional, ['optional']);

  return {
    include: [...buildsByUrl.values()].map((build) => ({
      channel: build.channels.join(','),
      url: build.url,
      tags: [...build.tags].join('\n'),
    })),
  };
}

function main() {
  const statePath = process.argv[2] || 'data/fxserver-versions.json';
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  const selectedChannels = selectChannels({
    publishAll: process.env.PUBLISH_ALL,
    latestChanged: process.env.LATEST_CHANGED,
    recommendedChanged: process.env.RECOMMENDED_CHANGED,
    optionalChanged: process.env.OPTIONAL_CHANGED,
  });
  const matrix = createBuildMatrix(state, process.env.IMAGE, selectedChannels);

  if (matrix.include.length === 0) {
    throw new Error('No publishable channels were selected');
  }

  const serialized = JSON.stringify(matrix);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${serialized}\n`);
  }
  console.log(serialized);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
