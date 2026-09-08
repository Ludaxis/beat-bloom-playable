import test from 'node:test';
import assert from 'node:assert/strict';
import { logoHeartbeat, logoReveal } from '../src/native/logo-motion';
test('logo grows from zero, lifts smoothly and settles with a bounded beat pulse', () => {
  assert.deepEqual(logoReveal(0, 0), { scale: 0, y: -0 });
  assert.equal(logoReveal(0.65, 0).scale, 1);
  assert.equal(logoReveal(0.85, 0).y, -0);
  assert.equal(logoReveal(2, 0).y, -96);
  for (let p = 0; p < 4; p += 0.001) {
    assert.ok(logoHeartbeat(p) >= 1 && logoHeartbeat(p) <= 1.02500001);
    assert.ok(Math.abs(logoHeartbeat(p) - logoHeartbeat(p + 1)) < 1e-10);
  }
  assert.deepEqual(logoReveal(0, 0.2, true), { scale: 1, y: 0 });
});
