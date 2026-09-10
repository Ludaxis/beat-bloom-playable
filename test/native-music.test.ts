import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneLevel, instrumentCenters } from '../src/native/config';
import {
  SONG_CATALOG,
  defaultSongLanes,
  getEarnableStems,
  getSong,
  getSongAssetURLs,
  validateSongBindings,
  songStemGain,
} from '../src/native/music';

test('every catalog song has stable contiguous sources, resolvable assets and safe performer anchors', () => {
  for (const song of SONG_CATALOG) {
    assert.deepEqual(
      song.stems.map((stem) => stem.index),
      song.stems.map((_, index) => index),
    );
    const assets = getSongAssetURLs(song.id);
    for (const stem of song.stems) assert.ok(assets[`stem${stem.index}`].startsWith('/assets/'));
    const centers = instrumentCenters(song.id);
    assert.equal(centers.length, getEarnableStems(song.id).length);
    assert.ok(centers.every((center) => center >= 55 && center <= 521));
    for (let count = 1; count <= 12; count++) {
      const lanes = defaultSongLanes(song.id, count);
      assert.deepEqual(validateSongBindings({ songId: song.id, stemLanes: lanes }), []);
      assert.ok(
        lanes.every(
          (lane) =>
            lane.colors.length > 0 && lane.colors.every((color) => color >= 0 && color < count),
        ),
      );
      assert.equal(new Set(lanes.flatMap((lane) => lane.colors)).size, count);
    }
  }
});

test('legacy background identities stay reserved while all supplied parts remain earnable', () => {
  for (const id of ['kissmemore', 'nobatidao', 'sunflower']) {
    assert.equal(getSong(id).stems[0].earnable, false);
    assert.ok(
      validateSongBindings({ songId: id, stemLanes: [{ stem: 0, colors: [0], requiredBreaks: 1 }] })
        .length,
    );
  }
  const supplied = SONG_CATALOG.filter((song) => song.id.startsWith('supplied-'));
  assert.equal(supplied.length, 36);
  for (const song of supplied) {
    assert.equal(getEarnableStems(song.id).length, 5);
    assert.deepEqual(
      getEarnableStems(song.id).map((stem) => stem.index),
      [0, 1, 2, 3, 4],
    );
  }
});

test('authored bindings reject duplicates and absent parts while allowing deliberately unassigned music', () => {
  const level = cloneLevel();
  level.stemLanes = [];
  assert.deepEqual(validateSongBindings(level), []);
  level.stemLanes = [
    { stem: 1, colors: [0], requiredBreaks: 1 },
    { stem: 1, colors: [1], requiredBreaks: 1 },
  ];
  assert.ok(validateSongBindings(level).some((error) => error.includes('more than once')));
  level.stemLanes = [{ stem: 12, colors: [0], requiredBreaks: 1 }];
  assert.ok(validateSongBindings(level).some((error) => error.includes('not an earnable part')));
  assert.throws(() => getSong('unknown-song'), /Unknown song/);
});

test('imported mixing uses audible layer count and preserves the legacy gain contract', () => {
  const legacy = getSong('kissmemore');
  assert.equal(songStemGain(legacy, 1, [0, 1]), 10 ** ((-4.55 - 0.12) / 20));
  const balanced = {
    ...legacy,
    balanceLayers: true,
    programGainDb: 0,
    cumulativeMixGainDb: undefined,
    stems: legacy.stems.map((stem) => ({ ...stem, gainDb: 0 })),
  };
  assert.equal(
    songStemGain(balanced, 4, [0, 4]),
    Math.sqrt(1 / 2),
    'nonsequential colors reveal exactly two raw layers',
  );
  const curved = { ...balanced, cumulativeMixGainDb: [0, -2, -4, -6, -8] };
  assert.equal(songStemGain(curved, 4, [0, 4]), 10 ** (-2 / 20));
});
