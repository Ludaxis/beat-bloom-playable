import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneLevel } from '../src/native/config';
import {
  NativeModel,
  validateNativeLevel,
  exportNativeLevel,
  importNativeLevel,
} from '../src/native/model';
import {
  buildQueue,
  colorDemand,
  normalizePlayableQueue,
  QUEUED_BALL_POWER,
} from '../src/native/queue';
import { verifyPlayableLevel } from '../src/native/pattern-editor';
import type { NativeEvent, NativeLevel } from '../src/native/types';

const STEP = 1 / 120;
function fixture(rings: number[][]): NativeLevel {
  const level = cloneLevel();
  level.rings = rings.map((r) => [...r]);
  level.arenaRingCapacity = Math.min(6, rings.length);
  level.maxRenderedRings = level.arenaRingCapacity;
  level.previewRingCount = 0;
  return normalizePlayableQueue(level, true);
}
function advance(model: NativeModel, seconds: number): NativeEvent[] {
  const events: NativeEvent[] = [];
  for (let i = 0; i < Math.ceil(seconds / STEP); i++) {
    model.step(STEP);
    events.push(...model.drainEvents());
  }
  return events;
}

test('three [0,1,2] rings use exactly three power-three balls, one queue row', () => {
  const rings = [
      [0, 1, 2],
      [0, 1, 2],
      [0, 1, 2],
    ],
    queue = buildQueue(rings, 3);
  assert.equal(QUEUED_BALL_POWER, 3);
  assert.deepEqual(
    queue,
    [0, 1, 2].map((color) => ({ color, power: 3, mystery: false })),
  );
  const model = new NativeModel(fixture(rings));
  assert.deepEqual(
    model.queueBalls().map((b) => [b.column, b.row]),
    [
      [0, 0],
      [1, 0],
      [2, 0],
    ],
  );
});

test('global demands 1,4,5 round up while preserving authored rings and interleaving batches', () => {
  const rings = [
      [2, 1, 0, 2, 1],
      [1, 2, 1, 2, 2],
    ],
    source = JSON.stringify(rings);
  assert.deepEqual(colorDemand(rings, 4), [1, 4, 5, 0]);
  const queue = buildQueue(rings, 4);
  assert.deepEqual(
    queue.map((b) => b.color),
    [2, 1, 0, 1, 2],
  );
  assert.deepEqual(
    [0, 1, 2, 3].map((color) => queue.filter((b) => b.color === color).length),
    [1, 2, 2, 0],
  );
  assert.ok(queue.every((b) => b.power === 3 && !b.mystery));
  assert.equal(JSON.stringify(rings), source);
  assert.deepEqual(
    buildQueue([[0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2]], 3).map(
      (b) => b.color,
    ),
    [0, 1, 2, 0, 1, 2, 0, 1, 2],
  );
});

test('credits cross ring boundaries and gaps or unused colors never create balls', () => {
  assert.deepEqual(
    buildQueue([[0], [1], [0], [1], [0], [1]], 4).map((b) => b.color),
    [0, 1],
  );
  assert.deepEqual(
    buildQueue(
      [
        [-1, 2, -1],
        [2, 2, 2],
      ],
      4,
    ),
    [
      { color: 2, power: 3, mystery: false },
      { color: 2, power: 3, mystery: false },
    ],
  );
  assert.deepEqual(buildQueue([[-1], [-1]], 3), []);
  assert.throws(() => buildQueue([[3]], 3), RangeError);
});

test('normalization is immutable and idempotent, retaining a valid minimal authored queue order', () => {
  const level = fixture([
    [0, 1, 2],
    [0, 1, 2],
    [0, 1, 2],
  ]);
  level.queue.reverse();
  level.queue[0].mystery = true;
  delete level.queuePolicy;
  const before = JSON.stringify(level),
    next = normalizePlayableQueue(level);
  assert.equal(JSON.stringify(level), before);
  assert.equal(next.queuePolicy, 'fixed-three');
  assert.deepEqual(
    next.queue.map((b) => b.color),
    [2, 1, 0],
  );
  assert.ok(next.queue.every((b) => !b.mystery));
  assert.deepEqual(normalizePlayableQueue(next), next);
  assert.deepEqual(next.rings, level.rings);
  assert.deepEqual(next.palette, level.palette);
  assert.deepEqual(
    normalizePlayableQueue(next, true).queue.map((b) => b.color),
    [0, 1, 2],
  );
  assert.deepEqual(importNativeLevel(exportNativeLevel(next)), next);
});

