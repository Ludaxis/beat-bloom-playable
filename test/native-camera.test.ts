import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SoftCameraImpulse, type CameraCue } from '../src/native/camera';
import { VFX } from '../src/native/vfx';

test('camera displacement stays small and settles within 180ms at mobile frame rates', () => {
  for (const fps of [30, 60, 120])
    for (const cue of ['break', 'ringClear', 'unlock'] as CameraCue[]) {
      const camera = new SoftCameraImpulse();
      assert.equal(camera.trigger(cue, 0, { x: 3, y: -4 }), true);
      let peak = 0;
      for (let frame = 0; frame <= fps; frame++) {
        const time = frame / fps,
          offset = camera.sample(time);
        const magnitude = Math.hypot(offset.x, offset.y);
        assert.ok(Number.isFinite(magnitude));
        assert.ok(magnitude <= 1.1 + Number.EPSILON);
        assert.ok(
          offset.x >= 0 && offset.y <= 0,
          'an impulse does not oscillate across the center',
        );
        if (time >= 0.18) assert.deepEqual(offset, { x: 0, y: 0 });
        peak = Math.max(peak, magnitude);
      }
      assert.ok(peak > 0, 'normal mode keeps subtle contact feedback');
    }
});

test('a collision burst neither increases an active pulse nor prolongs its tail', () => {
  const baseline = new SoftCameraImpulse(),
    burst = new SoftCameraImpulse();
  baseline.trigger('break', 0, { x: 1, y: 0 });
  burst.trigger('break', 0, { x: 1, y: 0 });
  for (let i = 1; i < 320; i++) {
    const time = i / 1000;
    assert.equal(burst.trigger('ringClear', time, { x: -1, y: 1 }), false);
    assert.deepEqual(burst.sample(time), baseline.sample(time));
  }
  assert.equal(burst.trigger('unlock', VFX.camera.triggerSpacing, { x: 0, y: -1 }), true);
});

test('camera pulse has smooth zero-velocity starts, peaks and ends', () => {
  const camera = new SoftCameraImpulse();
  camera.trigger('ringClear', 0, { x: 1, y: 0 });
  const peak = VFX.camera.seconds * VFX.camera.attackFraction,
    h = 0.00001;
  for (const time of [0, peak, VFX.camera.seconds]) {
    const velocity = (camera.sample(time + h).x - camera.sample(time - h).x) / (2 * h);
    assert.ok(Math.abs(velocity) < 0.001, `velocity ${velocity} at ${time}s`);
  }
});

test('reduced motion and reset cancel the impulse without resuming stale movement', () => {
  const camera = new SoftCameraImpulse();
  camera.trigger('ringClear', 0, { x: 1, y: 0 });
  assert.ok(camera.sample(0.04).x > 0);
  assert.deepEqual(camera.sample(0.05, true), { x: 0, y: 0 });
  assert.deepEqual(camera.sample(0.06), { x: 0, y: 0 });
  assert.equal(camera.trigger('unlock', 1, { x: 1, y: 0 }, true), false);
  assert.deepEqual(camera.sample(1.05), { x: 0, y: 0 });
  camera.trigger('break', 2, { x: 1, y: 0 });
  camera.reset();
  assert.deepEqual(camera.sample(2.05), { x: 0, y: 0 });
});
