import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { importedAudio } from './audio-variants.mjs';
import { createNativePackage, validatePackageOptions } from './native-package.mjs';
const root = new URL('../', import.meta.url);
const catalog = JSON.parse(
  await readFile(new URL('src/native/data/song-catalog.json', root), 'utf8'),
);
const base = JSON.parse(
  await readFile(new URL('src/native/data/studio-default.json', root), 'utf8'),
);
const levelFor = (song) => ({
  ...structuredClone(base),
  songId: song.id,
  bpm: song.bpm,
  beatsPerBar: song.beatsPerBar,
  loopBeats: song.loopBeats,
  downbeatOffset: song.downbeatOffset,
  sections: song.sections || [{ startBeat: 0, intensity: 0.65, direction: 1, degreesPerBeat: 30 }],
  stemLanes: song.stems
    .filter((s) => s.earnable)
    .map((s) => ({ stem: s.index, colors: [s.index % base.palette.length], requiredBreaks: 1 })),
});
test('catalog preserves three originals and all 69 source arrangements with checked-in media', async () => {
  assert.equal(catalog.length, 72);
  assert.equal(new Set(catalog.map((s) => s.id)).size, 72);
  assert.equal(new Set(catalog.map((s) => s.title)).size, 72);
  assert.equal(catalog.filter((s) => s.id.startsWith('supplied-')).length, 36);
  assert.equal(catalog.filter((s) => s.id.startsWith('dropsort-')).length, 33);
  for (const id of ['kissmemore', 'nobatidao', 'sunflower'])
    assert(catalog.some((s) => s.id === id));
  assert.deepEqual(
    JSON.parse(await readFile(new URL('assets/music/catalog.json', root), 'utf8')),
    catalog,
  );
  const files = new Set();
  for (const song of catalog) {
    assert(song.loopEndSeconds > song.loopStartSeconds);
    assert(song.bpm > 0);
    assert.deepEqual(
      song.stems.map((s) => s.index),
      song.stems.map((_, i) => i),
    );
    for (const stem of song.stems)
      for (const key of [
        'source',
        'fallbackSource',
        'metaSource',
        'meta16Source',
        'performerSource',
      ])
        if (stem[key]) {
          assert.match(stem[key], /^assets\//);
          assert(!stem[key].includes('..'));
          files.add(stem[key]);
        }
  }
  await Promise.all([...files].map((path) => access(new URL(path, root))));
  const provenance = JSON.parse(
    await readFile(new URL('content/music/import-provenance.json', root), 'utf8'),
  );
  for (const entry of provenance.files) {
    const bytes = await readFile(new URL(entry.path, root));
    assert.equal(bytes.length, entry.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
  }
});
test('every imported arrangement validates independently of legacy creative profile', async () => {
  for (const song of catalog) {
    const result = await validatePackageOptions({
      network: 'unity',
      profile: 'a-heart',
      level: levelFor(song),
    });
    assert.equal(result.songId, song.id);
    assert.equal(result.level.songId, song.id);
  }
  const song = catalog.find((s) => s.id.startsWith('supplied-')),
    level = levelFor(song);
  await assert.rejects(
    validatePackageOptions({
      network: 'unity',
      profile: 'native',
      level: { ...level, stemLanes: [...level.stemLanes, level.stemLanes[0]] },
    }),
    (error) => ['INVALID_STEM_LANE', 'INVALID_LEVEL'].includes(error.code),
  );
});
test('hosted preview contains no encoded music and exports contain only the selected arrangement', async () => {
  const song = catalog.find((s) => s.id === 'supplied-perfect-five-instruments');
  const hosted = await createNativePackage(
    { network: 'preview', profile: 'native' },
    { allowPreview: true, hosted: true },
  );
  assert(!hosted.html.includes('data:audio/'));
  assert(hosted.htmlBytes < 1800000);
  const result = await createNativePackage({
    network: 'unity',
    profile: 'native',
    level: levelFor(song),
  });
  assert.equal(result.metadata.songId, song.id);
  for (const stem of song.stems) {
    const encoded = (await readFile(new URL(stem.source, root))).toString('base64');
    assert(result.html.includes(encoded), 'selected stem must be embedded');
  }
  const unrelated = catalog.find((s) => s.id === 'supplied-despacito-five-instruments');
  assert(
    !result.html.includes(
      (await readFile(new URL(unrelated.stems[0].source, root))).toString('base64'),
    ),
  );
  assert(result.withinLimit);
  const meta = await createNativePackage({
    network: 'meta',
    profile: 'native',
    level: levelFor(song),
  });
  assert(meta.htmlBytes < 2000000);
});

test('prepared imported audio variants verify without FFmpeg or original source downloads', async () => {
  const sources = new Set(
    catalog.flatMap((song) =>
      song.stems
        .flatMap((stem) => [stem.source, stem.metaSource, stem.meta16Source])
        .filter((path) => path?.startsWith('assets/music/')),
    ),
  );
  for (const source of sources) assert((await importedAudio(source)).length > 0);
  await assert.rejects(
    importedAudio('assets/music/unregistered.m4a'),
    /missing from the provenance/,
  );
});

test('long five- and six-part arrangements keep full music within Meta limits', async () => {
  for (const id of [
    'supplied-shallow-five-instruments',
    'dropsort-PlaytestArrangements--MergeSongSet_DeathBed_FourLevelPlaytest',
  ]) {
    const song = catalog.find((song) => song.id === id);
    const result = await createNativePackage({
      network: 'meta',
      profile: 'native',
      level: levelFor(song),
    });
    assert(result.htmlBytes < 2000000);
    assert.equal(result.metadata.level.loopBeats, song.loopBeats);
    for (const stem of song.stems)
      assert(
        result.html.includes((await readFile(new URL(stem.meta16Source, root))).toString('base64')),
      );
  }
});
