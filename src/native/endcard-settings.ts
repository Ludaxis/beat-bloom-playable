import { cloneLevel } from './config';
import { conceptForProfile, END_CARD } from './creative';
import type { EndCardDesign, NativeLevel } from './types';

export const END_CARD_DESIGN_LIMITS = Object.freeze({
  headlineLength: 80,
  headlineLines: 2,
  ctaLength: 24,
  logoMin: 120,
  logoMax: 340,
  iconMin: 64,
  iconMax: 180,
});
export const DEFAULT_END_CARD_STYLE = Object.freeze({
  ctaColor: 0x69d442,
  backgroundColor: 0x19102e,
  logoWidth: 290,
  iconSize: 156,
});
const fields = [
  'headline',
  'ctaLabel',
  'ctaColor',
  'backgroundColor',
  'logoWidth',
  'iconSize',
  'logoImage',
  'iconImage',
  'headlineSize',
  'ctaSize',
  'ctaWidth',
  'ctaHeight',
  'replayEnabled',
] as const;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export function validateEndCardDesign(value: unknown): string[] {
  if (!object(value)) return ['endCard must be an object containing the complete design settings.'];
  const errors: string[] = [],
    limits = END_CARD_DESIGN_LIMITS;
  if (
    typeof value.headline !== 'string' ||
    !value.headline.trim() ||
    [...value.headline].length > limits.headlineLength ||
    value.headline.split(/\r\n?|\n|\u2028|\u2029/).length > limits.headlineLines
  )
    errors.push('endCard.headline must contain 1–80 characters on at most two lines.');
  if (
    typeof value.ctaLabel !== 'string' ||
    !value.ctaLabel.trim() ||
    [...value.ctaLabel].length > limits.ctaLength ||
    /[\r\n\u2028\u2029]/.test(value.ctaLabel)
  )
    errors.push('endCard.ctaLabel must contain 1–24 characters without a line break.');
  for (const key of ['ctaColor', 'backgroundColor'] as const)
    if (!Number.isInteger(value[key]) || Number(value[key]) < 0 || Number(value[key]) > 0xffffff)
      errors.push(`endCard.${key} must be an integer RGB color from 0 to 16777215.`);
  for (const [key, min, max] of [
    ['logoWidth', limits.logoMin, limits.logoMax],
    ['iconSize', limits.iconMin, limits.iconMax],
  ] as const)
    if (!Number.isFinite(value[key]) || Number(value[key]) < min || Number(value[key]) > max)
      errors.push(`endCard.${key} must be between ${min} and ${max}.`);
  for (const key of ['logoImage', 'iconImage'])
    if (
      value[key] !== undefined &&
      (typeof value[key] !== 'string' ||
        value[key].length > 110000 ||
        !/^data:image\/webp;base64,UklGR[A-Za-z0-9+/]+={0,2}$/.test(value[key] as string))
    )
      errors.push(`endCard.${key} must be an embedded WebP image under 80 KB.`);
  for (const [key, min, max] of [
    ['headlineSize', 18, 64],
    ['ctaSize', 16, 40],
    ['ctaWidth', 140, 360],
    ['ctaHeight', 44, 100],
  ] as const)
    if (
      value[key] !== undefined &&
      (!Number.isFinite(value[key]) || Number(value[key]) < min || Number(value[key]) > max)
    )
      errors.push(`endCard.${key} must be between ${min} and ${max}.`);
  if (value.replayEnabled !== undefined && typeof value.replayEnabled !== 'boolean')
    errors.push('endCard.replayEnabled must be true or false.');
  return errors;
}

export function resolveEndCardDesign(
  level: Pick<NativeLevel, 'endCard'>,
  profile: string,
): EndCardDesign {
  if (level.endCard) {
    const errors = validateEndCardDesign(level.endCard);
    if (errors.length) throw Error(errors.join('\n'));
    return { ...level.endCard };
  }
  return {
    ...DEFAULT_END_CARD_STYLE,
    headline:
      conceptForProfile(profile) === 'Tagline0Logo'
        ? END_CARD.taglineHeadline
        : END_CARD.successHeadline,
    ctaLabel: END_CARD.installLabel,
  };
}

/** Merge a live edit into a fresh level; no puzzle state, queue order or asset URL changes. */
export function setLevelEndCardDesign(
  level: NativeLevel,
  profile: string,
  options: Partial<EndCardDesign>,
): NativeLevel {
  if (
    !object(options) ||
    Object.keys(options).some((key) => !fields.includes(key as (typeof fields)[number]))
  )
    throw Error('End-card edits must contain only supported design fields.');
  const endCard = { ...resolveEndCardDesign(level, profile), ...options };
  const errors = validateEndCardDesign(endCard);
  if (errors.length) throw Error(errors.join('\n'));
  return { ...cloneLevel(level), endCard };
}

const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`;
const channels = (color: number) => [(color >>> 16) & 255, (color >>> 8) & 255, color & 255];
const tint = (color: number, offsets: number[]) =>
  channels(color).reduce(
    (result, value, index) => (result << 8) | Math.max(0, Math.min(255, value + offsets[index])),
    0,
  );
const luminance = (color: number) =>
  channels(color)
    .map((value) => {
      const s = value / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    })
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
const contrast = (a: number, b: number) => {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/** Keep the approved default shading, and choose readable text across custom CTA gradients. */
export function endCardCssVariables(design: EndCardDesign): Record<string, string> {
  const errors = validateEndCardDesign(design);
  if (errors.length) throw Error(errors.join('\n'));
  let top = tint(design.ctaColor, [51, 24, 30]);
  const choices = () =>
    [0x182f0b, 0x000000, 0xffffff].map((color) => ({
      color,
      ratio: Math.min(contrast(color, top), contrast(color, design.ctaColor)),
    }));
  // A very dark base plus a bright highlight can straddle both text contrast ranges.
  // Flatten only that gradient rather than accepting unreadable editable button copy.
  if (Math.max(...choices().map((choice) => choice.ratio)) < 4.5) top = design.ctaColor;
  const ranked = choices(),
    text =
      ranked[0].ratio >= 4.5 ? ranked[0].color : ranked.sort((a, b) => b.ratio - a.ratio)[0].color;
  const backgroundTop = tint(design.backgroundColor, [28, 17, 32]),
    backgroundBottom = tint(design.backgroundColor, [-11, -7, -16]);
  const backgroundText = [0xffffff, 0x141024]
    .map((color) => ({
      color,
      ratio: Math.min(
        ...[backgroundTop, design.backgroundColor, backgroundBottom].map((background) =>
          contrast(color, background),
        ),
      ),
    }))
    .sort((a, b) => b.ratio - a.ratio)[0].color;
  return {
    '--endcard-background': hex(design.backgroundColor),
    '--endcard-background-top': hex(backgroundTop),
    '--endcard-background-bottom': hex(backgroundBottom),
    '--endcard-text': hex(backgroundText),
    '--endcard-cta': hex(design.ctaColor),
    '--endcard-cta-top': hex(top),
    '--endcard-cta-shadow': hex(tint(design.ctaColor, [-60, -93, -27])),
    '--endcard-cta-text': hex(text),
    '--endcard-logo-width': `${design.logoWidth}px`,
    '--endcard-icon-size': `${design.iconSize}px`,
  };
}
