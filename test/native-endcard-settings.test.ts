import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneLevel } from '../src/native/config';
import { getPlayableLevel, END_CARD } from '../src/native/creative';
import { validateNativeLevel, exportNativeLevel, importNativeLevel } from '../src/native/model';
import {
  DEFAULT_END_CARD_STYLE,
  resolveEndCardDesign,
  setLevelEndCardDesign,
  validateEndCardDesign,
  endCardCssVariables,
} from '../src/native/endcard-settings';

test('absent end-card overrides resolve concept copy and approved design defaults without adding metadata', () => {
  const level = cloneLevel(),
    before = JSON.stringify(level);
  for (const profile of ['native', 'a-heart', 'a-flower', 'b-heart', 'b-flower']) {
    const design = resolveEndCardDesign(level, profile);
    assert.deepEqual(design, {
      ...DEFAULT_END_CARD_STYLE,
      headline: profile.startsWith('b-') ? END_CARD.taglineHeadline : END_CARD.successHeadline,
      ctaLabel: 'Install Now',
    });
    assert.deepEqual(validateEndCardDesign(design), []);
  }
  assert.equal(level.endCard, undefined);
  assert.equal(JSON.stringify(level), before);
});

test('partial live design edits preserve exact puzzle, queue, song, and prior copy while remaining immutable', () => {
  const source = getPlayableLevel('b-flower'),
    before = JSON.stringify(source);
  const first = setLevelEndCardDesign(source, 'b-flower', {
    headline: 'Build a little joy.\nOne beat at a time.',
    ctaColor: 0xabffdb,
    logoWidth: 330,
  });
  const next = setLevelEndCardDesign(first, 'b-flower', {
    ctaLabel: 'Play Beat Bloom',
    backgroundColor: 0x092c26,
    iconSize: 170,
  });
  assert.equal(JSON.stringify(source), before);
  assert.equal(source.endCard, undefined);
  assert.equal(first.endCard?.ctaLabel, 'Install Now');
  assert.equal(next.endCard?.headline, first.endCard?.headline);
  const without = cloneLevel(next);
  delete without.endCard;
  assert.deepEqual(without, source);
  assert.deepEqual(validateNativeLevel(next), []);
  assert.deepEqual(resolveEndCardDesign(next, 'a-heart'), next.endCard);
});

test('end-card design survives exact level JSON and creative normalization round trips', () => {
  const text = '<img src=x onerror=alert(1)>\nA literal design line';
  const edited = setLevelEndCardDesign(getPlayableLevel('a-heart'), 'a-heart', {
    headline: text,
    ctaLabel: '<Play & bloom>',
    ctaColor: 0x123456,
    backgroundColor: 0xfafffb,
    logoWidth: 120.5,
    iconSize: 64.25,
  });
  assert.deepEqual(importNativeLevel(exportNativeLevel(edited)), edited);
  assert.deepEqual(getPlayableLevel('a-heart', edited), edited);
  assert.equal(
    resolveEndCardDesign(edited, 'a-heart').headline,
    text,
    'copy remains literal text, not parsed or rewritten markup',
  );
});

test('the complete end-card schema accepts exact bounds and rejects missing, malformed and unsafe style values', () => {
  const base = resolveEndCardDesign(cloneLevel(), 'native');
  for (const patch of [
    {
      headline: 'A'.repeat(80),
      ctaLabel: 'B'.repeat(24),
      logoWidth: 120,
      iconSize: 64,
      ctaColor: 0,
      backgroundColor: 0xffffff,
    },
    { headline: 'A\nB', logoWidth: 340, iconSize: 180 },
    { headline: '🎵'.repeat(80) },
  ])
    assert.deepEqual(validateEndCardDesign({ ...base, ...patch }), []);
  for (const value of [
    null,
    [],
    {},
    { ...base, headline: '' },
    { ...base, headline: '  ' },
    { ...base, headline: 'A'.repeat(81) },
    { ...base, headline: 'A\nB\nC' },
    { ...base, headline: 'A\rB\rC' },
    { ...base, ctaLabel: ' ' },
    { ...base, ctaLabel: 'A'.repeat(25) },
    { ...base, ctaLabel: 'A\nB' },
    { ...base, ctaLabel: 'A\u2028B' },
    { ...base, ctaColor: NaN },
    { ...base, ctaColor: 1.5 },
    { ...base, ctaColor: -1 },
    { ...base, backgroundColor: 0x1000000 },
    { ...base, backgroundColor: '#ffffff' },
    { ...base, logoWidth: Infinity },
    { ...base, logoWidth: 119.9 },
    { ...base, iconSize: 180.1 },
  ]) {
    assert.ok(validateEndCardDesign(value).length, JSON.stringify(value));
    assert.ok(
      validateNativeLevel({ ...cloneLevel(), endCard: value }, { queueBalance: false }).length,
      'authoring validation must not bypass malformed design settings',
    );
  }
});

