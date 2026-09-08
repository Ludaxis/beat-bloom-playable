import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createNativePackage,
  validatePackageOptions,
  NativePackageError,
  MAX_EXPORT_BODY_BYTES,
} from './native-package.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.mp3': 'audio/mpeg',
  '.zip': 'application/zip',
  '.ttf': 'font/ttf',
  '.md': 'text/plain; charset=utf-8',
};
const loopback = (address) =>
  address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';

function assertLocalOrigin(req) {
  const host = req.headers.host;
  if (
    !loopback(req.socket.remoteAddress) ||
    typeof host !== 'string' ||
    !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host)
  )
    throw new NativePackageError(
      'INVALID_ORIGIN',
      'Exports are available only from this local review page.',
      403,
    );
  const origin = `http://${host}`;
  if (
    new URL(origin).port !== String(req.socket.localPort) ||
    req.headers.origin !== origin ||
    (req.headers['sec-fetch-site'] &&
      !['same-origin', 'none'].includes(req.headers['sec-fetch-site']))
  )
    throw new NativePackageError(
      'INVALID_ORIGIN',
      'Export requests must originate from this local review page.',
      403,
    );
}

function readJSON(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || ''))
    throw new NativePackageError(
      'INVALID_CONTENT_TYPE',
      'Send export settings as application/json.',
      415,
    );
  if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity')
    throw new NativePackageError(
      'INVALID_CONTENT_ENCODING',
      'Compressed request bodies are not supported.',
      415,
    );
  if (Number(req.headers['content-length'] || 0) > MAX_EXPORT_BODY_BYTES) {
    req.resume();
    throw new NativePackageError('BODY_TOO_LARGE', 'Export settings exceed 256 KiB.', 413);
  }
  return new Promise((resolveJSON, reject) => {
    let size = 0,
      oversized = false;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_EXPORT_BODY_BYTES) {
        if (!oversized) {
          oversized = true;
          chunks.length = 0;
          reject(new NativePackageError('BODY_TOO_LARGE', 'Export settings exceed 256 KiB.', 413));
        }
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (oversized) return;
      try {
        resolveJSON(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new NativePackageError('INVALID_JSON', 'Export settings are not valid JSON.'));
      }
    });
    req.on('error', reject);
    req.on('aborted', () =>
      reject(new NativePackageError('REQUEST_ABORTED', 'Export request was interrupted.')),
    );
  });
}

function sendError(res, error) {
  const known = error instanceof NativePackageError;
  const status = known ? error.status : 500;
  const body = JSON.stringify({
    error: known
      ? error.message
      : 'The export could not be built. Check the local server output and try again.',
    code: known ? error.code : 'EXPORT_FAILED',
    ...(known && error.details ? { details: error.details } : {}),
  });
  if (!known) console.error('Beat Bloom export failed:', error);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...(status === 413 ? { Connection: 'close' } : {}),
    ...(status === 429 ? { 'Retry-After': '5' } : {}),
  });
  res.end(body);
}

// Factory permits isolated regression servers without restarting the user's review session.
// The injectable builder is test-only server configuration; it is never a request parameter.
export function createReviewServer({ packageBuilder = createNativePackage } = {}) {
  let building = false;
  return createServer(async (req, res) => {
    let route;
    try {
      route = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      res.writeHead(400).end('Invalid URL');
      return;
    }
    if (route === '/api/export') {
      try {
        if (req.method !== 'POST') {
          res.setHeader('Allow', 'POST');
          throw new NativePackageError(
            'METHOD_NOT_ALLOWED',
            'Use POST to export the current playable.',
            405,
          );
        }
        assertLocalOrigin(req);
        const input = await readJSON(req);
        await validatePackageOptions(input);
        if (building)
          throw new NativePackageError(
            'EXPORT_BUSY',
            'Another playable is being exported. Please try again shortly.',
            429,
          );
        building = true;
        try {
          const result = await packageBuilder(input);
          const format = input.format || 'html',
            payload = format === 'zip' ? Buffer.from(result.zip) : Buffer.from(result.html);
          const filename = result.filename;
          res.writeHead(200, {
            'Content-Type': format === 'zip' ? 'application/zip' : 'text/html; charset=utf-8',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Content-Length': payload.length,
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'X-Playable-HTML-Bytes': result.htmlBytes,
            'X-Playable-ZIP-Bytes': result.zipBytes,
            'X-Playable-Limit-Bytes': result.limitBytes,
            'X-Playable-SHA256': result.sha256,
            'X-Playable-ZIP-SHA256': result.zipSha256,
            'X-Playable-Compression': result.metadata.compression.id,
          });
          res.end(payload);
        } finally {
          building = false;
        }
      } catch (error) {
        req.resume();
        if (!res.headersSent) sendError(res, error);
        else res.destroy();
      }
      return;
    }
    try {
      if (!['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(405, { Allow: 'GET, HEAD' }).end();
        return;
      }
      let path = resolve(root, '.' + (route === '/' ? '/review/index.html' : route));
      if (
        !path.startsWith(root + sep) ||
        route.split('/').some((p) => p.startsWith('.')) ||
        path.includes(`${sep}node_modules${sep}`)
      ) {
        res.writeHead(403).end();
        return;
      }
      if ((await stat(path)).isDirectory()) path = resolve(path, 'index.html');
      const buffer = await readFile(path);
      res.writeHead(200, {
        'Content-Type': types[extname(path)] || 'application/octet-stream',
        'Content-Length': buffer.length,
        'Cache-Control': 'no-store',
      });
      res.end(req.method === 'HEAD' ? undefined : buffer);
    } catch {
      res.writeHead(404).end('Not found');
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.BB_PORT || 4178);
  createReviewServer().listen(port, '127.0.0.1', () =>
    console.log(`Beat Bloom review: http://127.0.0.1:${port}`),
  );
}
