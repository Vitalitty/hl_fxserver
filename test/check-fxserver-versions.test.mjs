import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  compareStates,
  parseServerDownloadPage,
  updateDockerfileArtifact,
} from '../scripts/check-fxserver-versions.mjs';

const source =
  'https://docs.fivem.net/docs/server-download/?platform=legacy&os=linux';
const archives =
  'https://runtime.fivem.net/artifacts/fivem/build_proot_linux/master/';
const hash = (character) => character.repeat(40);
const archiveUrl = (version, character) =>
  `${archives}${version}-${hash(character)}/fx.tar.xz`;
const entry = (version, character) => ({
  displayName: 'fx.tar.xz',
  subtitle: `build ${version}`,
  downloadURL: archiveUrl(version, character),
});
const page = ({ latest = [], recommended = [] }) =>
  `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: {
      pageProps: {
        legacy: {
          latest: { linux: latest },
          recommended: { linux: recommended },
        },
      },
    },
  })}</script>`;

test('reads latest and recommended from the Server Download page data', () => {
  const html = readFileSync(
    new URL('./fixtures/server-download.html', import.meta.url),
    'utf8',
  );

  const state = parseServerDownloadPage(html, source);
  assert.deepEqual(state, {
    source,
    latest: {
      version: '35945',
      url: archiveUrl('35945', 'c'),
    },
    recommended: {
      version: '35245',
      url: archiveUrl('35245', 'b'),
    },
  });
});

test('rejects a displayed build number that does not match its archive URL', () => {
  const mismatched = entry('500', 'a');
  mismatched.subtitle = 'build 501';

  assert.throws(
    () =>
      parseServerDownloadPage(
        page({ latest: [mismatched], recommended: [entry('400', 'b')] }),
        source,
      ),
    /subtitle 501 does not match archive build 500/,
  );
});

test('fails safely when either required channel is missing', () => {
  assert.throws(
    () =>
      parseServerDownloadPage(page({ recommended: [entry('400', 'a')] }), source),
    /does not identify a valid latest build/,
  );
  assert.throws(
    () => parseServerDownloadPage(page({ latest: [entry('500', 'b')] }), source),
    /does not identify a valid recommended build/,
  );
});

test('compares channels and rewrites the pinned Docker argument', () => {
  const state = {
    source,
    latest: { version: '2', url: archiveUrl('2', 'a') },
    recommended: { version: '1', url: archiveUrl('1', 'b') },
  };

  assert.deepEqual(compareStates(state, structuredClone(state)), {
    latest: false,
    recommended: false,
    changed: false,
  });

  const changed = structuredClone(state);
  changed.recommended = structuredClone(state.latest);
  assert.equal(compareStates(state, changed).recommended, true);

  assert.equal(
    updateDockerfileArtifact(
      'FROM alpine\nARG FXSERVER_ARTIFACT_URL=old\nRUN true\n',
      state.latest.url,
    ),
    `FROM alpine\nARG FXSERVER_ARTIFACT_URL=${state.latest.url}\nRUN true\n`,
  );
});
