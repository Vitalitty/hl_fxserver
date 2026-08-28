import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createBuildMatrix,
  selectChannels,
} from '../scripts/create-build-matrix.mjs';

const image = 'ghcr.io/Owner/Repository';
const state = {
  latest: { version: '300', url: 'https://example.test/300/fx.tar.xz' },
  recommended: { version: '250', url: 'https://example.test/250/fx.tar.xz' },
  optional: { version: '200', url: 'https://example.test/200/fx.tar.xz' },
};

test('selects only changed channels for a scheduled update', () => {
  const selected = selectChannels({ latestChanged: 'true' });
  const matrix = createBuildMatrix(state, image, selected);

  assert.deepEqual(matrix, {
    include: [
      {
        channel: 'latest',
        url: state.latest.url,
        tags: [
          'ghcr.io/owner/repository:300',
          'ghcr.io/owner/repository:latest',
        ].join('\n'),
      },
    ],
  });
});

test('publishes numeric and channel tags for a changed recommended build', () => {
  const selected = selectChannels({ recommendedChanged: true });
  const matrix = createBuildMatrix(state, image, selected);

  assert.equal(matrix.include.length, 1);
  assert.equal(matrix.include[0].channel, 'recommended');
  assert.equal(
    matrix.include[0].tags,
    [
      'ghcr.io/owner/repository:250',
      'ghcr.io/owner/repository:recommended',
    ].join('\n'),
  );
});

test('selects all available channels for a forced publication', () => {
  const selected = selectChannels({ publishAll: 'true' });
  const matrix = createBuildMatrix(state, image, selected);

  assert.deepEqual(
    matrix.include.map((entry) => entry.channel),
    ['latest', 'recommended', 'optional'],
  );
});

test('deduplicates builds and tags when selected channels share an artifact', () => {
  const sharedState = structuredClone(state);
  sharedState.recommended = structuredClone(sharedState.latest);
  const selected = selectChannels({
    latestChanged: true,
    recommendedChanged: true,
  });
  const matrix = createBuildMatrix(sharedState, image, selected);

  assert.equal(matrix.include.length, 1);
  assert.equal(matrix.include[0].channel, 'latest,recommended');
  assert.equal(
    matrix.include[0].tags,
    [
      'ghcr.io/owner/repository:300',
      'ghcr.io/owner/repository:latest',
      'ghcr.io/owner/repository:recommended',
    ].join('\n'),
  );
});