test('invalid partial edits are transactional and cannot inject arbitrary CSS fields', () => {
  const level = setLevelEndCardDesign(cloneLevel(), 'native', { headline: 'My beat' }),
    before = JSON.stringify(level);
  for (const patch of [
    null,
    { logoWidth: '340px;display:none' },
    { headline: 'A\nB\nC' },
    { ctaLabel: undefined },
    { assetURL: 'https://example.com/image.png' },
  ])
    assert.throws(() => setLevelEndCardDesign(level, 'native', patch as never));
  assert.equal(JSON.stringify(level), before);
  assert.throws(() => endCardCssVariables({ ...level.endCard!, ctaColor: NaN }));
});

const luminance = (hex: string) => {
  const color = Number.parseInt(hex.slice(1), 16),
    values = [(color >>> 16) & 255, (color >>> 8) & 255, color & 255].map((value) => {
      const c = value / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
};
const ratio = (a: string, b: string) => {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

test('CSS variables use only validated colors/dimensions and retain the default approved gradient', () => {
  const design = resolveEndCardDesign(cloneLevel(), 'native'),
    css = endCardCssVariables(design);
  assert.equal(css['--endcard-background'], '#19102e');
  assert.equal(css['--endcard-background-top'], '#35214e');
  assert.equal(css['--endcard-background-bottom'], '#0e091e');
  assert.equal(css['--endcard-cta'], '#69d442');
  assert.equal(css['--endcard-cta-top'], '#9cec60');
  assert.equal(css['--endcard-cta-text'], '#182f0b');
  assert.equal(css['--endcard-logo-width'], '290px');
  assert.equal(css['--endcard-icon-size'], '156px');
  for (const [key, value] of Object.entries(css))
    assert.match(
      value,
      key.includes('width') || key.includes('size') ? /^\d+(\.\d+)?px$/ : /^#[0-9a-f]{6}$/,
    );
  assert.equal(
    endCardCssVariables({ ...design, backgroundColor: 0xffffff })['--endcard-text'],
    '#141024',
  );
});

test('editable light and dark CTA colors retain at least 4.5:1 text contrast throughout their gradient', () => {
  const design = resolveEndCardDesign(cloneLevel(), 'native');
  const colors = [0, 0xffffff, 0x555555, 0x777777, 0xabffdb, 0x123456];
  for (const r of [0, 85, 170, 255])
    for (const g of [0, 85, 170, 255])
      for (const b of [0, 85, 170, 255]) colors.push((r << 16) | (g << 8) | b);
  for (const ctaColor of colors) {
    const css = endCardCssVariables({ ...design, ctaColor });
    for (const background of [css['--endcard-cta'], css['--endcard-cta-top']])
      assert.ok(
        ratio(css['--endcard-cta-text'], background) >= 4.5,
        `${ctaColor.toString(16)} needs readable CTA text`,
      );
  }
});

test('custom ending artwork and type sizes survive edits and reject remote or executable image sources', () => {
  const source = cloneLevel(),
    image = 'data:image/webp;base64,UklGRgAAAAAAV0VCUA==';
  const edited = setLevelEndCardDesign(source, 'native', {
    logoImage: image,
    iconImage: image,
    headlineSize: 48,
    ctaSize: 24,
  });
  assert.equal(resolveEndCardDesign(edited, 'native').logoImage, image);
  assert.equal(resolveEndCardDesign(JSON.parse(JSON.stringify(edited)), 'native').headlineSize, 48);
  for (const options of [
    { logoImage: 'https://example.com/logo.png' },
    { iconImage: 'data:image/svg+xml;base64,PHN2Zz4=' },
    { headlineSize: 65 },
    { ctaSize: 15 },
    { logoImage: image + 'A'.repeat(110000) },
  ])
    assert.throws(() => setLevelEndCardDesign(source, 'native', options));
});

test('CTA dimensions and Replay visibility are optional, preserved and strictly bounded', () => {
  const source = cloneLevel(),
    edited = setLevelEndCardDesign(source, 'native', {
      ctaWidth: 240,
      ctaHeight: 80,
      replayEnabled: false,
    });
  assert.equal(
    resolveEndCardDesign(JSON.parse(JSON.stringify(edited)), 'native').replayEnabled,
    false,
  );
  assert.equal(edited.endCard?.ctaWidth, 240);
  assert.equal(edited.endCard?.ctaHeight, 80);
  assert.equal(resolveEndCardDesign(source, 'native').replayEnabled, undefined);
  for (const options of [
    { ctaWidth: 139 },
    { ctaWidth: 361 },
    { ctaHeight: 43 },
    { ctaHeight: 101 },
    { replayEnabled: 'false' },
  ])
    assert.throws(() => setLevelEndCardDesign(source, 'native', options as never));
});
