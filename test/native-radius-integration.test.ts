import test from 'node:test';
import assert from 'node:assert/strict';
import { getPlayableLevel } from '../src/native/creative';
import {
  NativeModel,
  validateNativeLevel,
  exportNativeLevel,
  importNativeLevel,
} from '../src/native/model';
import { normalizePlayableQueue } from '../src/native/queue';
import { worldToScreen } from '../src/native/config';
import type { NativeShape } from '../src/native/types';
import { resolveTutorialOptions } from '../src/native/tutorial-settings';

function fixture(shape: NativeShape, radius: number, layers = 3, visible = 3) {
  const l = getPlayableLevel('a-heart');
  l.shape = shape;
  l.innerRadius = radius;
  l.rings = Array.from({ length: layers }, () => [0]);
  l.arenaRingCapacity = visible;
  l.maxRenderedRings = visible;
  l.previewRingCount = 0;
  l.motion = { ...l.motion, conveyorHoldFigure: true, conveyorBeatsPerSlot: 0 };
  return normalizePlayableQueue(l, true);
}

test('optional tutorial defaults preserve absent metadata and reject malformed imported settings', () => {
  const l = fixture('ring', 2),
    before = JSON.stringify(l),
    options = resolveTutorialOptions(l);
  assert.deepEqual(options, { enabled: true, placement: 'auto' });
  options.enabled = false;
  assert.deepEqual(resolveTutorialOptions(l), { enabled: true, placement: 'auto' });
  assert.equal(JSON.stringify(l), before);
  assert.deepEqual(importNativeLevel(exportNativeLevel(l)), l);
  assert.equal('tutorial' in l, false);
  for (const enabled of [false, true])
    for (const placement of ['auto', 'top', 'slots'] as const) {
      const next = { ...l, tutorial: { enabled, placement } };
      assert.deepEqual(validateNativeLevel(next), []);
      assert.deepEqual(importNativeLevel(exportNativeLevel(next)), next);
    }
  for (const tutorial of [
    null,
    [],
    {},
    'yes',
    { enabled: 1, placement: 'auto' },
    { enabled: true, placement: 'bottom' },
    { enabled: false },
    { placement: 'slots' },
  ])
    assert.ok(validateNativeLevel({ ...l, tutorial }).some((e) => e.includes('tutorial')));
});

test('radius edits preserve authored data and render the same scaled paths used by collisions', () => {
  for (const shape of ['ring', 'heart', 'flower', 'hexagon'] as NativeShape[]) {
    const small = fixture(shape, 1),
      large = { ...small, innerRadius: 4 },
      a = new NativeModel(small),
      b = new NativeModel(large);
    const { innerRadius: ignoredA, ...restA } = a.level,
      { innerRadius: ignoredB, ...restB } = b.level;
    assert.deepEqual(restB, restA);
    assert.deepEqual(importNativeLevel(exportNativeLevel(large)), large);
    const average = (points: { x: number; y: number }[]) =>
      points.reduce((n, p) => n + Math.hypot(p.x, p.y), 0) / points.length;
    assert.ok(Math.abs(average(b.rings[0].points) / average(a.rings[0].points) - 4) < 1e-8);
    for (let i = 0; i < 3; i++) {
      assert.deepEqual(a.getVisualRing(i)!.segments, a.rings[i].segments);
      assert.deepEqual(b.getVisualRing(i)!.segments, b.rings[i].segments);
    }
  }
});

test('radius bounds and layer counts keep fitted collision paths finite and inside the horizontal viewport', () => {
  const cases: [NativeShape, number, number, number][] = [
    ['ring', 0.5, 1, 1],
    ['heart', 0.5, 6, 6],
    ['flower', 0.5, 24, 12],
    ['hexagon', 0.5, 24, 12],
    ['triangle', 10, 1, 1],
    ['square', 10, 6, 6],
    ['pentagon', 10, 24, 12],
    ['heptagon', 10, 24, 12],
  ];
  for (const [shape, radius, count, visible] of cases) {
    const l = fixture(shape, radius, count, visible);
    assert.deepEqual(validateNativeLevel(l), []);
    const model = new NativeModel(l);
    for (const p of model.wallPoints) {
      const screen = worldToScreen(p, model.config);
      assert.ok(Number.isFinite(screen.x) && Number.isFinite(screen.y));
      assert.ok(
        screen.x >= 0 && screen.x <= model.config.view.width,
        `${shape} radius${radius} wall x${screen.x}`,
      );
    }
    for (const r of model.rings.filter((r) => r.visible))
      assert.ok(
        r.segments.every(
          (s) =>
            s.points.length >= 2 &&
            s.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
        ),
      );
  }
});

test('ordinary ball impact moves outward with the actual radius while preserving a completable puzzle', () => {
  const results = [];
  for (const radius of [1, 4]) {
    const model = new NativeModel(fixture('ring', radius, 1, 1));
    assert.equal(model.fireQueue(0), true);
    let hit;
    for (let i = 0; i < 120 * 12 && !hit; i++) {
      model.step(1 / 120);
      hit = model.drainEvents().find((e) => e.type === 'break');
    }
    assert.ok(hit);
    assert.equal(model.status, 'won');
    results.push({ time: hit.time, distance: Math.hypot(hit.position.x, hit.position.y) });
  }
  assert.ok(results[1].distance > results[0].distance + 2);
  assert.ok(results.every((hit) => Number.isFinite(hit.time) && hit.time > 0 && hit.time < 12));
});
