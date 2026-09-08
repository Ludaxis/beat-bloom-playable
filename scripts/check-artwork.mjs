import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

// The rejected source fingerprint is retained as a guard, never as a delivered asset.
const rejected = '7d2d107b7e770cc8a8991d5c833923cc8d62b624ba951a77c41624dbaac881c7';
export async function checkArtwork(root) {
  const provenance = JSON.parse(await readFile(resolve(root, 'assets/provenance.json'), 'utf8'));
  for (const asset of provenance.assets) {
    if (/\/Organ\.png$/i.test(asset.source) || asset.sourceSha256 === rejected)
      throw new Error('Rejected organ artwork is prohibited');
  }
  async function scan(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, item.name);
      if (item.isDirectory()) await scan(path);
      else if (/\.(png|webp|jpg)$/i.test(item.name)) {
        const hash = createHash('sha256')
          .update(await readFile(path))
          .digest('hex');
        if (hash === rejected || /^organ\./i.test(item.name))
          throw new Error(`Rejected artwork: ${path}`);
      }
    }
  }
  await scan(resolve(root, 'assets'));
}
