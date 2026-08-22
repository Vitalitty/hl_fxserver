import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  compareStates,
  parseArtifactIndex,
  updateDockerfileArtifact,
} from '../scripts/check-fxserver-versions.mjs';

const source = 'https://runtime.fivem.net/artifacts/fivem/build_proot_linux/master/';
const hash = (character) => character.repeat(40);
const archive = (version, character) =>
  `./${version}-${hash(character)}/fx.tar.xz`;

test('parses independent latest, recommended, and optional channels', () => {
  const html = readFileSync(
    new URL('./fixtures/separate-channels.html', import.meta.url),
    'utf8',
  );

  const state = parseArtifactIndex(html, source);
  assert.equal(state.latest.version, '103');
  assert.equal(state.recommended.version, '102');
  assert.equal(state.optional.version, '101');
});

test('accepts a combined latest recommended label without optional', () => {
  const html = readFileSync(
    new URL('./fixtures/current.html', import.meta.url),
    'utf8',
  );

  const state = parseArtifactIndex(html, source);
  assert.equal(state.latest.version, '202');
  assert.equal(state.recommended.version, '201');
  assert.equal(state.optional, null);
});

test('ignores malformed and foreign archive links', () => {
  const html = `
    <a href="https://example.com/999-${hash('f')}/fx.tar.xz">OPTIONAL</a>
    <a href="./998-not-a-commit/fx.tar.xz">998</a>
    <a href="${archive(300, 'a')}">RECOMMENDED (300)</a>
    <a href="${archive(301, 'b')}">301</a>
  `;

  const state = parseArtifactIndex(html, source);
  assert.equal(state.latest.version, '301');
  assert.equal(state.recommended.version, '300');
  assert.equal(state.optional, null);
});

test('fails safely when a required channel is missing', () => {
  const html = `<a href="${archive(400, 'a')}">400</a>`;
  assert.throws(
    () => parseArtifactIndex(html, source),
    /does not identify a recommended FXServer build/,
  );
});

test('compares nullable channels and rewrites the pinned Docker argument', () => {
  const state = {
    source,
    latest: { version: '2', url: `${source}${archive(2, 'a').slice(2)}` },
    recommended: { version: '1', url: `${source}${archive(1, 'b').slice(2)}` },
    optional: null,
  };

  assert.deepEqual(compareStates(state, structuredClone(state)), {
    latest: false,
    recommended: false,
    optional: false,
    changed: false,
  });

  const changed = structuredClone(state);
  changed.optional = { version: '1', url: state.recommended.url };
  assert.equal(compareStates(state, changed).optional, true);

  assert.equal(
    updateDockerfileArtifact(
      'FROM alpine\nARG FXSERVER_ARTIFACT_URL=old\nRUN true\n',
      state.latest.url,
    ),
    `FROM alpine\nARG FXSERVER_ARTIFACT_URL=${state.latest.url}\nRUN true\n`,
  );
});
