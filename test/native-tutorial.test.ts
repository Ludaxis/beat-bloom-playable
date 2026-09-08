import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneLevel, NATIVE_CONFIG } from '../src/native/config';
import { NativeModel } from '../src/native/model';
import { normalizePlayableQueue } from '../src/native/queue';
import {
  NativeTutorial,
  recommendTutorialHint,
  TUTORIAL_CONFIG,
  type TutorialHint,
} from '../src/native/tutorial';

const STEP = 1 / 120,
  visible = { enabled: true, blocked: false };
function fixture(rings: number[][]): NativeModel {
  const level = cloneLevel();
  level.rings = rings.map((r) => [...r]);
  level.arenaRingCapacity = Math.min(6, rings.length);
  level.maxRenderedRings = level.arenaRingCapacity;
  level.previewRingCount = 0;
  return new NativeModel(normalizePlayableQueue(level, true));
}
function advance(model: NativeModel, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / STEP); i++) model.step(STEP);
}
function idle(
  tutorial: NativeTutorial,
  model: NativeModel,
  seconds: number,
  state = visible,
): TutorialHint | null {
  let hint: TutorialHint | null = null;
  for (let i = 0; i < Math.round(seconds / 0.1); i++) {
    if (!state.blocked) advance(model, 0.1);
    hint = tutorial.update(model, 0.1, state);
  }
  return hint;
}
function fullTray(): NativeModel {
  const level = normalizePlayableQueue(cloneLevel(), true),
    remaining = [...level.queue],
    first = [];
  for (const color of [0, 1, 2, 1, 2, 1])
    first.push(
      remaining.splice(
        remaining.findIndex((ball) => ball.color === color),
        1,
      )[0],
    );
  level.queue = [...first, ...remaining];
  const model = new NativeModel(level);
  for (const column of [0, 1, 2, 0, 1, 2]) {
    assert.equal(model.fireQueue(column), true);
    advance(model, 0.425);
  }
  advance(model, 0.6);
  assert.equal(model.activeBalls.length, 3);
  assert.equal(model.trayBalls.length, 3);
  return model;
}

test('initial hand waits for visible gameplay time and points at the real front-row ball center', () => {
  const model = fixture([
      [0, 1, 2],
      [0, 1, 2],
      [0, 1, 2],
    ]),
    tutorial = new NativeTutorial();
  assert.equal(idle(tutorial, model, 1.1), null);
  const hint = idle(tutorial, model, 0.1);
  assert.ok(hint);
  assert.equal(hint.text, TUTORIAL_CONFIG.copy.initial);
  assert.equal(hint.kind, 'queue');
  assert.equal(hint.key, `queue:${hint.sourceIndex}`);
  assert.deepEqual(hint.position, {
    x: model.config.view.queueX[hint.index],
    y: model.config.view.queueY,
  });
  assert.equal(model.queueBalls().find((ball) => ball.sourceIndex === hint.sourceIndex)?.row, 0);
  assert.equal(model.fireQueue(hint.index), true);
});

test('interaction immediately removes a hint and waits five visible idle seconds before reacquiring', () => {
  const model = fixture([
      [0, 1, 2],
      [0, 1, 2],
      [0, 1, 2],
    ]),
    tutorial = new NativeTutorial();
  const hint = idle(tutorial, model, 1.2);
  assert.ok(hint);
  tutorial.interact();
  assert.equal(tutorial.snapshot().hint, null);
  assert.equal(tutorial.snapshot().idleSeconds, 0);
  assert.equal(idle(tutorial, model, 4.9), null);
  const next = idle(tutorial, model, 0.1);
  assert.ok(next);
  assert.equal(next.text, TUTORIAL_CONFIG.copy.match);
});

test('hidden, paused, intro, or disabled intervals hide the hand without accruing idle time', () => {
  const model = fixture([[0, 1, 2]]),
    tutorial = new NativeTutorial();
  assert.equal(idle(tutorial, model, 0.6), null);
  assert.equal(idle(tutorial, model, 20, { enabled: true, blocked: true }), null);
  assert.ok(Math.abs(tutorial.snapshot().idleSeconds - 0.6) < 1e-9);
  assert.equal(idle(tutorial, model, 20, { enabled: false, blocked: false }), null);
  assert.ok(Math.abs(tutorial.snapshot().idleSeconds - 0.6) < 1e-9);
  assert.ok(idle(tutorial, model, 0.6));
  assert.equal(tutorial.update(model, 20, { enabled: true, blocked: true }), null);
  assert.equal(tutorial.snapshot().hint, null);
});

test('invalid or stalled-frame deltas do not skip the initial delay; reset and new level restore it', () => {
  const model = fixture([[0, 1, 2]]),
    tutorial = new NativeTutorial();
  for (const dt of [NaN, Infinity, -1]) assert.equal(tutorial.update(model, dt, visible), null);
  assert.equal(tutorial.snapshot().idleSeconds, 0);
  assert.equal(tutorial.update(model, 100, visible), null);
  assert.equal(tutorial.snapshot().idleSeconds, TUTORIAL_CONFIG.maxFrameSeconds);
  assert.ok(idle(tutorial, model, 1));
  tutorial.reset();
  assert.equal(tutorial.snapshot().idleSeconds, 0);
  assert.equal(tutorial.update(model, 0, visible), null);
  assert.ok(idle(tutorial, model, 1.2));
  assert.equal(tutorial.update(fixture([[0, 1, 2]]), 0.1, visible), null);
});

