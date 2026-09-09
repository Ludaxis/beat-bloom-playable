import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneLevel } from '../src/native/config';
import { resolveIntroDesign, validateIntroDesign } from '../src/native/intro-settings';
import { validateNativeLevel } from '../src/native/model';

test('intro design is independent and survives a level round trip', () => {
  const level = cloneLevel();
  level.adFlow = { intro: 'footer', tagline: 'Find your rhythm' };
  level.adFlow.design = { ...resolveIntroDesign(level), headline: 'Play your way', playWidth: 200 };
  assert.equal(level.adFlow.design.bannerEnabled, true);
  const restored = JSON.parse(JSON.stringify(level));
  assert.equal(validateNativeLevel(restored).length, 0);
  assert.deepEqual(resolveIntroDesign(restored), resolveIntroDesign(level));
  assert.equal(restored.endCard, undefined);
  const off = { ...restored, adFlow: { ...restored.adFlow, intro: 'none' } };
  assert.deepEqual(resolveIntroDesign(off), resolveIntroDesign(restored));
});
test('intro design rejects invalid controls and unsafe assets', () => {
  for (const value of [
    { playWidth: 5000 },
    { dim: NaN },
    { playColor: -1 },
    { logoEnabled: 'yes' },
    { headline: '' },
    { installLabel: 'x'.repeat(25) },
    { logoImage: 'https://example.com/logo.svg' },
    { unknown: 1 },
    { concept: 'other' },
    { logoX: 999 },
    { handEnabled: 'yes' },
    { toString: 2 },
  ]) {
    assert.ok(validateIntroDesign(value).length, JSON.stringify(value));
  }
  assert.deepEqual(
    validateIntroDesign({ headline: 'Tap to play', bannerEnabled: true, iconSize: 48 }),
    [],
  );
});

test('intro concepts, positions and banner settings survive sharing JSON', () => {
  for (const concept of ['classic', 'spotlight', 'invitation'] as const) {
    const level = cloneLevel();
    level.adFlow = {
      intro: 'logo',
      tagline: 'Find your rhythm',
      design: {
        concept,
        logoX: 30,
        playY: -20,
        bannerHeight: 100,
        textColor: 0xffffff,
        handEnabled: false,
      },
    };
    const restored = JSON.parse(JSON.stringify(level));
    assert.deepEqual(validateNativeLevel(restored), []);
    assert.deepEqual(resolveIntroDesign(restored), resolveIntroDesign(level));
  }
});
