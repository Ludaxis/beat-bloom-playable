import { unitySource } from './unity-source.mjs';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  repo = unitySource(),
  out = resolve(root, 'assets/native');
await mkdir(out, { recursive: true });
const sources = [];
async function record(source, output, operation) {
  sources.push({
    source,
    output,
    operation,
    sha256: createHash('sha256')
      .update(await readFile(resolve(repo, source)))
      .digest('hex'),
  });
}
const images = {
  lock: ['Assets/UI/Common/Assets/Icons-Common/Icon-Lock-Gold.png', 96],
  gear: ['Assets/UI/Common/Assets/Icons-Flat/Icon-Flat-Setting.png', 96],
  booster: ['Assets/UI/GamePlay/Assets/Icon-Booster-ExtraBall.png', 128],
  clef: ['Assets/UI/Common/Assets/Icons-Flat/Icon-Flat-Music.png', 96],
};
for (const [name, [source, width]] of Object.entries(images)) {
  await sharp(resolve(repo, source))
    .trim()
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: 93 })
    .toFile(resolve(out, `${name}.webp`));
  await record(source, `${name}.webp`, 'Resize approved original artwork');
}
for (const letter of [
  'BEAT-B',
  'BEAT-E',
  'BEAT-A',
  'BEAT-T',
  'BLOOM-B',
  'BLOOM-L',
  'BLOOM-O-Yellow',
  'BLOOM-O-Red',
  'BLOOM-M',
]) {
  const source = `Assets/UI/GamePlay/Assets/PreWin/Typo-${letter}.png`;
  await sharp(resolve(repo, source))
    .resize({ height: 160, withoutEnlargement: true })
    .webp({ quality: 90 })
    .toFile(resolve(out, `${letter}.webp`));
  await record(source, `${letter}.webp`, 'Native pre-win letter artwork');
}
for (let i = 0; i < 5; i++) {
  const source = `Assets/_Ludaxis/BeatBloom/Content/Songs/kissmemore/Kissmemore_Stage${i}.ogg`,
    output = `kissmemore-${i}.mp3`;
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-i',
    resolve(repo, source),
    '-map_metadata',
    '-1',
    '-ac',
    '1',
    '-ar',
    '44100',
    '-codec:a',
    'libmp3lame',
    '-b:a',
    '80k',
    resolve(out, output),
  ]);
  await record(source, output, 'Full native loop; common sample origin; mono 44.1kHz MP3 80k');
}
for (const name of [
  'launch_pluck',
  'bounce_mute',
  'break_bell',
  'break_tick',
  'shot_waste',
  'result_lose',
]) {
  const source = `Assets/_Ludaxis/BeatBloom/Resources/Sfx/${name}.${name === 'result_lose' ? 'ogg' : 'wav'}`;
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-i',
    resolve(repo, source),
    '-map_metadata',
    '-1',
    '-ac',
    '1',
    '-ar',
    '44100',
    '-codec:a',
    'libmp3lame',
    '-b:a',
    '80k',
    resolve(out, `${name}.mp3`),
  ]);
  await record(source, `${name}.mp3`, 'Native SFX, no synthesized substitute');
}
for (const midi of [61, 67, 73, 79]) {
  const source = `Assets/_Ludaxis/BeatBloom/Resources/Sfx/Bells/bell_m${midi}_hard_rr1.wav`;
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-i',
    resolve(repo, source),
    '-map_metadata',
    '-1',
    '-ac',
    '1',
    '-ar',
    '44100',
    '-codec:a',
    'libmp3lame',
    '-b:a',
    '80k',
    resolve(out, `bell-${midi}.mp3`),
  ]);
  await record(source, `bell-${midi}.mp3`, 'Native mapped-break bell sample');
}
for (const kind of ['kick', 'snare']) {
  const source = `Assets/_Ludaxis/BeatBloom/Resources/Sfx/InstrumentGold/Drum/DrumHit/hit_${kind}_v1_rr1.wav`;
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-i',
    resolve(repo, source),
    '-map_metadata',
    '-1',
    '-ac',
    '1',
    '-ar',
    '44100',
    '-codec:a',
    'libmp3lame',
    '-b:a',
    '80k',
    resolve(out, `${kind}.mp3`),
  ]);
  await record(source, `${kind}.mp3`, 'Native mapped-break drum sample');
}
await writeFile(resolve(out, 'provenance.json'), JSON.stringify({ sources }, null, 2));
const charts = {};
for (const [id, directory] of [
  ['kissmemore', 'kissmemore'],
  ['nobatidao', 'Nobatidao'],
  ['sunflower', 'sunflower'],
]) {
  const source = `Assets/_Ludaxis/BeatBloom/Resources/Songs/${directory}/Chart.asset`,
    text = await readFile(resolve(repo, source), 'utf8');
  const scalar = (key) => Number(text.match(new RegExp(`^  ${key}: ([-.\\d]+)$`, 'm'))?.[1] ?? 0);
  const loopBeats = Number(text.match(/    loopBeats: ([\d.]+)/)?.[1]);
  charts[id] = {
    bpm: scalar('bpm'),
    downbeatOffset: scalar('firstDownbeatOffsetSeconds'),
    beatsPerBar: scalar('beatsPerBar'),
    gainDb: scalar('songGainDb'),
    tuningCents: scalar('tuningCents'),
    loopBeats,
    sections: [
      ...text.matchAll(
        /- startBeat: ([\d.]+)\n    intensity01: ([\d.]+)\n    rollDirection: (-?\d+)\n    degreesPerBeat: ([\d.]+)/g,
      ),
    ]
      .map((m) => ({ startBeat: +m[1], intensity: +m[2], direction: +m[3], degreesPerBeat: +m[4] }))
      .filter((s) => s.startBeat < loopBeats),
    harmony: [
      ...text.matchAll(
        /- startSample: (\d+)\n      endSample: (\d+)\n      rootPitchClass: (\d+)\n      quality: (\d+)/g,
      ),
    ].map((m) => [+m[1], +m[3], +m[4]]),
    source,
  };
}
await writeFile(resolve(out, 'charts.json'), JSON.stringify(charts, null, 2));
console.log(`Prepared ${sources.length} native assets`);