test('recommendation is read-only and returned hint snapshots cannot mutate tutorial state', () => {
  const model = fixture([[0, 1, 2]]),
    before = JSON.stringify(model),
    tutorial = new NativeTutorial();
  const direct = recommendTutorialHint(model);
  assert.ok(direct);
  assert.equal(JSON.stringify(model), before);
  idle(tutorial, model, 1.2);
  const snapshot = tutorial.snapshot();
  assert.ok(snapshot.hint);
  snapshot.hint.position.x = -999;
  snapshot.hint.text = 'edited';
  assert.notEqual(tutorial.snapshot().hint?.position.x, -999);
  assert.notEqual(tutorial.snapshot().hint?.text, 'edited');
});

test('innermost color wins over a larger future-ring color demand', () => {
  const model = fixture([[0, 0, 0], Array<number>(9).fill(1)]);
  const hint = recommendTutorialHint(model);
  assert.ok(hint);
  assert.equal(hint.color, 0);
  assert.equal(hint.sourceIndex, 0);
  assert.equal(hint.kind, 'queue');
});

test('incoming flight and input cooldown suppress otherwise useful recommendations', () => {
  const model = fixture([
    [0, 1, 2],
    [0, 1, 2],
    [0, 1, 2],
  ]);
  assert.equal(model.fireQueue(0), true);
  advance(model, 0.1);
  assert.equal(recommendTutorialHint(model), null);
  const config = JSON.parse(JSON.stringify(NATIVE_CONFIG));
  config.timing.inputCooldown = 2;
  const slow = new NativeModel(model.level, config);
  advance(slow, 2);
  assert.equal(slow.fireQueue(0), true);
  advance(slow, 0.5);
  assert.equal(slow.isAnimatingShot, false);
  assert.equal(recommendTutorialHint(slow), null);
});

test('external queue shots reset idle time even when interact was not called', () => {
  const model = fixture([
      [0, 1, 2],
      [0, 1, 2],
      [0, 1, 2],
    ]),
    tutorial = new NativeTutorial();
  const hint = idle(tutorial, model, 1.2);
  assert.ok(hint);
  assert.equal(model.fireQueue(hint.index), true);
  assert.equal(tutorial.update(model, 0, visible), null);
  assert.equal(tutorial.snapshot().interacted, true);
  assert.equal(tutorial.snapshot().idleSeconds, 0);
  assert.equal(idle(tutorial, model, 4.9), null);
  assert.ok(idle(tutorial, model, 0.1));
});

test('enough matching active power produces no needless queue launch', () => {
  const model = fixture([Array<number>(9).fill(0), [0, 0, 0], [1, 1, 1]]);
  for (const column of [0, 1, 2]) {
    assert.equal(model.fireQueue(column), true);
    advance(model, 0.5);
  }
  assert.ok(model.activeBalls.length > 0);
  assert.ok(model.queueBalls().some((ball) => ball.row === 0 && ball.color === 0));
  assert.equal(recommendTutorialHint(model), null);
});

test('full active field and full tray recommend a useful stored swap, never the blocked queue', () => {
  const model = fullTray(),
    red = model.trayBalls.find((ball) => ball.color === 0)!;
  assert.ok(red);
  assert.equal(red.state, 'stored');
  const tutorial = new NativeTutorial();
  tutorial.update(model, 0, visible);
  const hint = idle(tutorial, model, TUTORIAL_CONFIG.idleDelaySeconds);
  assert.ok(hint);
  assert.equal(hint.kind, 'tray');
  assert.equal(hint.ballId, red.id);
  assert.equal(hint.index, red.slot);
  assert.equal(hint.text, TUTORIAL_CONFIG.copy.swap);
  assert.equal(hint.key, `tray:${red.id}`);
  assert.deepEqual(hint.position, {
    x: model.config.view.trayX[red.slot],
    y: model.config.view.trayY,
  });
  assert.ok(hint.index < TUTORIAL_CONFIG.unlockedTraySlots);
  assert.equal(model.fireTray(hint.index), true, 'the recommended full-tray swap must be accepted');
});

test('reveal hint targets a legal front that exposes a needed color, never its unavailable future ball', () => {
  const base = fixture([[0, 0, 0], Array<number>(9).fill(1)]),
    level = cloneLevel(base.level);
  level.queue = [1, 1, 1, 0].map((color) => ({ color, power: 3, mystery: false }));
  const model = new NativeModel(level),
    hint = recommendTutorialHint(model);
  assert.ok(hint);
  assert.equal(hint.kind, 'queue');
  assert.equal(hint.index, 0);
  assert.equal(hint.sourceIndex, 0);
  assert.equal(hint.color, 1);
  assert.equal(hint.text, TUTORIAL_CONFIG.copy.reveal);
  assert.equal(model.fireQueue(hint.index), true);
});

test('terminal and genuinely unavailable states have no tutorial target', () => {
  const won = fixture([[0]]);
  assert.equal(won.fireQueue(0), true);
  advance(won, 2);
  assert.equal(won.status, 'won');
  assert.equal(recommendTutorialHint(won), null);
  assert.equal(idle(new NativeTutorial(), won, 10), null);
  const failed = fullTray();
  advance(failed, 15);
  assert.equal(failed.status, 'failed');
  assert.equal(recommendTutorialHint(failed), null);
});
