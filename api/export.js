import {
  createNativePackage,
  NativePackageError,
  MAX_EXPORT_BODY_BYTES,
} from '../scripts/native-package.mjs';

// The hosted adapter uses the same validator and packager as the local Studio.
// Streaming keeps valid 5 MB HTML exports below no artificial HTTP response cap.
let building = false;
export async function exportPlayable(request, packageBuilder = createNativePackage) {
  try {
    if (request.method !== 'POST')
      return Response.json(
        { error: 'Use POST to export the current playable.' },
        {
          status: 405,
          headers: { Allow: 'POST' },
        },
      );
    const url = new URL(request.url);
    if (
      request.headers.get('origin') !== url.origin ||
      (request.headers.has('sec-fetch-site') &&
        request.headers.get('sec-fetch-site') !== 'same-origin')
    )
      throw new NativePackageError('INVALID_ORIGIN', 'Export from this Studio page.', 403);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || ''))
      throw new NativePackageError('INVALID_CONTENT_TYPE', 'Send export settings as JSON.', 415);
    if (Number(request.headers.get('content-length')) > MAX_EXPORT_BODY_BYTES)
      throw new NativePackageError('BODY_TOO_LARGE', 'Export settings exceed 256 KiB.', 413);
    const reader = request.body?.getReader();
    const chunks = [];
    let length = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > MAX_EXPORT_BODY_BYTES) {
          await reader.cancel();
          throw new NativePackageError('BODY_TOO_LARGE', 'Export settings exceed 256 KiB.', 413);
        }
        chunks.push(value);
      }
    }
    let input;
    try {
      input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new NativePackageError('INVALID_JSON', 'Export settings are not valid JSON.');
    }
    if (building)
      throw new NativePackageError(
        'EXPORT_BUSY',
        'Another export is building. Try again shortly.',
        429,
      );
    building = true;
    let result;
    try {
      result = await packageBuilder(input);
    } finally {
      building = false;
    }
    const isZip = input.format === 'zip';
    const bytes = isZip ? result.zip : new TextEncoder().encode(result.html);
    let offset = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (offset >= bytes.length) {
          controller.close();
          return;
        }
        controller.enqueue(bytes.subarray(offset, offset + 64 * 1024));
        offset += 64 * 1024;
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': isZip ? 'application/zip' : 'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename="${result.filename}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Playable-HTML-Bytes': String(result.htmlBytes),
        'X-Playable-ZIP-Bytes': String(result.zipBytes),
        'X-Playable-Limit-Bytes': String(result.limitBytes),
        'X-Playable-SHA256': result.sha256,
        'X-Playable-ZIP-SHA256': result.zipSha256,
        'X-Playable-Compression': result.metadata.compression.id,
      },
    });
  } catch (error) {
    const known = error instanceof NativePackageError;
    if (!known) console.error('Playable export failed:', error);
    return Response.json(
      {
        error: known ? error.message : 'The export could not be built. Please try again.',
        code: known ? error.code : 'EXPORT_FAILED',
      },
      { status: known ? error.status : 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
export default {
  fetch(request) {
    return exportPlayable(request);
  },
};
