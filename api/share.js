import { get, put } from '@vercel/blob';
import { createHmac } from 'node:crypto';
import { validatePackageOptions, NativePackageError } from '../scripts/native-package.mjs';

const LIMIT = 256 * 1024;
const ID = /^[A-Za-z0-9_-]{22}$/;
const json = (body, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
// Content-addressed snapshots are immutable. The secret makes their IDs unguessable,
// while repeated Share clicks reuse the same object instead of filling storage.
const storage = {
  async read(id) {
    const result = await get(`shares/v1/${id}.json`, { access: 'private' });
    return result ? new Response(result.stream).json() : null;
  },
  async save(snapshot) {
    const raw = JSON.stringify(snapshot);
    const id = createHmac('sha256', process.env.BLOB_READ_WRITE_TOKEN)
      .update(raw)
      .digest('base64url')
      .slice(0, 22);
    if (!(await this.read(id))) {
      try {
        await put(`shares/v1/${id}.json`, raw, {
          access: 'private',
          addRandomSuffix: false,
          allowOverwrite: false,
          contentType: 'application/json',
        });
      } catch (error) {
        // A simultaneous identical request may have won the create race.
        if (!(await this.read(id))) throw error;
      }
    }
    return id;
  },
};

export async function sharePlayable(request, store = storage) {
  try {
    const url = new URL(request.url);
    if (request.method === 'GET') {
      const id = url.searchParams.get('id');
      if (!ID.test(id || '')) return json({ error: 'This link is invalid.' }, 400);
      const saved = await store.read(id);
      return saved ? json(saved) : json({ error: 'This playable was not found.' }, 404);
    }
    if (request.method !== 'POST')
      return new Response(null, { status: 405, headers: { Allow: 'GET, POST' } });
    if (
      request.headers.get('origin') !== url.origin ||
      (request.headers.has('sec-fetch-site') &&
        request.headers.get('sec-fetch-site') !== 'same-origin')
    )
      return json({ error: 'Share from this Studio page.' }, 403);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || ''))
      return json({ error: 'Send level settings as JSON.' }, 415);
    if (Number(request.headers.get('content-length')) > LIMIT)
      return json({ error: 'This level is too large to share.' }, 413);
    const reader = request.body?.getReader();
    const chunks = [];
    let length = 0;
    if (reader) {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > LIMIT) return json({ error: 'This level is too large to share.' }, 413);
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
    }
    let saved;
    try {
      saved = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return json({ error: 'These settings could not be read.' }, 400);
    }
    if (
      saved?.version !== 1 ||
      !saved.level ||
      Object.keys(saved).some((key) => !['version', 'profile', 'level'].includes(key))
    )
      return json({ error: 'This playable has invalid settings.' }, 400);
    await validatePackageOptions({ network: 'unity', profile: saved.profile, level: saved.level });
    const id = await store.save(saved);
    return json({ path: `/play/${id}` }, 201);
  } catch (error) {
    if (error instanceof NativePackageError) return json({ error: error.message }, error.status);
    console.error('Playable sharing failed:', error.name);
    return json({ error: 'Sharing is unavailable. Please try again shortly.' }, 503);
  }
}
export default {
  fetch(request) {
    return sharePlayable(request);
  },
};
