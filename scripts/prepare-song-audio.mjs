import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
const root = fileURLToPath(new URL('..', import.meta.url));
const run = promisify(execFile),
  hash = (b) => createHash('sha256').update(b).digest('hex');
const catalog = JSON.parse(
  await readFile(resolve(root, 'src/native/data/song-catalog.json'), 'utf8'),
);
const inputs = new Map();
for (const song of catalog)
  for (const stem of song.stems)
    if (stem.meta16Source) inputs.set(stem.meta16Source, stem.fallbackSource || stem.source);
let previous = { files: {} };
try {
  previous = JSON.parse(
    await readFile(resolve(root, 'content/music/encoded-provenance.json'), 'utf8'),
  );
} catch {}
const files = {},
  queue = [...inputs];
async function worker() {
  for (;;) {
    const next = queue.shift();
    if (!next) return;
    const [destination, source] = next,
      sourceSha256 = hash(await readFile(resolve(root, source)));
    let existing;
    try {
      existing = await readFile(resolve(root, destination));
    } catch {}
    if (
      existing &&
      previous.files[destination]?.sourceSha256 === sourceSha256 &&
      previous.files[destination]?.sha256 === hash(existing)
    ) {
      files[destination] = previous.files[destination];
      continue;
    }
    await mkdir(dirname(resolve(root, destination)), { recursive: true });
    await run(
      'ffmpeg',
      [
        '-y',
        '-v',
        'error',
        '-threads',
        '1',
        '-i',
        resolve(root, source),
        '-map_metadata',
        '-1',
        '-ac',
        '1',
        '-ar',
        '22050',
        '-c:a',
        'aac',
        '-b:a',
        '16k',
        '-movflags',
        '+faststart',
        resolve(root, destination),
      ],
      { timeout: 60000 },
    );
    const bytes = await readFile(resolve(root, destination));
    files[destination] = {
      source,
      sourceSha256,
      sha256: hash(bytes),
      bytes: bytes.length,
      sampleRate: 22050,
      kbps: 16,
    };
  }
}
await Promise.all([worker(), worker()]);
await writeFile(
  resolve(root, 'content/music/encoded-provenance.json'),
  JSON.stringify({ version: 1, files: Object.fromEntries(Object.entries(files).sort()) }, null, 2) +
    '\n',
);
console.log(`Prepared ${inputs.size} song variants; source clocks and durations preserved.`);
