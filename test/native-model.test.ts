import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NativeModel,
  validateNativeLevel,
  importNativeLevel,
  exportNativeLevel,
} from '../src/native/model';
import { cloneLevel, NATIVE_CONFIG } from '../src/native/config';
import { pointInsidePolygon } from '../src/native/geometry';
import type { NativeEvent, NativeLevel, NativeShape } from '../src/native/types';

const STEP = 1 / 120;
function advance(model: NativeModel, seconds: number): NativeEvent[] {
  const events: NativeEvent[] = [];
  for (let i = 0; i < Math.ceil(seconds / STEP); i++) {
    model.step(STEP);
    events.push(...model.drainEvents());
  }
  return events;
}
function assertPower(model: NativeModel): void {
  for (let color = 0; color < model.level.palette.length; color++) {
    const remaining = model.rings
      .flatMap((r) => r.segments)
      .filter((s) => s.alive && s.color === color).length;
    const power =
      model
        .queueBalls()
        .filter((b) => b.color === color)
        .reduce((n, b) => n + b.power, 0) +
      model.balls.filter((b) => b.color === color).reduce((n, b) => n + b.power, 0);
    assert.equal(
      power,
      remaining,
      `color ${color} at ${model.time.toFixed(3)}s must conserve power`,
    );
  }
  assert.ok(model.activeBalls.length <= model.activeCapacity);
  assert.ok(model.trayBalls.length <= model.level.trayCapacity);
}

test('queue input visibly travels before physics starts and cannot duplicate a ball mid-flight', () => {
  const model = new NativeModel();
  assert.equal(model.fireQueue(2), true);
  assert.equal(model.fireQueue(2), false);
  const ball = model.balls[0];
  const initial = { ...ball.position };
  assert.equal(ball.state, 'incoming');
  assert.equal(model.snapshot().queue, 30);
  advance(model, 0.1);
  assert.equal(ball.state, 'incoming');
  assert.ok(ball.position.y < initial.y && ball.position.y > 0);
  const events = advance(model, 0.3);
  assert.equal(ball.state, 'active');
  assert.equal(events.filter((e) => e.type === 'launch').length, 1);
  assert.equal(ball.power, 3);
  assert.equal(ball.color, 3);
  assertPower(model);
});

test('free flight accelerates under project gravity independently of render frame rate', () => {
  const a = new NativeModel(),
    b = new NativeModel();
  const ba = a.launchBall(0, 3, { x: 0, y: 0 }, { x: 1, y: -2 });
  const bb = b.launchBall(0, 3, { x: 0, y: 0 }, { x: 1, y: -2 });
  for (let i = 0; i < 12; i++) a.step(STEP);
  for (let i = 0; i < 6; i++) b.step(1 / 60);
  assert.ok(Math.abs(ba.velocity.y - (-2 + NATIVE_CONFIG.physics.gravity * 0.1)) < 1e-9);
  assert.ok(Math.abs(ba.position.x - 0.1) < 1e-9);
  assert.deepEqual(ba.position, bb.position);
  assert.deepEqual(ba.velocity, bb.velocity);
  assert.ok(ba.position.y > -0.2, 'gravity curves the trajectory downward');
});

test('wrong-color contacts bounce without deleting pieces, spending power or escaping the wall', () => {
  const model = new NativeModel();
  const ball = model.launchBall(1, 3, { x: 0, y: 0 }, { x: 4, y: 0 });
  const events = advance(model, 8);
  assert.ok(
    events.some((e) => e.type === 'impact'),
    'fixture must make real contacts',
  );
  assert.equal(events.filter((e) => e.type === 'break').length, 0);
  assert.equal(model.remaining, 96);
  assert.equal(ball.power, 3);
  assert.ok(pointInsidePolygon(ball.position, model.wallPoints));
  assert.ok(Math.hypot(ball.velocity.x, ball.velocity.y) <= NATIVE_CONFIG.physics.maxSpeed + 1e-8);
});

