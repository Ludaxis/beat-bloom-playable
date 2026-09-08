import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneLevel } from '../src/native/config';
import {
  NativeModel,
  validateNativeLevel,
  exportNativeLevel,
  importNativeLevel,
} from '../src/native/model';
import { normalizePlayableQueue } from '../src/native/queue';
import type { NativeLevel } from '../src/native/types';
import {
  DEFAULT_RING_APPEARANCE,
  resolveRingAppearance,
  ringDepthStyle,
} from '../src/native/depth';

function fixture(): NativeLevel {
  const level = cloneLevel();
  level.rings = Array.from({ length: 6 }, () => [0]);
  level.arenaRingCapacity = 3;
  level.previewRingCount = 0;
  level.maxRenderedRings = 3;
  level.shape = 'ring';
  level.innerRadius = 1.5;
  level.lineSpacing = 0.4;
  level.segmentGap = 0;
  level.motion = { ...level.motion, conveyorHoldFigure: true, conveyorBeatsPerSlot: 0 };
  return normalizePlayableQueue(level, true);
}

test('resolved depth defaults are independent copies and color/shadow ramps stay continuous at the wall', () => {
  const level = fixture(),
    before = JSON.stringify(level),
    resolved = resolveRingAppearance(level);
  assert.deepEqual(resolved, { colorFade: 0.08, shadowOpacity: 0.2, shadowFade: 0.3 });
  resolved.colorFade = 0.7;
  assert.equal(DEFAULT_RING_APPEARANCE.colorFade, 0.08);
  assert.equal(JSON.stringify(level), before);
  const appearance = resolveRingAppearance(level),
    inside = [0, 1, 2].map((n) => ringDepthStyle(n, 3, 1, appearance));
  assert.equal(inside[0].colorAlpha, 1);
  assert.ok(
    inside[0].colorAlpha > inside[1].colorAlpha && inside[1].colorAlpha > inside[2].colorAlpha,
  );
  assert.ok(inside.every((style) => style.shadowAlpha === 0));
  const outside = [4, 5, 6].map((n) => ringDepthStyle(n, 3, 1, appearance));
  assert.ok(outside.every((style) => style.colorAlpha === 0));
  assert.ok(
    outside[0].shadowAlpha > outside[1].shadowAlpha &&
      outside[1].shadowAlpha > outside[2].shadowAlpha,
  );
  for (const setting of [
    appearance,
    { colorFade: 0, shadowOpacity: 0.5, shadowFade: 0 },
    { colorFade: 1, shadowOpacity: 1, shadowFade: 1 },
  ]) {
    let previous = ringDepthStyle(2, 3, 1, setting);
    for (let i = 1; i <= 2000; i++) {
      const current = ringDepthStyle(2 + i / 1000, 3, 1, setting);
      for (const key of ['colorAlpha', 'shadowAlpha'] as const) {
        assert.ok(Number.isFinite(current[key]) && current[key] >= 0 && current[key] <= 1);
        assert.ok(
          Math.abs(current[key] - previous[key]) < 0.002,
          'no discrete pop crossing the wall',
        );
      }
      previous = current;
    }
  }
});

test('100 percent fades remain continuous at center and first-shadow boundaries while preserving integer anchors', () => {
  const epsilon = 1e-6,
    full = { colorFade: 1, shadowOpacity: 0.5, shadowFade: 1 };
  const center = ringDepthStyle(0, 3, 1, full),
    nearCenter = ringDepthStyle(epsilon, 3, 1, full);
  assert.equal(center.colorAlpha, 1);
  assert.ok(
    Math.abs(center.colorAlpha - nearCenter.colorAlpha) < 1e-8,
    '100% color fade must not pop at depth zero',
  );
  const shadow = ringDepthStyle(4, 3, 1, full),
    nearShadow = ringDepthStyle(4 + epsilon, 3, 1, full);
  assert.equal(shadow.shadowAlpha, 0.5);
  assert.ok(
    Math.abs(shadow.shadowAlpha - nearShadow.shadowAlpha) < 1e-8,
    '100% shadow fade must not pop one spacing outside the wall',
  );
  assert.ok(
    ringDepthStyle(0.5, 3, 1, full).colorAlpha > 0 &&
      ringDepthStyle(0.5, 3, 1, full).colorAlpha < 1,
  );
  assert.ok(
    ringDepthStyle(4.5, 3, 1, full).shadowAlpha > 0 &&
      ringDepthStyle(4.5, 3, 1, full).shadowAlpha < 0.5,
  );
  for (const fade of [0, 0.08, 0.3, 0.8, 1]) {
    const setting = { colorFade: fade, shadowOpacity: 0.5, shadowFade: fade };
    for (let i = 0; i < 3; i++)
      assert.ok(Math.abs(ringDepthStyle(i, 3, 1, setting).colorAlpha - (1 - fade) ** i) < 1e-12);
    for (let i = 0; i < 4; i++)
      assert.ok(
        Math.abs(ringDepthStyle(4 + i, 3, 1, setting).shadowAlpha - 0.5 * (1 - fade) ** i) < 1e-12,
      );
  }
});

