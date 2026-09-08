import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneLevel } from '../src/native/config';
import {
  NativeModel,
  validateNativeLevel,
  importNativeLevel,
  exportNativeLevel,
} from '../src/native/model';
import {
  generatePattern,
  applyRingTemplate,
  setPatternShift,
  inferPattern,
  verifyPlayableLevel,
} from '../src/native/pattern-editor';
import { setLayerCount } from '../src/native/level-editor';
import type { NativeLevel, Vec2 } from '../src/native/types';
const epsilon = 1e-9;
const close = (a: number, b: number, tolerance = epsilon) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} differs from ${b}`);
const displacement = (a: Vec2, b: Vec2) => ({ x: b.x - a.x, y: b.y - a.y });
const norm = (p: Vec2) => Math.hypot(p.x, p.y);
const template = {
  rings: [
    [0, 0, 0, 0, 0, 0],
    [1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3],
    [2, 3, 2, 3, 2, 3, 2, 3],
  ],
  palette: [0xff3355, 0x55dd77, 0x3388ff, 0xffdd44],
};
function mixed(): NativeLevel {
  return applyRingTemplate(cloneLevel(), template);
}
function withoutPhase(level: NativeLevel): NativeLevel {
  const result = cloneLevel(level);
  delete result.ringPhaseOffsets;
  delete result.ringShiftDegrees;
  delete result.pattern;
  return result;
}

for (const degrees of [0.01, 0.1, 0.2, -0.1, -180, 180])
  test(`continuous ${degrees}° phase preserves authored mixed-count content and exact level tuning`, () => {
    const before = mixed(),
      level = setPatternShift(before, degrees);
    assert.deepEqual(withoutPhase(level), before);
    assert.deepEqual(before, mixed());
    assert.deepEqual(validateNativeLevel(level), []);
    assert.equal(level.ringShiftDegrees, degrees);
    assert.equal(level.ringPhaseOffsets!.length, before.rings.length);
    for (let ring = 0; ring < before.rings.length; ring++)
      close(level.ringPhaseOffsets![ring], ((((ring * degrees) / 360) % 1) + 1) % 1);
    assert.deepEqual(importNativeLevel(exportNativeLevel(level)), level);
  });

test('tiny phases change shared segment paths continuously while every outline stays fixed', () => {
  const base = mixed(),
    models = [0, 0.01, 0.1, 0.2, -0.1].map(
      (degrees) => new NativeModel(setPatternShift(base, degrees)),
    );
  const origin = models[0].rings[1].segments[0].points[0];
  const shifts = models.map((model) => displacement(origin, model.rings[1].segments[0].points[0]));
  assert.ok(
    norm(shifts[2]) > 1e-5 && norm(shifts[2]) < 0.02,
    '0.1 degrees is a real, tiny displacement',
  );
  close(shifts[1].x, shifts[2].x * 0.1, 1e-7);
  close(shifts[1].y, shifts[2].y * 0.1, 1e-7);
  close(shifts[3].x, shifts[2].x * 2, 1e-7);
  close(shifts[3].y, shifts[2].y * 2, 1e-7);
  close(shifts[4].x, -shifts[2].x, 1e-7);
  close(shifts[4].y, -shifts[2].y, 1e-7);
  for (const model of models) {
    assert.deepEqual(model.wallPoints, models[0].wallPoints);
    model.rings.forEach((ring, i) => assert.deepEqual(ring.points, models[0].rings[i].points));
    assert.deepEqual(model.rings[0].segments, models[0].rings[0].segments);
  }
});

test('setting an absolute degree value is stable and sequential small edits do not accumulate twice', () => {
  const base = mixed(),
    direct = setPatternShift(base, 0.2),
    sequential = setPatternShift(setPatternShift(base, 0.1), 0.2);
  direct.ringPhaseOffsets!.forEach((phase, i) => close(sequential.ringPhaseOffsets![i], phase));
  assert.deepEqual(setPatternShift(direct, 0.2), direct);
  const reset = setPatternShift(sequential, 0);
  assert.ok(reset.ringPhaseOffsets!.every((phase) => phase === 0));
});

test('legacy discrete recipes migrate at the same visible angle without changing any colored segment point', () => {
  const options = { colorCount: 4, segmentsPerRing: 12, colorsPerRing: 4, shift: 1 };
  const legacy = generatePattern(setLayerCount(cloneLevel(), 4), options);
  assert.deepEqual(inferPattern(legacy), { ...options, shift: 0, shiftDegrees: 30 });
  const untouched = new NativeModel(legacy),
    migrated = setPatternShift(legacy, 30),
    same = new NativeModel(migrated);
  assert.deepEqual(migrated.rings, legacy.rings);
  assert.deepEqual(migrated.queue, legacy.queue);
  assert.ok(migrated.ringPhaseOffsets!.every((phase) => phase === 0));
  for (let ring = 0; ring < legacy.rings.length; ring++)
    for (let segment = 0; segment < 12; segment++)
      assert.deepEqual(
        same.rings[ring].segments[segment].points,
        untouched.rings[ring].segments[segment].points,
      );
  const fine = setPatternShift(migrated, 30.1);
  close(fine.ringPhaseOffsets![1], 0.1 / 360);
  close(fine.ringPhaseOffsets![3], 0.3 / 360);
  assert.equal(inferPattern(fine)!.shift, 0);
  close(inferPattern(fine)!.shiftDegrees!, 30.1);
  const canonical = generatePattern(legacy, inferPattern(legacy)!);
  const canonicalModel = new NativeModel(canonical);
  for (let ring = 0; ring < legacy.rings.length; ring++)
    for (let index = 0; index < 12; index++) {
      const shiftedIndex = (index + ring) % 12,
        old = untouched.rings[ring].segments[shiftedIndex],
        current = canonicalModel.rings[ring].segments[index];
      assert.equal(old.color, current.color);
      old.points.forEach((point, i) => {
        close(point.x, current.points[i].x, 1e-8);
        close(point.y, current.points[i].y, 1e-8);
      });
    }
});

test('continuous recipes keep arrays and ammo independent of the requested phase', () => {
  const source = setLayerCount(cloneLevel(), 4),
    options = { colorCount: 3, segmentsPerRing: 7, colorsPerRing: 3, shift: 0, shiftDegrees: 0 };
  const baseline = generatePattern(source, options),
    shifted = generatePattern(source, { ...options, shiftDegrees: 2.35 });
  assert.deepEqual(shifted.rings, baseline.rings);
  assert.deepEqual(shifted.queue, baseline.queue);
  assert.deepEqual(shifted.palette, baseline.palette);
  close(inferPattern(shifted)!.shiftDegrees!, 2.35);
  assert.equal(inferPattern(shifted)!.shift, 0);
  const single = generatePattern(setLayerCount(source, 1), {
    ...options,
    colorCount: 1,
    colorsPerRing: 1,
    shiftDegrees: 23.45,
  });
  close(inferPattern(single)!.shiftDegrees!, 23.45);
  assert.deepEqual(single.ringPhaseOffsets, [0]);
});

test('resizing retains previous phase positions and continues the saved degree step; templates reset it', () => {
  const level = generatePattern(setLayerCount(cloneLevel(), 3), {
    colorCount: 3,
    segmentsPerRing: 7,
    colorsPerRing: 3,
    shift: 0,
    shiftDegrees: 1.25,
  });
  const longer = setLayerCount(level, 8),
    shorter = setLayerCount(level, 2);
  for (let ring = 0; ring < 8; ring++) close(longer.ringPhaseOffsets![ring], (ring * 1.25) / 360);
  shorter.ringPhaseOffsets!.forEach((phase, i) => close(phase, level.ringPhaseOffsets![i]));
  assert.equal(longer.ringShiftDegrees, 1.25);
  assert.deepEqual(validateNativeLevel(longer), []);
  const reset = applyRingTemplate(longer, template);
  assert.equal(reset.ringPhaseOffsets, undefined);
  assert.equal(reset.ringShiftDegrees, undefined);
  assert.equal(reset.pattern, undefined);
});

test('phase metadata rejects wrong lengths, invalid units and nonfinite degree values transactionally', () => {
  const base = mixed(),
    before = cloneLevel(base);
  for (const offsets of [
    null,
    [],
    [0, 0],
    Array(3).fill(NaN),
    Array(3).fill(Infinity),
    [0, -0.01, 0],
    [0, 1, 0],
    [0, '0.1', 0],
  ])
    assert.ok(
      validateNativeLevel({ ...base, ringPhaseOffsets: offsets } as NativeLevel).some((error) =>
        error.includes('ringPhaseOffsets'),
      ),
    );
  for (const degrees of [NaN, Infinity, -181, 181, null, '1'])
    assert.ok(
      validateNativeLevel({ ...base, ringShiftDegrees: degrees } as NativeLevel).some((error) =>
        error.includes('ringShiftDegrees'),
      ),
    );
  for (const degrees of [NaN, Infinity, 181]) {
    assert.throws(() => setPatternShift(base, degrees), RangeError);
    assert.ok(
      validateNativeLevel({
        ...base,
        pattern: {
          colorCount: 4,
          segmentsPerRing: 12,
          colorsPerRing: 4,
          shift: 0,
          shiftDegrees: degrees,
        },
      }).some((error) => error.includes('pattern.shiftDegrees')),
    );
  }
  assert.deepEqual(base, before);
});

test('ball aiming and physical contacts use the geometrically shifted colored paths', () => {
  const source = mixed();
  source.shape = 'ring';
  source.motion.conveyorHoldFigure = true;
  source.motion.conveyorBeatsPerSlot = 0;
  const model = new NativeModel(setPatternShift(source, 17.25)),
    unshifted = new NativeModel(source);
  const target = model.rings[1].segments[0],
    point = target.points[Math.floor(target.points.length / 2)];
  const oldAim = unshifted.launchBall(target.color, 1),
    newAim = model.launchBall(target.color, 1);
  assert.ok(
    norm(displacement(oldAim.velocity, newAim.velocity)) > 0.1,
    'aim must follow the new target position',
  );
  // An isolated probe measures the collider at the shifted segment; it is not a solvability input.
  const contact = new NativeModel(setPatternShift(source, 17.25)),
    radius = 0.025,
    unit = { x: point.x / norm(point), y: point.y / norm(point) };
  const probe = contact.launchBall(
    target.color,
    1,
    { x: point.x - unit.x * 0.115, y: point.y - unit.y * 0.115 },
    { x: unit.x * 4, y: unit.y * 4 },
  );
  probe.radius = radius;
  let broken: number | undefined;
  for (let step = 0; step < 12; step++) {
    contact.step(1 / 120);
    for (const event of contact.drainEvents()) if (event.type === 'break') broken = event.segmentId;
  }
  assert.equal(broken, target.id, 'the moved rendered segment must also be the matching collider');
});

test('a fractional phase level verifies and independently replays through ordinary queue and tray inputs', () => {
  const level = generatePattern(setLayerCount(cloneLevel(), 4), {
    colorCount: 3,
    segmentsPerRing: 7,
    colorsPerRing: 3,
    shift: 0,
    shiftDegrees: 0.15,
  });
  const receipt = verifyPlayableLevel(level, { maxWallTimeMs: 30000, maxSimulationSeconds: 480 });
  assert.equal(receipt.status, 'verified-win', JSON.stringify(receipt.summaries));
  const model = new NativeModel(level),
    broken = new Set<number>();
  let input = 0,
    wins = 0;
  for (let step = 0; step < receipt.steps; step++) {
    while (receipt.inputs[input]?.step === step) {
      const action = receipt.inputs[input++];
      assert.equal(
        action.type === 'queue' ? model.fireQueue(action.index) : model.fireTray(action.index),
        true,
      );
    }
    model.step(receipt.fixedStep);
    for (const event of model.drainEvents()) {
      if (event.type === 'break') {
        assert.ok(!broken.has(event.segmentId!));
        broken.add(event.segmentId!);
      }
      if (event.type === 'win') wins++;
      assert.notEqual(event.type, 'booster');
    }
  }
  assert.equal(model.status, 'won');
  assert.equal(wins, 1);
  assert.equal(broken.size, 28);
  assert.equal(input, receipt.inputs.length);
});

for (const [requested, colors, expected] of [
  [7, 3, 6],
  [8, 3, 9],
  [24, 5, 20],
  [6, 4, 8],
])
  test(`equal spans normalize ${requested} segments / ${colors} colors to ${expected} and balance ammo`, () => {
    const source = setLayerCount(cloneLevel(), 4),
      options = {
        colorCount: colors,
        segmentsPerRing: requested,
        colorsPerRing: colors,
        shift: 0,
        shiftDegrees: 0.15,
        equalColorSpans: true,
      };
    const level = generatePattern(source, options);
    assert.equal(options.segmentsPerRing, requested, 'caller options stay unchanged');
    assert.equal(level.pattern!.segmentsPerRing, expected);
    assert.ok(level.rings.every((ring) => ring.length === expected));
    for (const ring of level.rings)
      for (const color of new Set(ring))
        assert.equal(ring.filter((c) => c === color).length, expected / colors);
    assert.deepEqual(validateNativeLevel(level), []);
    assert.ok(level.queue.every((ball) => ball.power === 3));
    assert.equal(level.queue.length, colors * Math.ceil(((expected / colors) * 4) / 3));
    assert.equal(inferPattern(level)!.equalColorSpans, true);
    assert.equal(inferPattern(setPatternShift(level, 0.16))!.equalColorSpans, true);
    const exact = generatePattern(source, { ...options, equalColorSpans: false });
    assert.ok(exact.rings.every((ring) => ring.length === requested));
    assert.equal(inferPattern(exact)!.equalColorSpans, false);
  });

test('invalid equal-span metadata is rejected without changing a level', () => {
  const source = mixed(),
    pattern = {
      colorCount: 3,
      segmentsPerRing: 7,
      colorsPerRing: 3,
      shift: 0,
      equalColorSpans: 'true',
    };
  assert.ok(
    validateNativeLevel({ ...source, pattern } as unknown as NativeLevel).some((error) =>
      error.includes('equalColorSpans'),
    ),
  );
  assert.throws(() => generatePattern(source, pattern as never), RangeError);
  assert.deepEqual(source, mixed());
});
