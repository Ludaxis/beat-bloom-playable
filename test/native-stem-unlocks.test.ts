import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneLevel } from '../src/native/config';
import { normalizePlayableQueue } from '../src/native/queue';
import { colorUnlockTargets, laneUnlockProgress } from '../src/native/stem-unlocks';
import { NativeModel } from '../src/native/model';
test('half-color targets include hidden rings, round upward, exclude gaps and refresh after edits', () => {
  const level = cloneLevel();
  level.rings = [
    [0, 0, 0, 1, 1, -1],
    [0, 0, 1, 1, 1, 1],
    [0, 0, 0, 0, 0, 1],
  ];
  level.stemLanes = [
    { stem: 1, colors: [0], requiredBreaks: 99 },
    { stem: 2, colors: [1], requiredBreaks: 99 },
  ];
  const next = normalizePlayableQueue(level);
  assert.deepEqual(colorUnlockTargets(next), [5, 4, 0, 0]);
  assert.deepEqual(
    next.stemLanes.map((l) => l.requiredBreaks),
    [5, 4],
  );
  assert.equal(level.stemLanes[0].requiredBreaks, 99);
  next.rings = [[0, 1]];
  assert.deepEqual(
    normalizePlayableQueue(next).stemLanes.map((l) => l.requiredBreaks),
    [1, 1],
  );
});
test('one color cannot fill another colors half in a shared instrument', () => {
  assert.equal(laneUnlockProgress([0, 1], [10, 0], [5, 5]), 5);
  assert.equal(laneUnlockProgress([0, 1], [10, 4], [5, 5]), 9);
  assert.equal(laneUnlockProgress([0, 1], [5, 5], [5, 5]), 10);
});
test('model unlock event and progress occur exactly at half of every assigned color', () => {
  const level = cloneLevel();
  level.rings = [[0, 0, 0, 0, 1, 1, 1, 1]];
  level.stemLanes = [{ stem: 1, colors: [0, 1], requiredBreaks: 99 }];
  level.arenaRingCapacity = 1;
  const model = new NativeModel(normalizePlayableQueue(level));
  // Exercise the model's accepted-contact path, bypassing trajectory variance only.
  const hit = (index: number) => {
    const segment = model.rings[0].segments[index];
    (model as any).breakSegment(
      segment,
      { id: 100, color: segment.color, power: 3 },
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      1,
    );
  };
  hit(0);
  hit(1);
  hit(2);
  hit(3);
  assert.equal(model.stemProgress[0], 2);
  assert.deepEqual(model.unlockedStems, []);
  hit(4);
  assert.equal(model.stemProgress[0], 3);
  assert.deepEqual(model.unlockedStems, []);
  hit(5);
  assert.equal(model.stemProgress[0], 4);
  assert.deepEqual(model.unlockedStems, [1]);
  hit(6);
  assert.deepEqual(model.unlockedStems, [1]);
  assert.equal(model.stemProgress[0], 4);
});
