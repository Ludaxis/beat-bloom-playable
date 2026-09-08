import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');
let manifest;
/** Builds consume reviewed audio variants; only the explicit preparation tool runs FFmpeg. */
export async function encodedAudio(source, tier) {
  manifest ??= readFile(resolve(root, 'assets/encoded-audio/manifest.json'), 'utf8').then(
    JSON.parse,
  );
  const entry = (await manifest).files[source];
  const variant = entry?.variants[`${tier.audioSampleRate}-${tier.audioKbps}`];
  if (!variant || hash(await readFile(resolve(root, source))) !== entry.sourceSha256)
    throw new Error(
      `Prepared audio is missing or stale for ${source}. Run npm run assets:audio locally and commit assets/encoded-audio.`,
    );
  const buffer = await readFile(resolve(root, variant.path));
  if (hash(buffer) !== variant.sha256)
    throw new Error(`Prepared audio checksum failed: ${variant.path}`);
  return buffer;
}
