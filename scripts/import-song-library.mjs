import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('..', import.meta.url));
const metadataOnly = process.argv.includes('--metadata-only');
const sourceRoot = resolve(
  process.argv.slice(2).find((arg) => !arg.startsWith('--')) || '../drop-sort-playables',
);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readJSON = async (path) => JSON.parse(await readFile(path, 'utf8'));
const writeJSON = async (path, value) => {
  await mkdir(dirname(resolve(root, path)), { recursive: true });
  await writeFile(resolve(root, path), JSON.stringify(value, null, 2) + '\n');
};
const copied = new Map();
async function copyMedia(url, directory = 'assets/music') {
  const original = resolve(sourceRoot, 'public', url.replace(/^\//, ''));
  const bytes = await readFile(original),
    sha256 = hash(bytes);
  const path = `${directory}/${sha256.slice(0, 24)}${extname(original)}`;
  if (!copied.has(path)) {
    await mkdir(dirname(resolve(root, path)), { recursive: true });
    if (!metadataOnly) await copyFile(original, resolve(root, path));
    copied.set(path, { path, source: url, sha256, bytes: bytes.length });
  }
  return path;
}
const charts = await readJSON(resolve(root, 'assets/native/charts.json'));
const legacy = [
  {
    id: 'kissmemore',
    title: 'Kiss Me More',
    artist: 'Doja Cat ft. SZA',
    performers: ['ukulele', 'violin', 'piano', 'drum'],
    prefix: 'assets/native/kissmemore',
    gains: [-0.56, -4.55, -1.71, -3.79, -1.31],
  },
  {
    id: 'nobatidao',
    title: 'NO BATIDÃO',
    artist: 'ZXKAI and slxughter',
    performers: ['piano', 'trumpet'],
    prefix: 'assets/nobatidao',
    gains: [-3.15, -6.26, -3.19],
  },
  {
    id: 'sunflower',
    title: 'Sunflower',
    artist: 'Post Malone and Swae Lee',
    performers: ['ukulele', 'violin', 'xylophone', 'drum'],
    prefix: 'assets/sunflower',
    gains: [0.8, -2.21, 2.24, 2.72, -2.34],
  },
];
const catalog = legacy.map((song) => {
  const chart = charts[song.id];
  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    bpm: chart.bpm,
    beatsPerBar: chart.beatsPerBar || 4,
    downbeatOffset: chart.downbeatOffset,
    loopBeats: chart.loopBeats,
    loopStartSeconds: 0,
    loopEndSeconds: (chart.loopBeats * 60) / chart.bpm,
    programGainDb: chart.gainDb || 0,
    exclusiveStages: false,
    sections: chart.sections,
    harmony: chart.harmony,
    stems: song.gains.map((gainDb, index) => ({
      index,
      label: index
        ? {
            drum: 'Drums',
            ukulele: 'Ukulele',
            violin: 'Violin',
            piano: 'Piano',
            trumpet: 'Trumpet',
            xylophone: 'Xylophone',
          }[song.performers[index - 1]]
        : 'Background',
      performer: index ? song.performers[index - 1] : 'piano',
      earnable: index > 0,
      gainDb,
      source: `${song.prefix}-${index}.mp3`,
      ...(index
        ? {
            performerSource: `assets/native/${song.performers[index - 1]}-animation.webp`,
            performerKind: 'sprite-sheet',
          }
        : {}),
    })),
    provenance: {
      collection: 'Beat Bloom original',
      reviewStatus: 'Existing authored arrangement retained',
    },
  };
});
const songs = await readJSON(resolve(sourceRoot, 'public/data/songs.json'));
const labels = {
  Guitar: 'guitar',
  'Acoustic Guitar': 'guitar',
  Violin: 'violin',
  Piano: 'piano',
  Drums: 'drum',
  Xylophone: 'xylophone',
  Ukulele: 'ukulele',
  Saxophone: 'saxophone',
  Trumpet: 'trumpet',
  Synthesizer: 'piano',
  Background: 'piano',
};
function importedTitle(song) {
  if (song.id.startsWith('supplied-')) return song.title;
  const base = song.title.split(' · ')[0];
  const path = song.sourcePath || '';
  const arrangement = path.includes('/Creative/ThemeInstrumentV2/')
    ? 'Creative visuals'
    : path.includes('/CreativeCapture/')
      ? 'Creative capture'
      : path.includes('/Creative/NoBatidaoFourInstruments/')
        ? 'Four instruments'
        : path.includes('/PlaytestArrangements/')
          ? 'Playtest arrangement'
          : 'Drop Sort';
  return `${base} · ${arrangement}`;
}
for (const song of songs) {
  const stems = [];
  for (const [index, stem] of song.stems.entries()) {
    const performer = labels[stem.instrument];
    if (!performer) throw Error(`Unreviewed performer mapping: ${stem.instrument}`);
    stems.push({
      index,
      label: stem.instrument,
      performer,
      earnable: stem.arrival > 0,
      gainDb: stem.gainDb || 0,
      source: await copyMedia(stem.exportUrl || stem.url),
      fallbackSource: await copyMedia(stem.url, 'assets/music/fallback'),
      metaSource: await copyMedia(stem.metaExportUrl || stem.exportUrl || stem.url),
      meta16Source: `assets/music/encoded/16k/${hash(await readFile(resolve(sourceRoot, 'public', stem.url.replace(/^\//, '')))).slice(0, 24)}.m4a`,
      performerSource:
        performer === 'guitar'
          ? 'assets/music/performers/guitar.webp'
          : `assets/native/${performer}-animation.webp`,
      performerKind: performer === 'guitar' ? 'image' : 'sprite-sheet',
      sourceArrival: stem.arrival,
    });
  }
  const start = song.loop?.startSeconds || 0,
    end = song.loop?.endSeconds;
  if (!Number.isFinite(end) || end <= start) throw Error(`Missing loop: ${song.id}`);
  catalog.push({
    id: song.id.startsWith('supplied-') ? song.id : `dropsort-${song.id}`,
    title: importedTitle(song),
    artist: song.artist || '',
    bpm: song.bpm,
    beatsPerBar: song.beatsPerBar || 4,
    downbeatOffset: song.firstDownbeatOffsetSeconds || 0,
    loopBeats: ((end - start) * song.bpm) / 60,
    loopStartSeconds: start,
    loopEndSeconds: end,
    programGainDb: song.programGainDb || 0,
    balanceLayers: true,
    exclusiveStages: song.exclusiveStages === true,
    ...(song.cumulativeMixGainDb?.length ? { cumulativeMixGainDb: song.cumulativeMixGainDb } : {}),
    stems,
    provenance: {
      ...song.provenance,
      sourceId: song.id,
      sourcePath: song.sourcePath,
      collection: song.provenance?.collection || 'Drop Sort original',
      reviewStatus:
        song.provenance?.reviewStatus ||
        'Authored source labels retained; timbre not independently verified',
    },
  });
}
if (!metadataOnly) {
  await mkdir(resolve(root, 'assets/music/performers'), { recursive: true });
  await copyFile(
    resolve(
      sourceRoot,
      'public/assets/items/music-guitars-01/instrument-acoustic-guitar-natural.webp',
    ),
    resolve(root, 'assets/music/performers/guitar.webp'),
  );
  await copyFile(
    resolve(sourceRoot, 'public/assets/ui/instruments-beat-bloom/saxophone-animation.webp'),
    resolve(root, 'assets/native/saxophone-animation.webp'),
  );
}
await writeJSON('src/native/data/song-catalog.json', catalog);
await writeJSON('assets/music/catalog.json', catalog);
await writeJSON('content/music/import-provenance.json', {
  version: 1,
  sourceCatalog: 'Drop Sort public/data/songs.json',
  sourceCatalogSha256: hash(await readFile(resolve(sourceRoot, 'public/data/songs.json'))),
  arrangements: catalog.length,
  importedArrangements: songs.length,
  files: [...copied.values()].sort((a, b) => a.path.localeCompare(b.path)),
});
console.log(
  `Imported ${songs.length} arrangements; ${catalog.length} total. Copied ${copied.size} distinct prepared files. Existing Beat Bloom arrangements retained.`,
);