test('strict fixed-three validation enforces minimal counts, while structural validation permits automatic queue rebuilding', () => {
  const level = fixture([[0], [1, 1, 1, 1], [2, 2, 2, 2, 2]]);
  assert.deepEqual(validateNativeLevel(level), []);
  const partial = cloneLevel(level);
  partial.queue[0].power = 1;
  assert.match(validateNativeLevel(partial).join('\n'), /start with power 3/);
  assert.deepEqual(validateNativeLevel(partial, { queueBalance: false }), []);
  const extra = cloneLevel(level);
  extra.queue.push({ color: 0, power: 3, mystery: false });
  assert.match(validateNativeLevel(extra).join('\n'), /exactly 1 queued balls/);
  const stale = cloneLevel(level);
  stale.rings.push([0, 0, 0, 0, 0]);
  assert.ok(validateNativeLevel(stale).length);
  assert.deepEqual(validateNativeLevel(stale, { queueBalance: false }), []);
  assert.deepEqual(validateNativeLevel(normalizePlayableQueue(stale)), []);
  for (const bad of [
    { ...level, queue: [null] },
    { ...level, queue: [{ color: 0, power: 0, mystery: false }] },
    { ...level, queuePolicy: 'other' },
  ])
    assert.ok(validateNativeLevel(bad, { queueBalance: false }).length);
  assert.match(
    validateNativeLevel({ ...level, rings: [[-1, -1], [-1]] }, { queueBalance: false }).join('\n'),
    /at least one colored segment/,
  );
  const raw = cloneLevel();
  assert.deepEqual(validateNativeLevel(raw), []);
  raw.queue[0].power--;
  assert.match(validateNativeLevel(raw).join('\n'), /preserve exact per-color power/);
});

test('clearing an inner color piece retains the same ball when future rings still need its color', () => {
  const model = new NativeModel(fixture([[0], [1, 1, 1], [0, 0]]));
  assert.equal(model.fireQueue(0), true);
  const ball = model.balls[0];
  let firstBreak: NativeEvent | undefined;
  for (let i = 0; i < 120 * 8 && !firstBreak; i++) {
    const events = advance(model, STEP);
    firstBreak = events.find((e) => e.type === 'break' && e.color === 0);
  }
  assert.ok(firstBreak);
  assert.equal(firstBreak.power, 2);
  assert.equal(ball.power, 2);
  assert.notEqual(ball.state, 'spent');
  assert.equal(model.rings[2].segments.filter((s) => s.alive).length, 2);
});

for (const count of [1, 4, 5])
  test(`ordinary inputs clear ${count} pieces with power-three queue and discard only completed-color surplus`, () => {
    const level = fixture([Array<number>(count).fill(0), [1, 1, 1]]),
      model = new NativeModel(level);
    const receipt = verifyPlayableLevel(level, { maxSimulationSeconds: 180, maxWallTimeMs: 30000 });
    assert.equal(receipt.status, 'verified-win', JSON.stringify(receipt.summaries));
    const all: NativeEvent[] = [];
    for (let step = 0; step < receipt.steps; step++) {
      for (const input of receipt.inputs.filter((input) => input.step === step))
        assert.equal(
          input.type === 'queue' ? model.fireQueue(input.index) : model.fireTray(input.index),
          true,
        );
      model.step(receipt.fixedStep);
      all.push(...model.drainEvents());
      assert.ok(model.balls.every((ball) => ball.power >= 0));
      assert.ok(model.queueBalls().every((ball) => ball.power === 3));
      assert.ok(model.activeBalls.length <= model.activeCapacity);
      assert.ok(model.trayBalls.length <= model.level.trayCapacity);
    }
    assert.equal(model.status, 'won');
    assert.equal(model.remaining, 0);
    const breaks = all.filter((e) => e.type === 'break');
    assert.equal(breaks.length, count + 3);
    assert.equal(new Set(breaks.map((e) => e.segmentId)).size, count + 3);
    assert.equal(all.filter((e) => e.type === 'win').length, 1);
    const spent = all.filter((e) => e.type === 'spent');
    assert.equal(new Set(spent.map((e) => e.ballId)).size, spent.length);
    assert.equal(
      spent
        .filter((e) => e.reason === 'color_complete')
        .reduce((sum, e) => sum + (e.power ?? 0), 0),
      Math.ceil(count / 3) * 3 - count,
    );
    assert.ok(model.balls.every((ball) => ball.state === 'spent' && ball.power === 0));
  });

