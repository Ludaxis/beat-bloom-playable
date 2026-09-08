import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeRenderer } from '../src/native/render';
import { NativeModel } from '../src/native/model';
import { cloneLevel } from '../src/native/config';
import { VFX } from '../src/native/vfx';

for (const shape of ['heart', 'square', 'flower', 'hexagon'] as const)
  test(`${shape} clear pulse follows the contour with bounded reusable geometry`, () => {
    const model = new NativeModel({ ...cloneLevel(), shape });
    let widths: number[] = [];
    let strokes: { x: number; y: number }[][] = [];
    const probe = Object.assign(Object.create(NativeRenderer.prototype), {
      config: model.config,
      lastModel: model,
      clock: 0,
      reducedMotion: false,
      shocks: [],
      cameraImpulse: { trigger() {} },
      ballColor() {
        return 0xff6688;
      },
      clearPulse: {
        clear() {
          strokes = [];
          widths = [];
        },
        stroke(points: { x: number; y: number }[], width: number) {
          widths.push(width);
          strokes.push(structuredClone(points));
        },
        upload() {},
      },
    });
    for (let i = 0; i < 5; i++)
      probe.event({ type: 'ringClear', time: 0, color: 0, position: { x: 0, y: 0 }, ringId: 0 });
    assert.equal(probe.shocks.length, VFX.shockwave.maxConcurrent);
    const pulse = probe.shocks[0],
      buffer = pulse.screen,
      point = buffer[0];
    assert.ok(pulse.outline.length <= VFX.shockwave.samples + 1);
    assert.deepEqual(pulse.outline[0], pulse.outline.at(-1), 'closed outline');
    const radii = pulse.outline.map((p: { x: number; y: number }) => Math.hypot(p.x, p.y));
    assert.ok(
      Math.max(...radii) - Math.min(...radii) > 0.05,
      'shape detail is not replaced by a circle',
    );
    probe.clock = 0.2;
    probe.drawClearPulse(model);
    assert.equal(strokes.length, 6);
    assert.ok(strokes.flat().every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
    const stationary = structuredClone(strokes);
    model.rotation += 1.7;
    probe.drawClearPulse(model);
    assert.deepEqual(strokes, stationary, 'board rotation cannot spin the pulse');
    const core =
      model.level.lineThickness * model.config.view.pixelsPerUnit + VFX.field.shoulderPixels * 2;
    assert.equal(widths[2], core, 'neon core matches the authored line width');
    model.level.lineThickness *= 1.5;
    probe.drawClearPulse(model);
    assert.ok(widths[2] > core, 'thickness changes carry through to the pulse');
    probe.clock = 0.4;
    probe.drawClearPulse(model);
    assert.equal(pulse.screen, buffer);
    assert.equal(pulse.screen[0], point);
    probe.clock = VFX.shockwave.seconds + 0.01;
    probe.drawClearPulse(model);
    assert.equal(strokes.length, 0);
    assert.equal(probe.shocks.length, 0);
    probe.reducedMotion = true;
    probe.event({
      type: 'ringClear',
      time: probe.clock,
      color: 0,
      position: { x: 0, y: 0 },
      ringId: 0,
    });
    probe.drawClearPulse(model);
    assert.equal(strokes.length, 0);
  });

test('ring illumination follows the pulse front, fades behind it, and respects reduced motion', () => {
  const probe = Object.assign(Object.create(NativeRenderer.prototype), {
    reducedMotion: false,
    clock: 0,
    shocks: [{ time: 0 }],
    config: { view: { pixelsPerUnit: 1, width: 576 } },
  });
  const ring = {
    points: [
      { x: 150, y: 0 },
      { x: 0, y: 100 },
    ],
  };
  const cfg = VFX.shockwave;
  const arrival =
    ((150 - cfg.startRadius) / (576 * cfg.endRadiusFactor - cfg.startRadius)) * cfg.seconds;
  probe.clock = arrival - 0.1;
  assert.equal(probe.ringIllumination(ring), 0);
  probe.clock = arrival;
  const peak = probe.ringIllumination(ring);
  assert.ok(peak > 0.7 && peak <= 1);
  probe.clock = arrival + 0.08;
  assert.ok(probe.ringIllumination(ring) > 0 && probe.ringIllumination(ring) < peak);
  probe.clock = arrival + 0.2;
  assert.equal(probe.ringIllumination(ring), 0);
  probe.clock = arrival;
  probe.reducedMotion = true;
  assert.equal(probe.ringIllumination(ring), 0);
});

test('neon flashes travel from inner to outer rings at the center pulse speed', () => {
  const probe = Object.assign(Object.create(NativeRenderer.prototype), {
    reducedMotion: false,
    clock: 0,
    shocks: [{ time: 0 }],
    config: { view: { pixelsPerUnit: 1, width: 576 } },
  });
  const cfg = VFX.shockwave;
  const radii = [90, 150, 210, 270];
  const rings = radii.map((x) => ({ points: [{ x, y: 0 }] }));
  for (let i = 0; i < radii.length; i++) {
    probe.clock =
      ((radii[i] - cfg.startRadius) / (576 * cfg.endRadiusFactor - cfg.startRadius)) * cfg.seconds;
    const light = rings.map((r) => probe.ringIllumination(r));
    assert.equal(light.indexOf(Math.max(...light)), i, 'peak advances in ring order');
    assert.ok(light[i] > 0.6);
  }
});
