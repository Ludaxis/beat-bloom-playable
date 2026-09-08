const LIMIT = 256 * 1024;
async function readBounded(stream) {
  const reader = stream.getReader(),
    chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > LIMIT) throw Error('This shared level is too large.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
export async function encodeShare(snapshot) {
  let bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  if (bytes.length > LIMIT)
    throw Error('This level is too large to share. Try smaller logo or icon images.');
  let format = 'j';
  if (typeof CompressionStream !== 'undefined') {
    bytes = await readBounded(
      new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip')),
    );
    format = 'g';
  }
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return format + '.' + btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
export async function decodeShare(fragment) {
  if (fragment.length > 360000 || !/^[gj]\.[A-Za-z0-9_-]+$/.test(fragment))
    throw Error('This playable link is incomplete or invalid.');
  const [format, encoded] = fragment.split('.');
  let bytes = Uint8Array.from(atob(encoded.replaceAll('-', '+').replaceAll('_', '/')), (c) =>
    c.charCodeAt(0),
  );
  if (format === 'g') {
    if (typeof DecompressionStream === 'undefined')
      throw Error('Open this link in a current browser.');
    bytes = await readBounded(
      new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),
    );
  }
  if (bytes.length > LIMIT) throw Error('This shared level is too large.');
  const saved = JSON.parse(new TextDecoder().decode(bytes));
  if (
    saved?.version !== 1 ||
    !['native', 'a-heart', 'b-heart', 'a-flower', 'b-flower'].includes(saved.profile) ||
    !saved.level
  )
    throw Error('This playable link has invalid settings.');
  return saved;
}