test('fixed-three playables reject removed wildcard booster without mutating queue or runtime', () => {
  const model = new NativeModel(fixture([[0, 1, 2]])),
    before = JSON.stringify(model.snapshot()),
    queue = model.queueBalls();
  assert.equal(model.fireRainbow(), false);
  assert.equal(JSON.stringify(model.snapshot()), before);
  assert.deepEqual(model.queueBalls(), queue);
  assert.deepEqual(model.drainEvents(), []);
});

function fillTray(): NativeModel {
  const level = fixture([[0], [1, 1, 1], [0, 0, 0], Array<number>(9).fill(2)]);
  // A legal authored order puts an early red ball behind the next color, then fills the tray
  // through six ordinary queue clicks. No ball positions, states, or piece flags are edited.
  level.queue = [0, 2, 2, 0, 1, 2].map((color) => ({ color, power: 3, mystery: false }));
  const model = new NativeModel(level);
  for (const [column, seconds] of [
    [0, 1],
    [1, 0.5],
    [2, 0.5],
    [0, 0.5],
    [1, 0.5],
    [2, 0.6],
  ]) {
    assert.equal(model.fireQueue(column), true);
    advance(model, seconds);
  }
  assert.equal(model.trayBalls.length, 3);
  assert.ok(model.trayBalls.every((ball) => ball.state === 'stored'));
  return model;
}

test('last-color clear frees a full tray, compacts only remaining balls, and those balls can still complete the level', () => {
  const model = fillTray(),
    red = model.trayBalls[0],
    blue = model.trayBalls.slice(1);
  assert.equal(red.color, 0);
  assert.equal(red.power, 2);
  let retirement: NativeEvent | undefined;
  for (let i = 0; i < 120 * 30 && !retirement; i++)
    retirement = advance(model, STEP).find((e) => e.type === 'spent' && e.ballId === red.id);
  assert.ok(retirement);
  assert.equal(retirement.reason, 'color_complete');
  assert.equal(retirement.power, 2);
  assert.equal(red.state, 'spent');
  assert.equal(red.power, 0);
  assert.equal(red.slot, -1);
  assert.deepEqual(
    model.trayBalls.map((ball) => [ball.id, ball.power, ball.slot]),
    blue.map((ball, index) => [ball.id, 3, index]),
  );
  const all: NativeEvent[] = [];
  for (let i = 0; i < 120 * 90 && model.status === 'playing'; i++) {
    if (!model.isAnimatingShot && model.activeBalls.length < model.activeCapacity) {
      const stored = model.trayBalls.find((ball) => ball.state === 'stored');
      if (stored) model.fireTray(stored.slot);
    }
    all.push(...advance(model, STEP));
  }
  assert.equal(model.status, 'won');
  assert.equal(model.remaining, 0);
  assert.equal(all.filter((e) => e.type === 'win').length, 1);
  assert.ok(model.balls.every((ball) => ball.state === 'spent' && ball.power === 0));
});

test('a surplus tray ball relaunched just before its color clears retires during incoming flight without a late launch', () => {
  const baseline = fillTray();
  let clearAt = 0;
  for (let i = 0; i < 120 * 30 && !clearAt; i++) {
    const retirement = advance(baseline, STEP).find(
      (e) => e.type === 'spent' && e.reason === 'color_complete' && e.color === 0,
    );
    if (retirement) clearAt = retirement.time;
  }
  assert.ok(clearAt);
  const model = fillTray(),
    red = model.trayBalls[0];
  while (model.time < clearAt - model.config.timing.incomingSeconds / 2) advance(model, STEP);
  assert.ok(
    model.activeBalls.length < model.activeCapacity,
    'relaunch must not displace the active finisher',
  );
  assert.equal(model.fireTray(red.slot), true);
  assert.equal(red.state, 'incoming');
  const events = advance(model, model.config.timing.incomingSeconds + 0.2);
  const retirement = events.find((e) => e.type === 'spent' && e.ballId === red.id);
  assert.ok(retirement);
  assert.equal(retirement.reason, 'color_complete');
  assert.equal(red.state, 'spent');
  assert.equal(red.power, 0);
  assert.equal(
    events.some((e) => e.type === 'launch' && e.ballId === red.id),
    false,
    'retired flight cannot become active later',
  );
  assert.ok(model.trayBalls.every((ball) => ball.color === 2));
});