test('overlapping ball launches do not shove each other, matching native BallSeparation', () => {
  const solo = new NativeModel(),
    pair = new NativeModel();
  const a = solo.launchBall(0, 3, { x: 0, y: 0 }, { x: 1, y: -2 });
  const b = pair.launchBall(0, 3, { x: 0, y: 0 }, { x: 1, y: -2 });
  pair.launchBall(3, 3, { x: 0, y: 0 }, { x: -1, y: 1 });
  advance(solo, 0.2);
  advance(pair, 0.2);
  assert.deepEqual(a.position, b.position);
  assert.deepEqual(a.velocity, b.velocity);
});

test('full active field banks its oldest ball with an actual flight and preserves reserve power', () => {
  const model = new NativeModel();
  for (let i = 0; i < 3; i++) {
    assert.equal(model.fireQueue(0), true);
    advance(model, 0.4);
  }
  const oldest = [...model.activeBalls].sort((a, b) => a.launchedAt - b.launchedAt)[0];
  const power = oldest.power;
  assert.equal(model.fireQueue(2), true);
  assert.equal(oldest.state, 'banking');
  const from = { ...oldest.position };
  advance(model, 0.1);
  assert.equal(oldest.state, 'banking');
  assert.notDeepEqual(oldest.position, from);
  advance(model, 0.65);
  assert.equal(oldest.state, 'stored');
  assert.equal(oldest.power, power);
  assert.equal(model.fireTray(oldest.slot), true);
  assert.equal(oldest.state, 'incoming');
  assertPower(model);
});

test('valid shape/thickness/palette edits export and import without losing authored data', () => {
  const level = cloneLevel();
  level.shape = 'flower';
  level.flowerPetals = 7;
  level.lineThickness = 0.1;
  level.palette[0] = 0xea00ff;
  level.name = 'Designer edit';
  assert.deepEqual(validateNativeLevel(level), []);
  assert.deepEqual(importNativeLevel(exportNativeLevel(level)), level);
  assert.equal(new NativeModel(level).remaining, 96);
});

test('rainbow booster is single-use, breaks five actual segments and debits matching queued power', () => {
  const model = new NativeModel();
  const source = JSON.stringify(model.level);
  assert.equal(model.fireRainbow(), true);
  assert.equal(model.fireRainbow(), false);
  assert.equal(model.rainbowAvailable, false);
  const events = advance(model, 8),
    breaks = events.filter((e) => e.type === 'break');
  assert.equal(breaks.length, 5);
  assert.ok(
    breaks.every((e) => e.color >= 0 && e.color < 4),
    'musical/VFX events carry the broken segment color, not wildcard ID',
  );
  assert.equal(model.remaining, 91);
  assertPower(model);
  assert.equal(
    JSON.stringify(model.level),
    source,
    'runtime queue debit must not mutate designer source',
  );
});

test('visible extra-ball booster expands capacity once without creating ammunition or modifying level source', () => {
  const model = new NativeModel(),
    source = JSON.stringify(model.level);
  assert.equal(model.snapshot().activeCapacity, 3);
  assert.equal(model.applyExtraBall(), true);
  assert.equal(model.applyExtraBall(), false);
  assert.equal(model.snapshot().activeCapacity, 4);
  assert.equal(model.snapshot().queue, 31);
  for (let i = 0; i < 4; i++) {
    assert.equal(model.fireQueue(i % 3), true);
    advance(model, 0.4);
  }
  assert.equal(model.trayBalls.length, 0, 'fourth ball stays active after capacity boost');
  assert.equal(model.activeBalls.length, 4);
  assertPower(model);
  assert.equal(JSON.stringify(model.level), source);
});

