import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sharePlayable } from '../api/share.js';
import { encodeShare, decodeShare } from '../review/share-codec.js';
const origin = 'https://beatbloomstudio.ludaxis.io';
const level = JSON.parse(
  await readFile(new URL('../src/native/data/studio-default.json', import.meta.url)),
);
const snapshot = { version: 1, profile: 'native', level };
const post = (body, headers = {}) =>
  new Request(origin + '/api/share', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
test('shared snapshots preserve the complete level and remain immutable', async () => {
  const id = 'Abcdefghijklmnopqrstuv';
  let stored;
  const store = {
    async save(value) {
      stored = structuredClone(value);
      return id;
    },
    async read(key) {
      return key === id ? stored : null;
    },
  };
  const created = await sharePlayable(post(snapshot), store);
  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), { path: '/play/' + id });
  const fetched = await sharePlayable(new Request(origin + '/api/share?id=' + id), store);
  assert.deepEqual(await fetched.json(), snapshot);
  assert.equal(
    (await sharePlayable(new Request(origin + '/api/share?id=' + 'x'.repeat(22)), store)).status,
    404,
  );
});
test('share rejects malformed, oversized, cross-origin and invalid gameplay before storage', async () => {
  const store = {
    save() {
      assert.fail('must not save');
    },
    read() {
      assert.fail('must not read');
    },
  };
  for (const [request, code] of [
    [post(snapshot, { origin: 'https://example.com' }), 403],
    [post(snapshot, { 'content-type': 'text/plain' }), 415],
    [post('x'.repeat(262145)), 413],
    [post('{'), 400],
    [post({ ...snapshot, profile: 'unknown' }), 400],
    [post({ ...snapshot, level: { ...level, songId: 'sunflower' } }), 422],
    [new Request(origin + '/api/share?id=../secret'), 400],
    [post({ ...snapshot, extra: true }), 400],
  ])
    assert.equal((await sharePlayable(request, store)).status, code);
});
test('existing compressed share links retain their exact settings', async () => {
  assert.deepEqual(await decodeShare(await encodeShare(snapshot)), snapshot);
});
