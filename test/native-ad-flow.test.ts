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
