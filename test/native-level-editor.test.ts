import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneLevel, DEFAULT_NATIVE_LEVEL } from '../src/native/config';
import { NativeModel, validateNativeLevel } from '../src/native/model';
import { setLayerCount } from '../src/native/level-editor';
import type { NativeLevel } from '../src/native/types';

const STEP = 1 / 120;
function advance(model: NativeModel, seconds: number): void {
  for (let i = 0; i < Math.ceil(seconds / STEP); i++) model.step(STEP);
}
function demand(level: NativeLevel): number[] {
  return level.palette.map((_, color) => level.rings.flat().filter((c) => c === color).length);
}
function supply(level: NativeLevel): number[] {
  return level.palette.map((_, color) =>
    level.queue.filter((b) => b.color === color).reduce((sum, b) => sum + b.power, 0),
  );
}
function assertRuntimeConservation(model: NativeModel): void {
  model.level.palette.forEach((_, color) => {
    const pieces = model.rings
      .flatMap((r) => r.segments)
      .filter((s) => s.alive && s.color === color).length;
    const ammo =
      model
        .queueBalls()
        .filter((b) => b.color === color)
        .reduce((s, b) => s + b.power, 0) +
      model.balls.filter((b) => b.color === color).reduce((s, b) => s + b.power, 0);
    const surplus = supply(model.level)[color] - demand(model.level)[color];
    assert.ok(
      ammo >= pieces && ammo <= pieces + surplus,
      `Color ${color} stays within its original rounded budget at ${model.time.toFixed(3)}s`,
    );
    if (pieces === 0) assert.equal(ammo, 0, 'completed colors retire their remaining power');
  });
}

test('unchanged layer count preserves the complete authored level without mutating its input', () => {
  const before = cloneLevel();
  const after = setLayerCount(before, before.rings.length);
  assert.deepEqual(after, before);
  assert.notEqual(after, before);
  after.rings[0][0] = 1;
  assert.deepEqual(before, DEFAULT_NATIVE_LEVEL);
});

for (const count of [1, 2, 6, 18, 24])
  test(`resizing to ${count} colored layers preserves patterns and per-color ammunition`, () => {
    const original = cloneLevel();
    const level = setLayerCount(original, count);
    assert.equal(level.rings.length, count);
    for (let i = 0; i < count; i++)
      assert.deepEqual(level.rings[i], original.rings[i % original.rings.length]);
    assert.ok(level.queue.every((ball) => ball.power === 3));
    assert.deepEqual(
      demand(level).map((pieces) => Math.ceil(pieces / 3) * 3),
      supply(level),
    );
    assert.deepEqual(validateNativeLevel(level), []);
    assert.ok(level.arenaRingCapacity <= count);
    assert.ok(level.maxRenderedRings >= level.arenaRingCapacity && level.maxRenderedRings <= count);
    assert.ok(level.previewRingCount <= count - level.arenaRingCapacity);
    const earlyColors = new Set(level.rings[0].filter((c) => c >= 0));
    assert.ok(level.queue.slice(0, level.queueColumns).every((b) => earlyColors.has(b.color)));
    for (const lane of level.stemLanes) {
      const available = lane.colors.reduce((sum, color) => sum + demand(level)[color], 0);
      assert.ok(lane.requiredBreaks >= 1);
      assert.ok(available === 0 ? lane.requiredBreaks === 1 : lane.requiredBreaks <= available);
    }
    assert.deepEqual(original, DEFAULT_NATIVE_LEVEL);
    assert.deepEqual(
      level,
      setLayerCount(original, count),
      'same source and count produce the same puzzle',
    );
  });

test('layer-count editor rejects invalid values without changing the authored source', () => {
  const before = cloneLevel();
  for (const count of [0, 25, -1, 1.5, NaN, Infinity])
    assert.throws(() => setLayerCount(before, count), RangeError);
  assert.deepEqual(before, DEFAULT_NATIVE_LEVEL);
});

