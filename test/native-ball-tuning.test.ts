import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneLevel, deriveConfigForLevel, NATIVE_CONFIG } from '../src/native/config';
import { normalizePlayableQueue } from '../src/native/queue';
import { NativeModel, validateNativeLevel } from '../src/native/model';
test('center size and modest speed defaults preserve queue controls and bounded elastic bounces', () => {
  const level = normalizePlayableQueue(cloneLevel()),
    config = deriveConfigForLevel(level);
  assert.equal(level.ballScale, 0.85);
  assert.equal(level.ballSpeed, 1.0);
  assert.equal(config.view.queueRadius, NATIVE_CONFIG.view.queueRadius);
  assert.equal(config.physics.restitution, 1);
  assert.equal(config.physics.maxSpeed, NATIVE_CONFIG.physics.maxSpeed * 1.0);
  assert.equal(config.physics.minPostBounceSpeed, NATIVE_CONFIG.physics.minPostBounceSpeed * 1.0);
});
test('ball size changes collision radius consistently and validates imported limits', () => {
  for (const scale of [0.6, 0.85, 1.1]) {
    const level = normalizePlayableQueue({ ...cloneLevel(), ballScale: scale });
    const model = new NativeModel(level);
    model.fireQueue(0);
    const ball = model.balls[0];
    assert.ok(ball);
    assert.ok(
      Math.abs(
        ball.radius / ball.visualRadius - model.config.physics.collisionRadiusRatio * scale,
      ) < 1e-10,
    );
  }
  for (const ballScale of [0, 0.59, 1.11, NaN])
    assert.ok(validateNativeLevel({ ...cloneLevel(), ballScale }).length);
});

test('arena fitting preserves screen-space speed and gravity independently of ball size', () => {
  const reference = deriveConfigForLevel(normalizePlayableQueue(cloneLevel()));
  for (const capacity of [6, 8, 10, 12])
    for (const scale of [0.6, 0.85, 1.1]) {
      const level = normalizePlayableQueue({
        ...cloneLevel(),
        innerRadius: 7.65,
        lineSpacing: 0.5387755102040817,
        arenaRingCapacity: capacity,
        ballScale: scale,
      });
      const config = deriveConfigForLevel(level);
      for (const key of [
        'launchSpeed',
        'maxLaunchSpeed',
        'maxSpeed',
        'minPostBounceSpeed',
        'gravity',
      ] as const)
        assert.ok(
          Math.abs(
            config.physics[key] * config.view.pixelsPerUnit -
              reference.physics[key] * reference.view.pixelsPerUnit,
          ) < 1e-8,
          `${key} at ${capacity} rings / ${scale} size`,
        );
      assert.equal(config.physics.aimFlightSeconds, reference.physics.aimFlightSeconds);
    }
});
