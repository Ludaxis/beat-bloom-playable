import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const root = fileURLToPath(new URL('..', import.meta.url));
const run = promisify(execFile);
const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');
const manifest = { version: 1, files: {} };
const files = (await readdir(resolve(root, 'assets'), { recursive: true }))
  .filter((path) => path.endsWith('.mp3') && !path.startsWith('encoded-audio/'))
  .sort();
for (const file of files) {
  const source = `assets/${file}`;
  const entry = { sourceSha256: hash(await readFile(resolve(root, source))), variants: {} };
  for (const [sampleRate, kbps] of [
    [32000, 32],
    [22050, 24],
    [22050, 16],
  ]) {
    const key = `${sampleRate}-${kbps}`;
    const path = `assets/encoded-audio/${key}/${file}`;
    const { stdout } = await run(
      'ffmpeg',
      [
        '-v',
        'error',
        '-i',
        resolve(root, source),
        '-map_metadata',
        '-1',
        '-ac',
        '1',
        '-ar',
        String(sampleRate),
        '-codec:a',
        'libmp3lame',
        '-b:a',
        `${kbps}k`,
        '-f',
        'mp3',
        'pipe:1',
      ],
      { encoding: 'buffer', maxBuffer: 4000000, timeout: 60000 },
    );
    await mkdir(dirname(resolve(root, path)), { recursive: true });
    await writeFile(resolve(root, path), stdout);
    entry.variants[key] = { path, sha256: hash(stdout), bytes: stdout.length };
  }
  manifest.files[source] = entry;
}
await writeFile(
  resolve(root, 'assets/encoded-audio/manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n',
);
console.log(`Prepared ${files.length} audio sources in three size tiers.`);