test('future visual geometry follows real source pieces without making them collidable or mutating physics paths', () => {
  const model = new NativeModel(fixture());
  for (const elapsed of [0, 0.25, 1]) {
    if (elapsed) model.step(elapsed);
    const before = structuredClone(model.rings),
      wall = structuredClone(model.wallPoints);
    const visual = model.rings.map((r) => model.getVisualRing(r.sourceLayer)!);
    assert.equal(visual.length, 6);
    assert.ok(
      visual.slice(3).every((r) => r.points.length >= 240 && r.segments[0].points.length >= 241),
    );
    assert.ok(
      model.rings
        .slice(3)
        .every((r) => !r.visible && !r.eligible && r.segments[0].points.length === 0),
    );
    assert.deepEqual(model.rings, before);
    assert.deepEqual(model.wallPoints, wall);
    for (let i = 0; i < 3; i++)
      assert.deepEqual(visual[i].segments[0].points, model.rings[i].segments[0].points);
  }
});

test('ring appearance accepts bounded complete settings and rejects malformed nested values transactionally', () => {
  const level = fixture();
  for (const value of [0, 0.08, 0.5, 1]) {
    level.ringAppearance = { colorFade: value, shadowOpacity: value, shadowFade: value };
    assert.deepEqual(validateNativeLevel(level), []);
    assert.deepEqual(importNativeLevel(exportNativeLevel(level)), level);
  }
  for (const bad of [
    null,
    [],
    {},
    'dark',
    0,
    { colorFade: 0.1, shadowOpacity: 0.2 },
    ...['colorFade', 'shadowOpacity', 'shadowFade'].flatMap((key) =>
      [-0.01, 1.01, NaN, Infinity, '0.2', null].map((value) => ({
        colorFade: 0.1,
        shadowOpacity: 0.2,
        shadowFade: 0.3,
        [key]: value,
      })),
    ),
  ]) {
    assert.ok(
      validateNativeLevel({ ...level, ringAppearance: bad }).some((e) =>
        e.includes('ringAppearance'),
      ),
      JSON.stringify(bad),
    );
  }
});

test('appearance extremes preserve every ordinary-input physics state and event through an actual win', () => {
  const original = fixture(),
    dark = cloneLevel(original),
    light = cloneLevel(original);
  dark.ringAppearance = { colorFade: 1, shadowOpacity: 0, shadowFade: 1 };
  light.ringAppearance = { colorFade: 0, shadowOpacity: 1, shadowFade: 0 };
  const a = new NativeModel(dark),
    b = new NativeModel(light);
  let shots = 0;
  for (let step = 0; step < 120 * 45 && a.status === 'playing'; step++) {
    if (!a.isAnimatingShot && a.activeBalls.length < a.activeCapacity) {
      const ball = a.queueBalls().find((q) => q.row === 0 && q.fireable);
      if (ball) {
        assert.equal(a.fireQueue(ball.column), true);
        assert.equal(b.fireQueue(ball.column), true);
        shots++;
      }
    }
    a.step(1 / 120);
    b.step(1 / 120);
    assert.deepEqual(a.snapshot(), b.snapshot());
    assert.deepEqual(a.drainEvents(), b.drainEvents());
    if (step % 60 === 0) {
      assert.deepEqual(a.balls, b.balls);
      assert.deepEqual(a.wallPoints, b.wallPoints);
      assert.deepEqual(a.rings, b.rings);
    }
  }
  assert.equal(a.status, 'won');
  assert.equal(b.status, 'won');
  assert.equal(a.remaining, 0);
  assert.equal(shots, 2);
  assert.deepEqual(a.level.queue, original.queue);
  assert.deepEqual(b.level.rings, original.rings);
});
