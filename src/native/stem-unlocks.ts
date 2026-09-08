import type { NativeLevel } from './types';
export const STEM_UNLOCK_FRACTION = 0.5;
/** Full authored field, including rings outside the visible wall; gaps do not count. */
export function colorUnlockTargets(level: Pick<NativeLevel, 'palette' | 'rings'>): number[] {
  const counts = Array<number>(level.palette.length).fill(0);
  for (const ring of level.rings) for (const color of ring) if (color >= 0) counts[color]++;
  return counts.map((count) => Math.ceil(count * STEM_UNLOCK_FRACTION));
}
export function laneUnlockProgress(colors: number[], broken: number[], targets: number[]): number {
  return [...new Set(colors)].reduce(
    (sum, color) => sum + Math.min(broken[color] ?? 0, targets[color] ?? 0),
    0,
  );
}