for (const count of [1, 6, 24])
  test(`ordinary queue and tray inputs complete an edited ${count}-layer puzzle`, () => {
    const level = setLayerCount(cloneLevel(), count);
    const model = new NativeModel(level);
    let nextInput = 0,
      lastRemaining = model.remaining,
      lastProgress = 0;
    const brokenIds = new Set<number>();
    for (let frame = 0; frame < 120 * 480 && model.status === 'playing'; frame++) {
      if (model.time >= nextInput && !model.isAnimatingShot) {
        const inner = model.rings.find((r) => r.eligible && r.segments.some((s) => s.alive));
        const needed = new Set(inner?.segments.filter((s) => s.alive).map((s) => s.color));
        if (
          model.activeBalls.length < model.activeCapacity ||
          (model.time - lastProgress > 8 && model.trayBalls.length < level.trayCapacity)
        ) {
          const stored = model.trayBalls.find((b) => b.state === 'stored' && needed.has(b.color));
          const front = model.queueBalls().filter((b) => b.row === 0);
          const queued = front.find((b) => needed.has(b.color)) ?? front[0];
          if (stored) model.fireTray(stored.slot);
          else if (queued) model.fireQueue(queued.column);
          nextInput = model.time + 0.7;
        }
      }
      model.step(STEP);
      for (const e of model.drainEvents())
        if (e.type === 'break') {
          assert.ok(!brokenIds.has(e.segmentId!), 'an authored piece can be broken only once');
          brokenIds.add(e.segmentId!);
        }
      if (model.remaining !== lastRemaining) {
        lastRemaining = model.remaining;
        lastProgress = model.time;
      }
      if (frame % 120 === 0) assertRuntimeConservation(model);
    }
    assert.equal(model.status, 'won', JSON.stringify(model.snapshot()));
    assert.equal(brokenIds.size, level.rings.flat().filter((c) => c >= 0).length);
    assertRuntimeConservation(model);
  });

test('an occupied full-tray slot swaps with the oldest active ball and relaunches become newest', () => {
  const level = cloneLevel();
  // Real authored ammunition, reordered only for this fixture: green/blue cannot clear the first
  // six red/yellow rings, so six ordinary launches deterministically fill active capacity and tray.
  const laterColor = (color: number) => color === 1 || color === 2;
  level.queue.sort((a, b) => Number(laterColor(b.color)) - Number(laterColor(a.color)));
  const model = new NativeModel(level);
  for (let shot = 0; shot < 6; shot++) {
    assert.equal(model.fireQueue(shot % 3), true);
    advance(model, 0.4);
  }
  advance(model, 0.6);
  assert.equal(model.activeBalls.length, 3);
  assert.equal(model.trayBalls.length, 3);
  assert.equal(model.remaining, 96);
  const firedAgain = new Set<number>();
  for (let swap = 0; swap < 3; swap++) {
    const selected = model.trayBalls.find((b) => b.state === 'stored' && !firedAgain.has(b.id))!;
    assert.ok(selected, 'there must be an occupied slot to tap');
    const oldest = [...model.activeBalls].sort((a, b) => a.launchedAt - b.launchedAt)[0];
    const selectedId = selected.id,
      oldestId = oldest.id,
      selectedPower = selected.power;
    const selectedFrom = { ...selected.position };
    assert.equal(
      model.fireTray(selected.slot),
      true,
      'a full tray must not block its own outgoing ball',
    );
    assert.equal(selected.state, 'incoming');
    assert.equal(oldest.state, 'banking');
    assert.equal(model.activeBalls.length, 3);
    assert.equal(model.trayBalls.length, 3);
    advance(model, 0.1);
    assert.notDeepEqual(
      selected.position,
      selectedFrom,
      'the selected tray ball visibly moves toward center',
    );
    advance(model, 0.6);
    assert.equal(selected.state, 'active');
    assert.equal(selected.power, selectedPower);
    assert.equal(oldest.state, 'stored');
    assert.equal(
      [...model.activeBalls].sort((a, b) => a.launchedAt - b.launchedAt).at(-1)!.id,
      selectedId,
    );
    assert.ok(model.trayBalls.some((b) => b.id === oldestId));
    assert.equal(new Set(model.trayBalls.map((b) => b.slot)).size, 3);
    assert.equal(
      model.balls.length,
      6,
      'a tray swap reuses bodies rather than duplicating ammunition',
    );
    assertRuntimeConservation(model);
    firedAgain.add(selectedId);
  }
});

