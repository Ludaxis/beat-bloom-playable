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

let importedManifest;
/** Imported variants are prepared once; shipping builds verify the delivered bytes. */
export async function importedAudio(source) {
  importedManifest ??= Promise.all([
    readFile(resolve(root, 'content/music/import-provenance.json'), 'utf8').then(JSON.parse),
    readFile(resolve(root, 'content/music/encoded-provenance.json'), 'utf8').then(JSON.parse),
  ]).then(
    ([imported, encoded]) =>
      new Map([
        ...imported.files.map((entry) => [entry.path, entry]),
        ...Object.entries(encoded.files),
      ]),
  );
  const entry = (await importedManifest).get(source);
  if (!entry) throw Error(`Prepared song audio is missing from the provenance: ${source}`);
  const bytes = await readFile(resolve(root, source));
  if (hash(bytes) !== entry.sha256) throw Error(`Prepared song audio checksum failed: ${source}`);
  return bytes;
}
