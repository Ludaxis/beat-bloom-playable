import test from 'node:test';
import assert from 'node:assert/strict';
import { AdFlow, validateAdFlow } from '../src/native/ad-flow';
for (const layout of ['footer', 'logo'] as const)
  test(`${layout} counts eight accepted moves after start`, () => {
    const flow = new AdFlow(layout);
    flow.accept(true);
    assert.equal(flow.moves, 0);
    flow.start();
    for (let i = 0; i < 7; i++) {
      assert.equal(flow.accept(false), false);
      assert.equal(flow.accept(true), false);
    }
    assert.equal(flow.accept(true), true);
    assert.equal(flow.moves, 8);
    flow.accept(true);
    assert.equal(flow.moves, 8);
    assert.equal(new AdFlow(layout).started, false);
  });
test('existing levels remain unlimited and invalid options fail validation', () => {
  const flow = new AdFlow();
  for (let i = 0; i < 20; i++) assert.equal(flow.accept(true), false);
  assert.ok(validateAdFlow({ intro: 'other', tagline: 'Hi' }).length);
  assert.ok(validateAdFlow({ intro: 'logo', tagline: 'x'.repeat(61) }).length);
  assert.deepEqual(validateAdFlow({ intro: 'logo', tagline: 'Find your rhythm' }), []);
});

test('intro rotation preserves puzzle time and first stem reveal is idempotent', async () => {
  const { NativeModel } = await import('../src/native/model');
  const { cloneLevel } = await import('../src/native/config');
  const level = cloneLevel();
  level.adFlow = { intro: 'logo', tagline: 'Harder than you think' };
  const model = new NativeModel(level);
  const before = model.snapshot();
  const rotation = model.rotation;
  model.rotateIntro(0.1);
  assert.notEqual(model.rotation, rotation);
  assert.equal(model.time, before.time);
  assert.equal(model.shots, 0);
  assert.deepEqual(model.unlockedStems, []);
  model.unlockIntroStem(level.stemLanes[1].colors[0]);
  model.unlockIntroStem();
  assert.equal(model.unlockedStems.length, 1);
  assert.equal(model.drainEvents().filter((e) => e.type === 'unlock').length, 1);
  const normal = new NativeModel(cloneLevel());
  normal.unlockIntroStem();
  assert.deepEqual(normal.unlockedStems, []);
});

test('play limit works independently of the intro and rejects invalid limits', () => {
  for (const layout of ['none', 'logo'] as const) {
    const flow = new AdFlow(layout, 3, false);
    assert.equal(flow.started, true);
    assert.equal(flow.accept(false), false);
    assert.equal(flow.accept(true), false);
    assert.equal(flow.accept(true), false);
    assert.equal(flow.accept(true), true);
    flow.accept(true);
    assert.equal(flow.moves, 3);
  }
  const unlimited = new AdFlow('logo', 0);
  unlimited.start();
  for (let i = 0; i < 40; i++) assert.equal(unlimited.accept(true), false);
  for (const interactionLimit of [-1, 31, 1.5, NaN])
    assert.ok(validateAdFlow({ intro: 'none', tagline: 'Hi', interactionLimit }).length);
});