test('visible rings beyond the current break window remain solid after increasing visible layers', () => {
  const level = cloneLevel();
  level.shape = 'ring';
  level.arenaRingCapacity = 12;
  level.maxRenderedRings = 12;
  level.previewRingCount = 0;
  level.motion.phaseDegrees = 0;
  level.motion.conveyorBeatsPerSlot = 0;
  level.motion.conveyorHoldFigure = true;
  const model = new NativeModel(level);
  // A small isolated probe between two rings measures this contact without touching an adjacent
  // surface. Explicit test-only body placement avoids a long unrelated path through six inner rings.
  const outer = model.rings[6];
  assert.equal(outer.visible, true);
  assert.equal(outer.eligible, false);
  const ball = model.launchBall(
    outer.segments[0].color,
    3,
    { x: outer.radius - 0.2, y: 0 },
    { x: 4, y: 0 },
  );
  ball.radius = 0.035;
  let hit = false;
  for (let i = 0; i < 20; i++) {
    model.step(STEP);
    hit ||= model.drainEvents().some((e) => e.type === 'impact' && e.ringId === outer.id);
    // Inspect this contact, before a faster rebound can reach a different, breakable ring.
    if (hit) break;
  }
  assert.ok(hit, 'the visible outer ring must provide a physical contact');
  assert.ok(ball.velocity.x < 0, 'a matching color still rebounds until this ring is breakable');
  assert.equal(ball.power, 3);
  assert.equal(model.remaining, 96);
});

test('a 24-layer level with twelve visible arena rings remains completable at native thickness', () => {
  const level = setLayerCount(cloneLevel(), 24);
  level.arenaRingCapacity = 12;
  level.maxRenderedRings = 14;
  level.previewRingCount = 2;
  const model = new NativeModel(level);
  let nextInput = 0,
    lastRemaining = model.remaining,
    lastProgress = 0;
  for (let frame = 0; frame < 120 * 480 && model.status === 'playing'; frame++) {
    if (model.time >= nextInput && !model.isAnimatingShot) {
      const inner = model.rings.find((r) => r.eligible && r.segments.some((s) => s.alive));
      const needed = new Set(inner?.segments.filter((s) => s.alive).map((s) => s.color));
      if (
        model.activeBalls.length < model.activeCapacity ||
        (model.time - lastProgress > 8 && model.trayBalls.length < level.trayCapacity)
      ) {
        const stored = model.trayBalls.find((b) => b.state === 'stored' && needed.has(b.color));
        const front = model.queueBalls().filter((b) => b.row === 0);
        const queued = front.find((b) => needed.has(b.color)) ?? front[0];
        if (stored) model.fireTray(stored.slot);
        else if (queued) model.fireQueue(queued.column);
        nextInput = model.time + 0.7;
      }
    }
    model.step(STEP);
    model.drainEvents();
    if (model.remaining !== lastRemaining) {
      lastRemaining = model.remaining;
      lastProgress = model.time;
    }
    if (frame % 120 === 0) assertRuntimeConservation(model);
  }
  assert.equal(model.status, 'won', JSON.stringify(model.snapshot()));
  assert.equal(model.remaining, 0);
  assertRuntimeConservation(model);
});
