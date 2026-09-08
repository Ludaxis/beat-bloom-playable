import { colorUnlockTargets } from './stem-unlocks';
import { cloneLevel } from './config';
import type { NativeLevel, NativeQueueEntry } from './types';

export const QUEUED_BALL_POWER = 3;

/** Count actual colored pieces across the entire authored level, ignoring gaps. */
export function colorDemand(rings: number[][], colorCount: number): number[] {
  if (!Number.isInteger(colorCount) || colorCount < 1 || colorCount > 12)
    throw new RangeError('Color count must be an integer from 1 to 12.');
  const demand = Array<number>(colorCount).fill(0);
  for (const ring of rings)
    for (const color of ring) {
      if (!Number.isInteger(color) || color < -1 || color >= colorCount)
        throw new RangeError('A ring references an invalid palette index.');
      if (color >= 0) demand[color]++;
    }
  return demand;
}

/**
 * Allocate three-hit balls inside-out. Unused credit carries into later rings of the same
 * color; each ring's newly needed batches are interleaved in its authored color order.
 * This gives the minimum ceil(total pieces / 3) balls per color without changing the pattern.
 */
export function buildQueue(rings: number[][], colorCount: number): NativeQueueEntry[] {
  colorDemand(rings, colorCount);
  const credits = Array<number>(colorCount).fill(0),
    queue: NativeQueueEntry[] = [];
  for (const ring of rings) {
    const remaining = new Map<number, number>();
    for (const color of ring) if (color >= 0) remaining.set(color, (remaining.get(color) ?? 0) + 1);
    for (const [color, amount] of remaining) {
      remaining.set(color, Math.max(0, amount - credits[color]));
      credits[color] = Math.max(0, credits[color] - amount);
    }
    while ([...remaining.values()].some((amount) => amount > 0)) {
      for (const [color, amount] of remaining) {
        if (amount <= 0) continue;
        queue.push({ color, power: QUEUED_BALL_POWER, mystery: false });
        remaining.set(color, Math.max(0, amount - QUEUED_BALL_POWER));
        credits[color] += Math.max(0, QUEUED_BALL_POWER - amount);
      }
    }
  }
  return queue;
}

/**
 * Web authoring normalization, after structural level validation. A valid minimal all-three
 * queue retains its authored order; forced rebuilding is reserved for structural pattern edits.
 */
export function normalizePlayableQueue(level: NativeLevel, forcedRebuild = false): NativeLevel {
  const next = cloneLevel(level),
    demand = colorDemand(next.rings, next.palette.length);
  const counts = Array<number>(next.palette.length).fill(0);
  const allThree = next.queue.every((ball) => {
    if (
      !Number.isInteger(ball.color) ||
      ball.color < 0 ||
      ball.color >= counts.length ||
      ball.power !== QUEUED_BALL_POWER
    )
      return false;
    counts[ball.color]++;
    return true;
  });
  const minimal =
    allThree &&
    counts.every((count, color) => count === Math.ceil(demand[color] / QUEUED_BALL_POWER));
  next.queue =
    !forcedRebuild && minimal
      ? next.queue.map((ball) => ({ ...ball, mystery: false }))
      : buildQueue(next.rings, next.palette.length);
  next.ballScale ??= 0.85;
  next.ballSpeed ??= 1.0;
  next.queuePolicy = 'fixed-three';
  next.stemUnlockPolicy = 'half-per-color';
  const targets = colorUnlockTargets(next);
  next.stemLanes = next.stemLanes.map((lane) => ({
    ...lane,
    requiredBreaks: Math.max(
      1,
      [...new Set(lane.colors)].reduce((sum, color) => sum + targets[color], 0),
    ),
  }));
  return next;
}

/** Mix positions within each three-ball row without pulling late colors ahead of early demand. */
export function shuffleQueueRows(queue: NativeQueueEntry[], seed: number): NativeQueueEntry[] {
  let state = seed >>> 0 || 1;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  const next = queue.map((ball) => ({ ...ball }));
  for (let start = 0; start < next.length; start += 3) {
    for (let i = Math.min(start + 2, next.length - 1); i > start; i--) {
      const j = start + Math.floor(random() * (i - start + 1));
      [next[i], next[j]] = [next[j], next[i]];
    }
  }
  return next;
}
