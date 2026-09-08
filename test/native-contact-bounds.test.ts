import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeModel } from '../src/native/model';
import { getPlayableLevel } from '../src/native/creative';
import { generatePattern } from '../src/native/pattern-editor';
import { setLayerCount } from '../src/native/level-editor';
import type { NativeShape } from '../src/native/types';

for (const shape of ['square', 'heart', 'flower'] as NativeShape[])
  test(`${shape} broad-phase rejection preserves exhaustive contacts, events and ball trajectories`, () => {
    const level = generatePattern(setLayerCount(getPlayableLevel('native'), 24), {
      colorCount: 4,
      segmentsPerRing: 4,
      colorsPerRing: 4,
      shift: 0,
      shiftDegrees: 0.1,
    });
    Object.assign(level, {
      shape,
      innerRadius: 7.65,
      lineSpacing: 0.538775,
      lineThickness: 0.253,
      ballScale: 0.6,
      ballSpeed: 1.08,
      arenaRingCapacity: 12,
      maxRenderedRings: 12,
      previewRingCount: 0,
    });
    const optimized = new NativeModel(level),
      exhaustive = new NativeModel(level);
    // Disable only the optional rejection checks in the control. Every original edge still
    // reaches the identical narrow-phase solver; no gameplay state or input is injected.
    Object.assign(exhaustive, { pathMayContact: () => true, edgeMayContact: () => true });
    let impacts = 0,
      breaks = 0;
    for (let step = 0; step < 720; step++) {
      if ([0, 60, 120].includes(step)) {
        const column = step / 60;
        assert.equal(optimized.fireQueue(column), true);
        assert.equal(exhaustive.fireQueue(column), true);
      }
      optimized.step(1 / 120);
      exhaustive.step(1 / 120);
      const actual = optimized.drainEvents(),
        expected = exhaustive.drainEvents();
      assert.deepEqual(actual, expected, `events at fixed step ${step}`);
      assert.deepEqual(optimized.balls, exhaustive.balls, `trajectory at fixed step ${step}`);
      assert.deepEqual(optimized.snapshot(), exhaustive.snapshot());
      impacts += actual.filter((event) => event.type === 'impact').length;
      breaks += actual.filter((event) => event.type === 'break').length;
    }
    assert.ok(impacts > 0, 'fixture must exercise physical contacts');
    assert.ok(breaks > 0, 'fixture must exercise matching consumption');
  });
