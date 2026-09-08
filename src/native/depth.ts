import type { NativeLevel, NativeRingAppearance } from './types';

export const DEFAULT_RING_APPEARANCE: Readonly<NativeRingAppearance> = Object.freeze({
  colorFade: 0.08,
  shadowOpacity: 0.2,
  shadowFade: 0.3,
});
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

/** Exact per-ring opacity, with a smooth transition even when 100% fade makes the next ring zero. */
function fadeAtDepth(fade: number, depth: number): number {
  depth = Math.max(0, depth);
  const ring = Math.floor(depth),
    fraction = smooth(depth - ring);
  const current = (1 - fade) ** ring,
    next = current * (1 - fade);
  return current + (next - current) * fraction;
}

/** Presentation defaults never add metadata to an authored/imported level. */
export function resolveRingAppearance(
  level: Pick<NativeLevel, 'ringAppearance'>,
): NativeRingAppearance {
  const value = level.ringAppearance;
  const read = (key: keyof NativeRingAppearance) =>
    Number.isFinite(value?.[key]) ? clamp01(value![key]) : DEFAULT_RING_APPEARANCE[key];
  return {
    colorFade: read('colorFade'),
    shadowOpacity: read('shadowOpacity'),
    shadowFade: read('shadowFade'),
  };
}

/** Continuous layout depth, independent of gameplay eligibility or the legacy preview window. */
export function ringDepthStyle(
  layoutLayer: number,
  arenaCapacity: number,
  wallMargin: number,
  appearance: NativeRingAppearance,
): { colorAlpha: number; shadowAlpha: number } {
  const outermostColor = Math.max(0, arenaCapacity - 1);
  const wall = outermostColor + wallMargin;
  const colorDepth = Math.max(0, layoutLayer);
  const colorAlpha =
    fadeAtDepth(appearance.colorFade, colorDepth) *
    smooth((wall - layoutLayer) / Math.max(Number.EPSILON, wallMargin));
  const distanceFromWall = Math.max(0, layoutLayer - wall);
  // One spacing outside the wall is full shadow strength; farther rings fade geometrically.
  // Both sides fade to zero at the white wall, so compression never pops a hue through it.
  const shadowAlpha =
    appearance.shadowOpacity *
    fadeAtDepth(appearance.shadowFade, distanceFromWall - 1) *
    smooth(distanceFromWall);
  return { colorAlpha, shadowAlpha };
}
