import { cloneLevel } from './config';
import { rebuildRingContents } from './level-editor';
import { NativeModel, validateNativeLevel } from './model';
import type { NativeLevel, NativeQueueBall, NativeBall } from './types';

export type PatternOptions = NonNullable<NativeLevel['pattern']>;
export interface RingTemplate {
  rings: number[][];
  palette: number[];
}
const mod = (n: number, d: number) => ((n % d) + d) % d;
const normalizeTurns = (turns: number) => {
  const result = mod(turns, 1);
  return result < 1e-12 || 1 - result < 1e-12 ? 0 : result;
};
const normalizeDegrees = (degrees: number) => {
  const result = mod(degrees + 180, 360) - 180;
  return result === -180 && degrees > 0 ? 180 : result;
};
const sameTurn = (a: number, b: number) => Math.abs(mod(a - b + 0.5, 1) - 0.5) < 1e-9;
function validatePattern(level: NativeLevel, options: PatternOptions): void {
  if (!options || typeof options !== 'object')
    throw new RangeError('Pattern settings are required.');
  const { colorCount, segmentsPerRing, colorsPerRing, shift } = options;
  for (const [label, n, min, max] of [
    ['Color count', colorCount, 1, 12],
    ['Segments per ring', segmentsPerRing, 1, 24],
    ['Colors per ring', colorsPerRing, 1, Math.min(colorCount, segmentsPerRing)],
    ['Ring shift', shift, -1_000_000, 1_000_000],
  ] as const) {
    if (!Number.isInteger(n) || n < min || n > max)
      throw new RangeError(`${label} must be an integer from ${min} to ${max}.`);
  }
  if (level.rings.length * colorsPerRing < colorCount)
    throw new RangeError(
      `Use at least ${Math.ceil(colorCount / level.rings.length)} colors per ring or add more rings so every palette color appears.`,
    );
  if (
    options.shiftDegrees !== undefined &&
    (!Number.isFinite(options.shiftDegrees) ||
      options.shiftDegrees < -180 ||
      options.shiftDegrees > 180)
  )
    throw new RangeError('Ring shift must be a finite angle from -180 to 180 degrees.');
  if (options.equalColorSpans !== undefined && typeof options.equalColorSpans !== 'boolean')
    throw new RangeError('Equal color spans must be a boolean.');
  if (options.equalColorSpans && segmentsPerRing % colorsPerRing !== 0)
    throw new RangeError('Equal color spans require a whole number of segments per color.');
}
function normalizePatternOptions(options: PatternOptions): PatternOptions {
  if (
    options?.equalColorSpans === true &&
    Number.isInteger(options.colorsPerRing) &&
    options.colorsPerRing >= 1 &&
    options.colorsPerRing <= 12 &&
    Number.isInteger(options.segmentsPerRing) &&
    options.segmentsPerRing >= 1 &&
    options.segmentsPerRing <= 24
  ) {
    let selected = options.colorsPerRing;
    for (let count = selected; count <= 24; count += options.colorsPerRing)
      if (Math.abs(count - options.segmentsPerRing) <= Math.abs(selected - options.segmentsPerRing))
        selected = count;
    return { ...options, segmentsPerRing: selected };
  }
  return options;
}
function ringsForPattern(
  count: number,
  { colorCount, segmentsPerRing, colorsPerRing, shift }: PatternOptions,
): number[][] {
  return Array.from({ length: count }, (_, ring) =>
    Array.from({ length: segmentsPerRing }, (_, segment) => {
      const position = mod(segment - ring * shift, segmentsPerRing);
      return mod(
        ring * colorsPerRing + Math.floor((position * colorsPerRing) / segmentsPerRing),
        colorCount,
      );
    }),
  );
}
function hsl(hue: number, saturation: number, lightness: number): number {
  const a = saturation * Math.min(lightness, 1 - lightness),
    f = (n: number) => {
      const k = (n + hue / 30) % 12;
      return Math.round(255 * (lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    };
  return (f(0) << 16) | (f(8) << 8) | f(4);
}
function colorDistance(a: number, b: number): number {
  const dr = (a >> 16) - (b >> 16),
    dg = ((a >> 8) & 255) - ((b >> 8) & 255),
    db = (a & 255) - (b & 255);
  return 0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db;
}
function resizePalette(source: number[], count: number): number[] {
  const palette = source.slice(0, count);
  const candidates = Array.from({ length: 72 }, (_, i) =>
    hsl((i % 36) * 10, i < 36 ? 0.82 : 0.62, i < 36 ? 0.62 : 0.48),
  );
  while (palette.length < count) {
    let selected = candidates[0],
      best = -1;
    for (const candidate of candidates) {
      const score = Math.min(...palette.map((existing) => colorDistance(existing, candidate)));
      if (score > best) {
        best = score;
        selected = candidate;
      }
    }
    palette.push(selected);
  }
  return palette;
}
/** Legacy shift rotates authored slots; optional shiftDegrees adds continuous contour travel.
 * New studio recipes use shift:0 and shiftDegrees, leaving ring colors independent of phase.
 */
export function generatePattern(level: NativeLevel, options: PatternOptions): NativeLevel {
  const errors = validateNativeLevel(level);
  if (errors.length) throw new Error(errors.join('\n'));
  options = normalizePatternOptions(options);
  validatePattern(level, options);
  const palette = resizePalette(level.palette, options.colorCount);
  const next = rebuildRingContents(level, {
    rings: ringsForPattern(level.rings.length, options),
    palette,
  });
  next.pattern = { ...options };
  if (options.shiftDegrees !== undefined) {
    next.ringPhaseOffsets = next.rings.map((_, ring) =>
      normalizeTurns((ring * options.shiftDegrees!) / 360),
    );
    next.ringShiftDegrees = normalizeDegrees(
      (options.shift * 360) / options.segmentsPerRing + options.shiftDegrees,
    );
  }
  return next;
}
/** Copies exact authored ring order/gaps/colors while retaining this level's song and physical tuning. */
export function applyRingTemplate(level: NativeLevel, template: RingTemplate): NativeLevel {
  if (!template || typeof template !== 'object' || !Array.isArray(template.palette))
    throw new RangeError('A ring template with an explicit palette is required.');
  return rebuildRingContents(level, { rings: template.rings, palette: template.palette });
}
/** Exact encoded recipe, retaining discrete legacy slots separately from geometric phase. */
function encodedPattern(level: NativeLevel): PatternOptions | null {
  const matches = (options: PatternOptions) => {
    try {
      validatePattern(level, options);
    } catch {
      return false;
    }
    return (
      options.colorCount === level.palette.length &&
      JSON.stringify(ringsForPattern(level.rings.length, options)) ===
        JSON.stringify(level.rings) &&
      level.rings.every((_, ring) =>
        sameTurn(level.ringPhaseOffsets?.[ring] ?? 0, (ring * (options.shiftDegrees ?? 0)) / 360),
      )
    );
  };
  if (level.pattern && matches(level.pattern)) return { ...level.pattern };
  const segmentsPerRing = level.rings[0].length,
    colorsPerRing = new Set(level.rings[0]).size;
  if (level.rings.some((r) => r.length !== segmentsPerRing || r.some((c) => c < 0))) return null;
  const shiftDegrees = level.ringPhaseOffsets
    ? normalizeDegrees((level.ringPhaseOffsets[1] ?? 0) * 360)
    : 0;
  for (let shift = 0; shift < segmentsPerRing; shift++) {
    const options = {
      colorCount: level.palette.length,
      segmentsPerRing,
      colorsPerRing,
      shift,
      shiftDegrees,
    };
    if (matches(options)) return options;
  }
  return null;
}
/** Canonical continuous UI recipe. It describes the visible layout, including legacy slot shifts. */
export function inferPattern(level: NativeLevel): PatternOptions | null {
  if (validateNativeLevel(level).length) return null;
  const encoded = encodedPattern(level);
  if (!encoded) return null;
  let shiftDegrees = normalizeDegrees(
    (encoded.shift * 360) / encoded.segmentsPerRing + (encoded.shiftDegrees ?? 0),
  );
  if (
    level.ringShiftDegrees !== undefined &&
    sameTurn(level.ringShiftDegrees / 360, shiftDegrees / 360)
  )
    shiftDegrees = level.ringShiftDegrees;
  // A one-ring figure cannot visibly encode a per-ring delta; preserve its explicit slider value.
  if (level.rings.length === 1 && level.ringShiftDegrees !== undefined)
    shiftDegrees = level.ringShiftDegrees;
  return { ...encoded, shift: 0, shiftDegrees };
}

/** Move only geometric phase. Existing arrays, ammo order/power, palette and physical tuning stay exact.
 * For legacy slot-shifted arrays, subtract the already-visible shift before adding the new delta.
 */
export function setPatternShift(level: NativeLevel, degrees: number): NativeLevel {
  if (!Number.isFinite(degrees) || degrees < -180 || degrees > 180)
    throw new RangeError('Ring shift must be a finite angle from -180 to 180 degrees.');
  const errors = validateNativeLevel(level);
  if (errors.length) throw new Error(errors.join('\n'));
  const previousRecipe = encodedPattern(level);
  const current = level.ringShiftDegrees ?? inferPattern(level)?.shiftDegrees ?? 0,
    delta = (degrees - current) / 360;
  const next = cloneLevel(level);
  next.ringPhaseOffsets = next.rings.map((_, ring) =>
    normalizeTurns((level.ringPhaseOffsets?.[ring] ?? 0) + ring * delta),
  );
  next.ringShiftDegrees = degrees;
  delete next.pattern;
  const encoded = encodedPattern(next);
  if (encoded) {
    if (previousRecipe?.equalColorSpans !== undefined)
      encoded.equalColorSpans = previousRecipe.equalColorSpans;
    next.pattern = encoded;
  }
  return next;
}
export interface SolvabilityInput {
  step: number;
  type: 'queue' | 'tray';
  index: number;
}
export interface SolvabilityProgress {
  attempt: number;
  step: number;
  maxSteps: number;
  remaining: number;
  total: number;
  simulatedSeconds: number;
}
export interface SolvabilityOptions {
  maxSimulationSeconds?: number;
  maxAttempts?: number;
  /** Total real computation cap across attempts; studio should additionally terminate its worker on Cancel. */
  maxWallTimeMs?: number;
  onProgress?: (progress: SolvabilityProgress) => void;
}
export interface SolvabilityAttempt {
  strategy: string;
  status: 'won' | 'failed' | 'budget';
  steps: number;
  remaining: number;
  simulatedSeconds: number;
}
export interface SolvabilityResult {
  status: 'verified-win' | 'not-verified';
  reason: string;
  attempts: number;
  strategy: string;
  /** Replay these public inputs immediately before the indexed fixed simulation step. */
  inputs: SolvabilityInput[];
  steps: number;
  fixedStep: number;
  remaining: number;
  simulatedSeconds: number;
  summaries: SolvabilityAttempt[];
}
const STRATEGIES = [
  { name: 'inner-first', interval: 0.7, reliefSeconds: 8, fillDeficits: false },
  { name: 'deficit-first', interval: 0.52, reliefSeconds: 4, fillDeficits: true },
  { name: 'patient-inner-first', interval: 0.85, reliefSeconds: 12, fillDeficits: false },
];
/** A bounded concrete playthrough, not a proof that an unverified puzzle is impossible.
 * Only fireQueue/fireTray mutate input state. No teleporting, bonus ammo, boosters, or physics edits.
 * The strategies and step receipts are deterministic; a machine-dependent wall timeout only
 * limits how far they are explored and can never turn an incomplete attempt into a verified win.
 */
export function verifyPlayableLevel(
  level: NativeLevel,
  options: SolvabilityOptions = {},
): SolvabilityResult {
  const seconds = options.maxSimulationSeconds ?? 300,
    attemptLimit = options.maxAttempts ?? 2,
    wallLimit = options.maxWallTimeMs ?? 8000;
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 1200)
    throw new RangeError(
      'Verification duration must be greater than zero and at most 1200 simulated seconds.',
    );
  if (!Number.isInteger(attemptLimit) || attemptLimit < 1 || attemptLimit > STRATEGIES.length)
    throw new RangeError(
      `Verification attempts must be an integer from 1 to ${STRATEGIES.length}.`,
    );
  if (!Number.isFinite(wallLimit) || wallLimit < 1 || wallLimit > 60_000)
    throw new RangeError('Verification time budget must be from 1 to 60,000 milliseconds.');
  const fixedStep = 1 / 120,
    maxSteps = Math.ceil(seconds / fixedStep),
    summaries: SolvabilityAttempt[] = [],
    started = performance.now();
  const invalid = validateNativeLevel(level);
  if (invalid.length)
    return {
      status: 'not-verified',
      reason: `Invalid level: ${invalid.join(' ')}`,
      attempts: 0,
      strategy: 'none',
      inputs: [],
      steps: 0,
      fixedStep,
      remaining: 0,
      simulatedSeconds: 0,
      summaries,
    };
  let best: SolvabilityResult | undefined,
    wallExpired = false;
  for (let attempt = 0; attempt < attemptLimit; attempt++) {
    const strategy = STRATEGIES[attempt],
      model = new NativeModel(cloneLevel(level)),
      inputs: SolvabilityInput[] = [];
    let nextInput = 0,
      lastProgress = 0,
      lastRemaining = model.remaining,
      lastRelief = -100,
      steps = 0;
    const report = () =>
      options.onProgress?.({
        attempt: attempt + 1,
        step: steps,
        maxSteps,
        remaining: model.remaining,
        total: model.total,
        simulatedSeconds: model.time,
      });
    report();
    for (; steps < maxSteps && model.status === 'playing'; steps++) {
      if (steps % 120 === 0 && performance.now() - started >= wallLimit) {
        wallExpired = true;
        break;
      }
      if (model.time >= nextInput && !model.isAnimatingShot) {
        const inner = model.rings.find((r) => r.eligible && r.segments.some((s) => s.alive));
        const need = new Map<number, number>();
        for (const segment of inner?.segments ?? [])
          if (segment.alive) need.set(segment.color, (need.get(segment.color) ?? 0) + 1);
        const active = model.activeBalls,
          stored = model.trayBalls.filter((b) => b.state === 'stored'),
          front = model.queueBalls().filter((b) => b.row === 0);
        const activePower = (color: number) =>
          active.filter((b) => b.color === color).reduce((sum, b) => sum + b.power, 0);
        const deficit = (color: number) => (need.get(color) ?? 0) - activePower(color);
        const stalled =
          model.time - lastProgress >= strategy.reliefSeconds &&
          model.time - lastRelief >= strategy.reliefSeconds;
        const room = active.length < model.activeCapacity,
          usefulActive = active.some((b) => need.has(b.color));
        const score = (ball: NativeBall | NativeQueueBall) =>
          (deficit(ball.color) > 0 ? 1000 : 0) +
          (need.get(ball.color) ?? 0) * 10 +
          Math.min(ball.power, need.get(ball.color) ?? 0);
        const choose = <T extends NativeBall | NativeQueueBall>(balls: T[]) =>
          balls
            .filter((b) => need.has(b.color) && (deficit(b.color) > 0 || stalled))
            .sort((a, b) => score(b) - score(a))[0];
        const tray = choose(stored),
          queued = choose(front);
        let action: SolvabilityInput | undefined;
        if (tray && (room || stalled || (strategy.fillDeficits && deficit(tray.color) > 0)))
          action = { step: steps, type: 'tray', index: tray.slot };
        else if (
          queued &&
          (room ||
            ((stalled || (strategy.fillDeficits && deficit(queued.color) > 0)) &&
              model.trayBalls.length < level.trayCapacity))
        )
          action = { step: steps, type: 'queue', index: queued.column };
        else if (
          !usefulActive &&
          front.length &&
          (room || model.trayBalls.length < level.trayCapacity)
        ) {
          // Reveal later entries only when the active field cannot clear the inner ring.
          action = { step: steps, type: 'queue', index: front[0].column };
        }
        if (action) {
          const accepted =
            action.type === 'tray' ? model.fireTray(action.index) : model.fireQueue(action.index);
          if (accepted) {
            inputs.push(action);
            if (!room || stalled) lastRelief = model.time;
            nextInput = model.time + strategy.interval;
          } else nextInput = model.time + 0.1;
        } else nextInput = model.time + 0.1;
      }
      model.step(fixedStep);
      model.drainEvents();
      if (model.remaining !== lastRemaining) {
        lastRemaining = model.remaining;
        lastProgress = model.time;
      }
      if (steps % 600 === 599) report();
    }
    report();
    const summary: SolvabilityAttempt = {
      strategy: strategy.name,
      status: model.status === 'playing' ? 'budget' : model.status,
      steps,
      remaining: model.remaining,
      simulatedSeconds: model.time,
    };
    summaries.push(summary);
    const result: SolvabilityResult = {
      status: model.status === 'won' ? 'verified-win' : 'not-verified',
      reason:
        model.status === 'won'
          ? 'A recorded sequence of ordinary queue and tray inputs completed every segment.'
          : wallExpired
            ? 'The computation time budget ended before a win was verified. This does not mean the puzzle is impossible.'
            : 'The tested ordinary-input strategies did not produce a win within the configured budget; this is not proof that the puzzle is impossible.',
      attempts: attempt + 1,
      strategy: strategy.name,
      inputs,
      steps,
      fixedStep,
      remaining: model.remaining,
      simulatedSeconds: model.time,
      summaries: [...summaries],
    };
    if (result.status === 'verified-win') return result;
    if (!best || result.remaining < best.remaining) best = result;
    if (wallExpired) break;
  }
  return {
    ...best!,
    reason: wallExpired
      ? 'The computation time budget ended before a win was verified. This does not mean the puzzle is impossible.'
      : best!.reason,
    attempts: summaries.length,
    summaries,
  };
}
