import { unitySource } from './unity-source.mjs';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = unitySource();
const out = resolve(project, 'assets');
const sourcePath = (source) => resolve(source.startsWith('assets/') ? project : repo, source);
await mkdir(out, { recursive: true });
const provenance = [];
const brandNodes = {
  icon: 'https://www.figma.com/design/HwApJvdkAl7j5owdhlep83/Product---Ludaxis---BeatBloom?node-id=2011-47202',
  logo: 'https://www.figma.com/board/2phyEEt4ZlbRBtBVZaIzMB/NCBB---Beat-Bloom?node-id=6-2443',
};
async function record(source, output, operation) {
  provenance.push({
    source,
    output,
    operation,
    ...(brandNodes[output.split('.')[0]]
      ? { approvedFigmaNode: brandNodes[output.split('.')[0]], approvedOn: '2026-09-08' }
      : {}),
    sourceSha256: createHash('sha256')
      .update(await readFile(sourcePath(source)))
      .digest('hex'),
    outputBytes: (await readFile(resolve(out, output))).length,
  });
}
const images = {
  icon: ['assets/source/brand/figma-icon-2011-47202.png', 320],
  logo: ['assets/source/brand/figma-logo-6-2443.png', 640],
  ukulele: ['Assets/_Ludaxis/BeatBloom/Art/Instrument/Assets/Ukulele.png', 96],
  violin: ['Assets/_Ludaxis/BeatBloom/Art/Instrument/Assets/Violin.png', 96],
  xylophone: ['Assets/_Ludaxis/BeatBloom/Art/Instrument/Assets/Xylophone.png', 96],
  drum: ['Assets/_Ludaxis/BeatBloom/Art/Instrument/Assets/Drum.png', 96],
  piano: ['assets/source/piano.png', 96],
  trumpet: ['assets/source/trumpet.png', 96],
};
for (const [name, [source, width]] of Object.entries(images)) {
  const input = sharp(sourcePath(source));
  if (name === 'icon' || name === 'logo') {
    // FigJam adds transparent selection-export margins. Remove only fully transparent pixels.
    const { data, info } = await input
      .clone()
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let left = info.width,
      top = info.height,
      right = 0,
      bottom = 0;
    for (let y = 0; y < info.height; y++)
      for (let x = 0; x < info.width; x++)
        if (data[(y * info.width + x) * info.channels + info.channels - 1] > 0) {
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x);
          bottom = Math.max(bottom, y);
        }
    input.extract({ left, top, width: right - left + 1, height: bottom - top + 1 });
  }
  if (name === 'piano' || name === 'trumpet') input.trim();
  await input
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: 87, alphaQuality: 95 })
    .toFile(resolve(out, `${name}.webp`));
  await record(
    source,
    `${name}.webp`,
    brandNodes[name]
      ? 'Exact user-selected Figma PNG; remove transparent export margins, WebP delivery resize; original artwork preserved'
      : 'WebP delivery resize; original art preserved',
  );
}
const font = 'Assets/UI/Fonts/LilitaOne-Regular/LilitaOne-Regular.ttf';
await copyFile(resolve(repo, font), resolve(out, 'lilita.ttf'));
await record(font, 'lilita.ttf', 'Copy existing game font');
for (const [id, directory, prefix, count] of [
  ['nobatidao', 'Assets/_Ludaxis/BeatBloom/Content/Songs/Nobatidao', 'Nobatidao', 3],
  ['sunflower', 'Assets/_Ludaxis/BeatBloom/Resources/Songs/sunflower', 'Sunflower', 5],
]) {
  for (let i = 0; i < count; i++) {
    const source = `${directory}/${prefix}_Stage${i}.ogg`;
    const output = `${id}-${i}.mp3`;
    // Identical sample origins and encoding settings for every stem. Chart gain is applied at runtime.
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      sourcePath(source),
      '-map_metadata',
      '-1',
      '-ac',
      '1',
      '-ar',
      '44100',
      '-codec:a',
      'libmp3lame',
      '-b:a',
      '64k',
      resolve(out, output),
    ]);
    await record(
      source,
      output,
      'Full authored loop, mono 44.1 kHz MP3 at 64 kb/s; no shifted start',
    );
  }
}
await writeFile(
  resolve(out, 'provenance.json'),
  JSON.stringify({ generatedWith: 'scripts/prepare-assets.mjs', assets: provenance }, null, 2) +
    '\n',
);
console.log(`Prepared ${provenance.length} assets from the current game.`);
