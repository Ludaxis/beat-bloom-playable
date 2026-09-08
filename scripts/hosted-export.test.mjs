import test from 'node:test';
import assert from 'node:assert/strict';
import { exportPlayable } from '../api/export.js';
const origin = 'https://beatbloomstudio.ludaxis.io';
const request = (body, headers = {}) =>
  new Request(origin + '/api/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
test('hosted exports reject foreign origins and oversized bodies before building', async () => {
  const never = () => {
    throw Error('must not build');
  };
  assert.equal(
    (await exportPlayable(request({}, { Origin: 'https://other.example' }), never)).status,
    403,
  );
  assert.equal((await exportPlayable(request('x'.repeat(262145)), never)).status, 413);
  assert.equal((await exportPlayable(request('invalid'), never)).status, 400);
  assert.equal((await exportPlayable(new Request(origin + '/api/export'), never)).status, 405);
});
test('hosted exports stream complete HTML larger than the buffered response cap', async () => {
  const html = '<!doctype html>' + 'x'.repeat(4700000);
  const result = await exportPlayable(request({ format: 'html' }), async () => ({
    html,
    zip: new Uint8Array(10),
    filename: 'beat-bloom.html',
    htmlBytes: html.length,
    zipBytes: 10,
    limitBytes: 5000000,
    sha256: 'test',
    zipSha256: 'zip-test',
    metadata: { compression: { id: 'original' } },
  }));
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('content-length'), null);
  assert.equal(result.headers.get('x-playable-html-bytes'), String(html.length));
  const reader = result.body.getReader();
  let chunks = 0,
    total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks++;
    total += value.length;
  }
  assert.ok(chunks > 1);
  assert.equal(total, html.length);
});
