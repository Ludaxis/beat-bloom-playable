import test from 'node:test';
import assert from 'node:assert/strict';
import { shuffleQueueRows, normalizePlayableQueue } from '../src/native/queue';
import { makeContour, offsetContour, heartHalfPhase, segmentPath } from '../src/native/geometry';
import { cloneLevel } from '../src/native/config';
import { verifyPlayableLevel } from '../src/native/pattern-editor';
import { NativeModel } from '../src/native/model';

test('shuffle varies rows while preserving each row and all three-power balls', () => {
  const original = Array.from({ length: 12 }, (_, i) => ({
    color: i % 3,
    power: 3,
    mystery: false,
  }));
  const mixed = shuffleQueueRows(original, 123);
  assert.notDeepEqual(mixed, original);
  assert.deepEqual(mixed, shuffleQueueRows(original, 123));
  for (let i = 0; i < 12; i += 3)
    assert.deepEqual(
      mixed
        .slice(i, i + 3)
        .map((b) => b.color)
        .sort(),
      [0, 1, 2],
    );
  assert.ok(mixed.every((b) => b.power === 3));
  assert.deepEqual(
    original.map((b) => b.color),
    Array.from({ length: 12 }, (_, i) => i % 3),
  );
});

test('stationary heart halves meet at the symmetry axis across ring offsets', () => {
  for (const offset of [0, 0.4, 1.2, 2.4]) {
    const contour = offsetContour(makeContour('heart'), 2.8, offset);
    const phase = heartHalfPhase(contour);
    const a = segmentPath(contour, 0, 2, phase, 0),
      b = segmentPath(contour, 1, 2, phase, 0);
    assert.ok(Math.abs(a[0].x) < 0.001);
    assert.ok(Math.abs(a.at(-1)!.x) < 0.035, 'opposite seam stays at the notch');
    assert.ok(
      a.slice(1, -1).every((p) => p.x >= -0.035) || a.slice(1, -1).every((p) => p.x <= 0.035),
    );
    assert.deepEqual(a.at(-1), b[0]);
  }
});

test('shuffled queue has a replayable win in the real model', () => {
  let level = cloneLevel();
  level.rings = Array.from({ length: 3 }, () => [0, 1, 2]);
  level = normalizePlayableQueue(level, true);
  level.queue = shuffleQueueRows(level.queue, 123);
  const result = verifyPlayableLevel(level, { maxWallTimeMs: 15000, maxSimulationSeconds: 1200 });
  assert.equal(result.status, 'verified-win');
  const replay = new NativeModel(level);
  let cursor = 0;
  for (let step = 0; step < result.steps; step++) {
    while (result.inputs[cursor]?.step === step) {
      const move = result.inputs[cursor++];
      assert.equal(
        move.type === 'queue' ? replay.fireQueue(move.index) : replay.fireTray(move.index),
        true,
      );
    }
    replay.step(result.fixedStep);
  }
  assert.equal(replay.status, 'won');
});
