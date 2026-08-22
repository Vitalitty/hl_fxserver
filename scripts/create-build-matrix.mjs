import { appendFileSync, readFileSync } from 'node:fs';

const statePath = process.argv[2] || 'data/fxserver-versions.json';
const rawImage = process.env.IMAGE;

if (!rawImage) {
  throw new Error('IMAGE environment variable is required');
}

const image = rawImage.toLowerCase();
const state = JSON.parse(readFileSync(statePath, 'utf8'));

if (!state.latest || !state.recommended) {
  throw new Error('Version state must contain latest and recommended channels');
}

const buildsByUrl = new Map();

function addChannel(channel, artifact, tags) {
  if (!artifact) {
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
addChannel('recommended', state.recommended, ['recommended']);
addChannel('optional', state.optional, ['optional']);

const matrix = {
  include: [...buildsByUrl.values()].map((build) => ({
    channel: build.channels.join(','),
    url: build.url,
    tags: [...build.tags].join('\n'),
  })),
};

const serialized = JSON.stringify(matrix);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${serialized}\n`);
}

console.log(serialized);
