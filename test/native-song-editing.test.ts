import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneLevel } from '../src/native/config';
import { applySongToLevel } from '../src/native/creative';
import { rebuildRingContents } from '../src/native/level-editor';
import { SONG_CATALOG, getSong, validateSongBindings } from '../src/native/music';
import { validateNativeLevel } from '../src/native/model';
import { normalizePlayableQueue } from '../src/native/queue';

const suppliedId = SONG_CATALOG.find((song) => song.id.startsWith('supplied-'))!.id;

test('switching music preserves the authored puzzle and design with all five playable voices', () => {
  const source = normalizePlayableQueue(cloneLevel());
  source.name = 'My custom level';
  source.shape = 'triangle';
  source.motion.speedMultiplier = 0.7;
  const before = structuredClone(source);
  const result = applySongToLevel(source, suppliedId);
  assert.deepEqual(source, before);
  for (const key of [
    'name',
    'shape',
    'motion',
    'rings',
    'palette',
    'queue',
    'endCard',
    'intro',
  ] as const) {
    assert.deepEqual((result as any)[key], (before as any)[key], key);
  }
  assert.equal(result.bpm, getSong(suppliedId).bpm);
  assert.deepEqual(
    result.stemLanes.map((lane) => lane.stem),
    [0, 1, 2, 3, 4],
  );
  assert.deepEqual(validateNativeLevel(result), []);
  assert.deepEqual(validateSongBindings(result), []);
});

test('selecting the same song preserves custom assignments and invalid songs leave the source intact', () => {
  const source = applySongToLevel(cloneLevel(), suppliedId);
  source.stemLanes = [{ stem: 0, colors: [0, 2], requiredBreaks: 2 }];
  const before = structuredClone(source);
  const result = applySongToLevel(source, suppliedId);
  assert.deepEqual(result, before);
  assert.notEqual(result, source);
  assert.throws(() => applySongToLevel(source, 'missing-song'), /Unknown song/);
  assert.deepEqual(source, before);
});

test('palette resizing preserves surviving many-to-many bindings without reassigning removed colors', () => {
  const source = applySongToLevel(cloneLevel(), suppliedId);
  source.stemLanes = [
    { stem: 0, colors: [0, 2], requiredBreaks: 1 },
    { stem: 1, colors: [0, 1], requiredBreaks: 1 },
    { stem: 2, colors: [3], requiredBreaks: 1 },
  ];
  const before = structuredClone(source);
  const smaller = rebuildRingContents(source, {
    rings: [[0, 1, 0, 1]],
    palette: source.palette.slice(0, 2),
  });
  assert.deepEqual(
    smaller.stemLanes.map(({ stem, colors }) => ({ stem, colors })),
    [
      { stem: 0, colors: [0] },
      { stem: 1, colors: [0, 1] },
    ],
  );
  assert.deepEqual(source, before);
  const changedRGB = rebuildRingContents(source, { rings: source.rings, palette: [1, 2, 3, 4] });
  assert.deepEqual(
    changedRGB.stemLanes.map(({ stem, colors }) => ({ stem, colors })),
    source.stemLanes.map(({ stem, colors }) => ({ stem, colors })),
  );
  source.stemLanes = [];
  const silent = rebuildRingContents(source, {
    rings: [[0, 1, 2, 3, 4]],
    palette: [1, 2, 3, 4, 5],
  });
  assert.deepEqual(silent.stemLanes, []);
});

test('structural binding validation rejects repeated stems and duplicate color progress', () => {
  const source = applySongToLevel(cloneLevel(), suppliedId);
  source.stemLanes = [{ stem: 0, colors: [0, 0], requiredBreaks: 1 }];
  assert.ok(validateNativeLevel(source).some((error) => error.includes('same color')));
  source.stemLanes = [
    { stem: 0, colors: [0], requiredBreaks: 1 },
    { stem: 0, colors: [1], requiredBreaks: 1 },
  ];
  assert.ok(validateNativeLevel(source).some((error) => error.includes('same instrument')));
});
