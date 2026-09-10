import { cloneLevel } from './config';
import { validateNativeLevel } from './model';
import type { NativeLevel } from './types';
import { buildQueue, colorDemand } from './queue';
export { colorDemand } from './queue';

export const MIN_LAYER_COUNT = 1;
export const MAX_LAYER_COUNT = 24;

/**
 * Resizes the web level's complete authored field, not only the visible arena window.
 * Existing ring patterns remain intact. Added rings repeat the input level's pattern sequence.
 * Ammo follows rings from inside to outside, so early queue fronts contain early required colors.
 * This is deterministic authoring; it does not inject ammo or change pieces during gameplay.
 */
export function setLayerCount(level: NativeLevel, count: number): NativeLevel {
  if (!Number.isInteger(count) || count < MIN_LAYER_COUNT || count > MAX_LAYER_COUNT) {
    throw new RangeError(
      `Colored layer count must be an integer from ${MIN_LAYER_COUNT} to ${MAX_LAYER_COUNT}.`,
    );
  }
  const errors = validateNativeLevel(level);
  if (errors.length) throw new Error(errors.join('\n'));
  if (count === level.rings.length) return cloneLevel(level);
  const next = rebuildRingContents(level, {
    rings: Array.from({ length: count }, (_, index) => [
      ...level.rings[index % level.rings.length],
    ]),
  });
  if (level.ringPhaseOffsets) {
    const turns = (level.ringShiftDegrees ?? 0) / 360;
    next.ringPhaseOffsets = Array.from({ length: count }, (_, index) => {
      const phase =
        level.ringPhaseOffsets![index % level.rings.length] +
        Math.floor(index / level.rings.length) * level.rings.length * turns;
      return ((phase % 1) + 1) % 1;
    });
  }
  if (level.ringShiftDegrees !== undefined) next.ringShiftDegrees = level.ringShiftDegrees;
  return next;
}

/** Shared authoring boundary: preserve physical/song tuning, rebuild inside-out ammo and lanes. */
export function rebuildRingContents(
  level: NativeLevel,
  content: { rings: number[][]; palette?: number[] },
): NativeLevel {
  const errors = validateNativeLevel(level);
  if (errors.length) throw new Error(errors.join('\n'));
  const palette = content.palette ?? level.palette;
  if (
    !Array.isArray(palette) ||
    !palette.length ||
    palette.length > 12 ||
    palette.some((c) => !Number.isInteger(c) || c < 0 || c > 0xffffff)
  )
    throw new RangeError('Palette must contain 1–12 integer RGB colors.');
  if (
    !Array.isArray(content.rings) ||
    !content.rings.length ||
    content.rings.length > 80 ||
    content.rings.some(
      (r) =>
        !Array.isArray(r) ||
        !r.length ||
        r.length > 24 ||
        r.some((c) => !Number.isInteger(c) || c < -1 || c >= palette.length),
    )
  )
    throw new RangeError(
      'Template rings must contain 1–24 valid color indexes or authored gaps (-1).',
    );
  if (!content.rings.some((r) => r.some((c) => c >= 0)))
    throw new RangeError('A playable needs at least one colored segment.');
  const next = cloneLevel(level),
    count = content.rings.length;
  next.rings = content.rings.map((r) => [...r]);
  next.palette = [...palette];
  // A copied/repeated pattern is not necessarily the same generator recipe. inferPattern can
  // recover an exact matching recipe; retaining stale metadata would misrepresent saved content.
  delete next.pattern;
  delete next.ringPhaseOffsets;
  delete next.ringShiftDegrees;
  const oldDemand = colorDemand(level.rings, level.palette.length);
  const newDemand = colorDemand(next.rings, next.palette.length);
  next.queue = buildQueue(next.rings, next.palette.length);
  next.queuePolicy = 'fixed-three';
  next.arenaRingCapacity = Math.min(level.arenaRingCapacity, count);
  next.maxRenderedRings = Math.min(count, Math.max(level.maxRenderedRings, next.arenaRingCapacity));
  next.previewRingCount = Math.min(
    level.previewRingCount,
    Math.max(0, count - next.arenaRingCapacity),
  );
  // Palette indices are identities: editing its size must not reshuffle surviving assignments.
  const mappedColors = level.stemLanes.map((lane) =>
    lane.colors.filter((color) => color < next.palette.length),
  );
  for (let color = level.palette.length; color < next.palette.length; color++) {
    if (mappedColors.length) mappedColors[color % mappedColors.length].push(color);
  }
  next.stemLanes = level.stemLanes.flatMap((lane, index) => {
    const colors = mappedColors[index];
    // A removed color never silently redirects its instrument to an unrelated color.
    if (!colors.length) return [];
    const before = lane.colors.reduce((sum, color) => sum + oldDemand[color], 0);
    const after = colors.reduce((sum, color) => sum + newDemand[color], 0);
    const requiredBreaks =
      after === 0
        ? 1
        : Math.max(
            1,
            Math.min(after, Math.round((lane.requiredBreaks * after) / Math.max(1, before))),
          );
    return [{ ...lane, colors, requiredBreaks }];
  });
  const editedErrors = validateNativeLevel(next);
  if (editedErrors.length) throw new Error(editedErrors.join('\n'));
  return next;
}