test('invalid nested imports produce validation errors without throwing or contaminating defaults', () => {
  const cases: unknown[] = [
    null,
    {},
    { ...cloneLevel(), queue: [null] },
    { ...cloneLevel(), sections: [null] },
    { ...cloneLevel(), stemLanes: [null] },
    { ...cloneLevel(), motion: null },
  ];
  const incomplete = cloneLevel();
  delete (incomplete.motion as unknown as Record<string, unknown>).flipEaseBeats;
  cases.push(incomplete);
  const nan = cloneLevel();
  nan.motion.conveyorPulseDurationBeats = Number.NaN;
  cases.push(nan);
  const fractional = cloneLevel();
  fractional.queueColumns = 2.5;
  cases.push(fractional);
  const impossible = cloneLevel();
  impossible.queue[0].power = 1;
  cases.push(impossible);
  for (const value of cases) {
    let errors: string[] = [];
    assert.doesNotThrow(() => {
      errors = validateNativeLevel(value);
    });
    assert.ok(errors.length > 0, 'invalid designer data must be rejected');
  }
  assert.deepEqual(validateNativeLevel(cloneLevel()), []);
});

// This is an automated player using normal queue/tray inputs. It never changes physics, removes
// a segment, reads the future trajectory, changes color/power, or invokes launchBall/completion hooks.
function playLevel(level: NativeLevel): { time: number; shots: number; events: NativeEvent[] } {
  const model = new NativeModel(level);
  const all: NativeEvent[] = [];
  let next = 0,
    last = model.remaining,
    lastProgress = 0;
  for (let i = 0; i < 120 * 240; i++) {
    if (model.time >= next) {
      const wanted =
        model.rings
          .find((r) => r.eligible && r.segments.some((s) => s.alive))
          ?.segments.filter((s) => s.alive)
          .map((s) => s.color) ?? [];
      if (
        model.activeBalls.length < level.activeCapacity ||
        (model.time - lastProgress > 8 && model.trayBalls.length < level.trayCapacity)
      ) {
        const stored = model.trayBalls.find(
          (b) => b.state === 'stored' && wanted.includes(b.color),
        );
        const fronts = model.queueBalls().filter((q) => q.row === 0),
          queued = fronts.find((q) => wanted.includes(q.color)) ?? fronts[0];
        if (stored) model.fireTray(stored.slot);
        else if (queued) model.fireQueue(queued.column);
        next = model.time + 1;
      }
    }
    model.step(STEP);
    all.push(...model.drainEvents());
    if (model.remaining !== last) {
      last = model.remaining;
      lastProgress = model.time;
    }
    if (i % 120 === 0) assertPower(model);
    if (model.status !== 'playing') break;
  }
  assert.equal(model.status, 'won', `${level.shape}: ${JSON.stringify(model.snapshot())}`);
  assert.equal(model.remaining, 0);
  assertPower(model);
  const breaks = all.filter((e) => e.type === 'break');
  assert.equal(breaks.length, 96);
  assert.equal(
    new Set(breaks.map((e) => e.segmentId)).size,
    96,
    'every authored segment is broken exactly once',
  );
  assert.equal(all.filter((e) => e.type === 'win').length, 1);
  assert.equal(all.filter((e) => e.type === 'ringClear').length, 12);
  for (const lane of level.stemLanes) {
    const unlock = all.find((e) => e.type === 'unlock' && e.stem === lane.stem);
    assert.ok(unlock);
    const count = breaks.filter(
      (e) => e.time <= unlock.time && lane.colors.includes(e.color),
    ).length;
    assert.ok(count >= lane.requiredBreaks);
  }
  return { time: model.time, shots: model.shots, events: all };
}
for (const shape of ['hexagon', 'heart', 'flower', 'ring'] as NativeShape[])
  test(`complete all 96 native pieces on ${shape} using ordinary queue/tray inputs`, () => {
    const level = cloneLevel();
    level.shape = shape;
    const result = playLevel(level);
    assert.ok(result.shots >= 31);
  });
for (const thickness of [0.07, 0.28])
  test(`editable line thickness ${thickness} retains a completable physical level`, () => {
    const level = cloneLevel();
    level.lineThickness = thickness;
    playLevel(level);
  });
