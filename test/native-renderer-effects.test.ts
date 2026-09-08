import test from 'node:test';
import assert from 'node:assert/strict';
import { Graphics } from 'pixi.js';
import { NativeRenderer } from '../src/native/render';
import { VFX } from '../src/native/vfx';

type BurstKind = 'launch' | 'spent' | 'impact' | 'absorb';
interface ParticleProbe {
  clock: number;
  bursts: {
    kind: BurstKind;
    time: number;
    position: { x: number; y: number };
    color: number;
    radius: number;
  }[];
  particles: Graphics;
  topEffects: Graphics;
  drawParticles(): void;
}

// Exercise the actual particle pass without constructing its unrelated WebGL application.
function particleProbe(kind: BurstKind, reducedMotion: boolean): ParticleProbe {
  return Object.assign(Object.create(NativeRenderer.prototype), {
    clock: 0,
    reducedMotion,
    particles: new Graphics(),
    topEffects: new Graphics(),
    lineShards: [],
    sparks: [],
    bursts: [{ kind, time: 1, position: { x: 30, y: 40 }, color: 0xff3355, radius: 20 }],
  });
}

test('launch, impact, spent and absorb bursts remain visible until their configured expiry', () => {
  const cases: [BurstKind, number][] = [
    ['launch', VFX.launch.seconds],
    ['impact', VFX.impact.seconds],
    ['spent', VFX.spent.seconds],
    ['absorb', VFX.clef.absorbSeconds],
  ];
  for (const reducedMotion of [false, true])
    for (const [kind, duration] of cases) {
      const probe = particleProbe(kind, reducedMotion);
      for (const fraction of [0, 0.25, 0.5, 0.99]) {
        probe.clock = 1 + duration * fraction;
        probe.drawParticles();
        assert.equal(probe.bursts.length, 1, `${kind} disappeared at ${fraction} of its lifetime`);
        assert.ok(
          probe.particles.context.instructions.length > 0,
          `${kind} must draw intermediate frames`,
        );
      }
      probe.clock = 1 + duration + 0.001;
      probe.drawParticles();
      assert.equal(probe.bursts.length, 0);
      assert.equal(probe.particles.context.instructions.length, 0);
      assert.equal(probe.topEffects.context.instructions.length, 0);
      probe.particles.destroy();
      probe.topEffects.destroy();
    }
});

test('scheduled bursts stay hidden before their timestamp and still play when reached', () => {
  const probe = particleProbe('absorb', false);
  probe.drawParticles();
  assert.equal(probe.bursts.length, 1);
  assert.equal(probe.particles.context.instructions.length, 0);
  probe.clock = 1.05;
  probe.drawParticles();
  assert.equal(probe.bursts.length, 1);
  assert.ok(probe.topEffects.context.instructions.length > 0);
  probe.particles.destroy();
  probe.topEffects.destroy();
});
