import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NativeModel } from '../src/native/model';
import { DEFAULT_NATIVE_LEVEL, REFERENCE_NATIVE_LEVEL, worldToScreen } from '../src/native/config';

interface Sample {
  videoTime: number;
  center: [number, number];
}
const evidence = JSON.parse(
  readFileSync(new URL('./fixtures/reference-yellow-exact-pts.json', import.meta.url), 'utf8'),
) as { samples: Sample[] };

test('calibrated first yellow shot agrees with measured direction, impact time and bounded pre-impact head error', () => {
  // This is a measured short replay contract, not a claim of exact full-video or Box2D parity.
  // Original touch timestamps are unavailable. 3.775s is the documented comparison assumption.
  const model = new NativeModel(REFERENCE_NATIVE_LEVEL),
    step = 1 / 120;
  while (model.time < 3.775 - 1e-6) model.step(step);
  assert.equal(model.fireQueue(2), true);
  const errors: number[] = [];
  for (const ref of evidence.samples.filter((s) => s.videoTime >= 4.2 && s.videoTime < 4.54)) {
    while (model.time < ref.videoTime - step * 0.5) model.step(step);
    const p = worldToScreen(model.balls[0].position, model.config);
    errors.push(Math.hypot(p.x - ref.center[0], p.y - ref.center[1]));
  }
  assert.ok(
    model.balls[0].position.x > 0,
    'the first yellow ball must travel right, not the previously mirrored launch',
  );
  const rms = Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / errors.length);
  assert.ok(rms < 10, `first-launch measured RMS ${rms.toFixed(2)}px exceeds review tolerance`);
  assert.ok(Math.max(...errors) < 18, `maximum measured error ${Math.max(...errors).toFixed(2)}px`);
  while (model.time < 4.65) model.step(step);
  const firstBreak = model.drainEvents().find((e) => e.type === 'break');
  assert.ok(firstBreak);
  assert.ok(Math.abs(firstBreak.time - 4.56) < 0.05, `first matching impact at ${firstBreak.time}`);
  assert.equal(
    DEFAULT_NATIVE_LEVEL.motion.phaseDegrees,
    56,
    'reference fitting must not rewrite native source data',
  );
  assert.ok(
    REFERENCE_NATIVE_LEVEL.referenceCalibration,
    'measured adjustments must retain provenance',
  );
});
