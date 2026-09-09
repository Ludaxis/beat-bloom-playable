import type { NativeLevel } from './types';
export const INTRO_DEFAULTS = {
  concept: 'classic' as 'classic' | 'spotlight' | 'invitation',
  handEnabled: true,
  textColor: 0xffffff,
  logoX: 0,
  logoY: 0,
  taglineX: 0,
  taglineY: 0,
  headlineX: 0,
  headlineY: 0,
  playX: 0,
  playY: 0,
  bannerHeight: 90,
  headline: 'Tap to play',
  playLabel: 'Play',
  headlineSize: 41,
  playSize: 30,
  playWidth: 275,
  playHeight: 64,
  playColor: 0x8bea55,
  dim: 48,
  logoWidth: 116,
  taglineSize: 27,
  logoEnabled: true,
  bannerEnabled: false,
  bannerText: 'FREE TO PLAY',
  bannerTextSize: 14,
  bannerColor: 0x201436,
  iconSize: 60,
  installLabel: 'Install Now',
  installSize: 18,
  installWidth: 110,
  installHeight: 56,
  installColor: 0x8bea55,
};
export type IntroDesign = typeof INTRO_DEFAULTS & { logoImage?: string; iconImage?: string };
export const INTRO_RANGES: Record<string, [number, number]> = {
  logoX: [-160, 160],
  logoY: [-260, 260],
  taglineX: [-160, 160],
  taglineY: [-240, 240],
  headlineX: [-160, 160],
  headlineY: [-240, 240],
  playX: [-160, 160],
  playY: [-240, 240],
  bannerHeight: [64, 160],
  headlineSize: [18, 64],
  playSize: [16, 40],
  playWidth: [100, 360],
  playHeight: [44, 100],
  dim: [0, 90],
  logoWidth: [48, 340],
  taglineSize: [14, 40],
  bannerTextSize: [10, 28],
  iconSize: [24, 96],
  installSize: [12, 28],
  installWidth: [72, 160],
  installHeight: [44, 80],
};
export function resolveIntroDesign(level: NativeLevel): IntroDesign {
  // Materialized on load/edit so legacy shared artwork becomes an independent intro copy.
  const design = {
    ...INTRO_DEFAULTS,
    logoEnabled: level.adFlow?.intro !== 'footer',
    bannerEnabled: level.adFlow?.intro === 'footer',
    ...(level.adFlow?.design
      ? {}
      : { logoImage: level.endCard?.logoImage, iconImage: level.endCard?.iconImage }),
    ...level.adFlow?.design,
  };
  if (design.logoImage === undefined) delete design.logoImage;
  if (design.iconImage === undefined) delete design.iconImage;
  return design;
}
export function validateIntroDesign(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['Invalid intro design.'];
  const v = value as Record<string, unknown>;
  const errors: string[] = [];
  for (const [key, val] of Object.entries(v)) {
    if (key === 'logoImage' || key === 'iconImage') {
      if (
        val !== undefined &&
        (typeof val !== 'string' ||
          val.length > 110000 ||
          !/^data:image\/webp;base64,UklGR[A-Za-z0-9+/]+={0,2}$/.test(val))
      )
        errors.push('Choose a WebP image under 80 KB.');
    } else if (Object.hasOwn(INTRO_RANGES, key)) {
      const [min, max] = INTRO_RANGES[key];
      if (typeof val !== 'number' || !Number.isFinite(val) || val < min || val > max)
        errors.push(`${key} must be ${min}–${max}.`);
    } else if (key.endsWith('Color') && key in INTRO_DEFAULTS) {
      if (!Number.isInteger(val) || Number(val) < 0 || Number(val) > 0xffffff)
        errors.push('Choose a valid color.');
    } else if (key === 'concept') {
      if (!['classic', 'spotlight', 'invitation'].includes(String(val)))
        errors.push('Choose an intro layout.');
    } else if (key === 'logoEnabled' || key === 'bannerEnabled' || key === 'handEnabled') {
      if (typeof val !== 'boolean') errors.push('Choose on or off.');
    } else if (['headline', 'playLabel', 'bannerText', 'installLabel'].includes(key)) {
      if (
        typeof val !== 'string' ||
        !val.trim() ||
        val.length > (key === 'headline' ? 60 : 24) ||
        /[\r\n]/.test(val)
      )
        errors.push('Keep text short and on one line.');
    } else errors.push(`Unsupported intro setting: ${key}.`);
  }
  return errors;
}
