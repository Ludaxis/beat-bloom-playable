import { validateAdFlow } from './ad-flow';
import { ballFlightPosition } from './flight';
import { colorUnlockTargets, laneUnlockProgress } from './stem-unlocks';
import {
  cloneLevel,
  DEFAULT_NATIVE_LEVEL,
  NATIVE_CONFIG,
  deriveConfigForLevel,
  screenToWorld,
} from './config';
import {
  clamp,
  closestPoint,
  distance,
  makeContour,
  heartHalfPhase,
  normalize,
  offsetContour,
  pointAtArc,
  pointInsidePolygon,
  rotate,
  segmentPath,
  smootherstep,
  smoothstep,
} from './geometry';
import { colorDemand, QUEUED_BALL_POWER } from './queue';
import { validateEndCardDesign } from './endcard-settings';
import type {
  NativeBall,
  NativeConfig,
  NativeEvent,
  NativeEventType,
  NativeLevel,
  NativeQueueBall,
  NativeRing,
  NativeSegment,
  NativeSnapshot,
  Vec2,
} from './types';
export type {
  NativeBall,
  NativeEvent,
  NativeLevel,
  NativeRing,
  NativeSegment,
  NativeSnapshot,
} from './types';
const TAU = Math.PI * 2;
// Broad-phase rejection stays slightly wider than the exact capsule test at floating-point edges.
const CONTACT_BOUNDS_PADDING = 1e-9;
const vcopy = (v: Vec2): Vec2 => ({ x: v.x, y: v.y });
const magnitude = (v: Vec2) => Math.hypot(v.x, v.y);

/** Native BeatBloomAimSolver in screen-down coordinates. */
export function solveBallisticAim(
  from: Vec2,
  target: Vec2,
  gravity: number,
  preferred = 0.42,
  maxSpeed = 9.5,
): { velocity: Vec2; flightSeconds: number; reachable: boolean } {
  const d = { x: target.x - from.x, y: target.y - from.y };
  const velocityAt = (t: number) => ({ x: d.x / t, y: d.y / t - 0.5 * gravity * t });
  let t = clamp(preferred, 0.12, 2.5),
    v = velocityAt(t);
  if (magnitude(v) <= maxSpeed) return { velocity: v, flightSeconds: t, reachable: true };
  if (gravity <= 0.0001) {
    const len = magnitude(v);
    return {
      velocity: { x: (v.x * maxSpeed) / len, y: (v.y * maxSpeed) / len },
      flightSeconds: magnitude(d) / maxSpeed,
      reachable: false,
    };
  }
  let low = 0.12,
    high = 2.5;
  for (let i = 0; i < 48; i++) {
    const third = (high - low) / 3,
      a = low + third,
      b = high - third;
    if (magnitude(velocityAt(a)) <= magnitude(velocityAt(b))) high = b;
    else low = a;
  }
  const cheapest = (low + high) * 0.5,
    cheapV = velocityAt(cheapest);
  if (magnitude(cheapV) <= maxSpeed && cheapest > preferred) {
    low = clamp(preferred, 0.12, 2.5);
    high = cheapest;
    for (let i = 0; i < 48; i++) {
      const mid = (low + high) * 0.5;
      if (magnitude(velocityAt(mid)) > maxSpeed) low = mid;
      else high = mid;
    }
    return { velocity: velocityAt(high), flightSeconds: high, reachable: true };
  }
  t = cheapest;
  v = cheapV;
  const speed = magnitude(v),
    reachable = speed <= maxSpeed;
  if (!reachable) v = { x: (v.x * maxSpeed) / speed, y: (v.y * maxSpeed) / speed };
  return { velocity: v, flightSeconds: t, reachable };
}
export function conveyorTravelBeats(
  beats: number,
  every: number,
  duration: number,
  boost: number,
): number {
  if (every <= 0 || duration <= 0 || boost <= 0) return beats;
  duration = Math.min(every, duration);
  const cycles = Math.floor(beats / every),
    local = beats - cycles * every,
    pulse = Math.max(0, local - (every - duration));
  const integral = 0.5 * pulse - (duration * Math.sin((TAU * pulse) / duration)) / (4 * Math.PI);
  return beats + Math.max(0, boost) * (cycles * duration * 0.5 + integral);
}

/** Data-validation boundary for designer imports. No silent repairs or ammo replacement. */
export function validateNativeLevel(
  value: unknown,
  options: { queueBalance?: boolean } = {},
): string[] {
  const errors: string[] = [];
  const object = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);
  if (!object(value)) return ['Level must be an object.'];
  const l = value as unknown as NativeLevel;
  if (l.adFlow !== undefined) errors.push(...validateAdFlow(l.adFlow));
  if (l.endCard !== undefined) errors.push(...validateEndCardDesign(l.endCard));
  if (l.ringAppearance !== undefined) {
    const a = l.ringAppearance;
    if (
      !object(a) ||
      ['colorFade', 'shadowOpacity', 'shadowFade'].some(
        (key) => !Number.isFinite(a[key]) || Number(a[key]) < 0 || Number(a[key]) > 1,
      )
    )
      errors.push(
        'ringAppearance requires colorFade, shadowOpacity and shadowFade between 0 and 1.',
      );
  }
  if (l.tutorial !== undefined) {
    const t = l.tutorial;
    if (
      !object(t) ||
      typeof t.enabled !== 'boolean' ||
      !['auto', 'top', 'slots'].includes(t.placement as string)
    )
      errors.push('tutorial requires enabled (true or false) and placement (auto, top or slots).');
  }
  if (l.schemaVersion !== 1) errors.push('Unsupported schemaVersion; expected 1.');
  for (const field of ['id', 'name', 'songId'] as const)
    if (typeof l[field] !== 'string' || !l[field].trim() || l[field].length > 200)
      errors.push(`${field} must be a non-empty string of at most 200 characters.`);
  if (
    !['hexagon', 'heart', 'flower', 'ring', 'triangle', 'square', 'pentagon', 'heptagon'].includes(
      l.shape,
    )
  )
    errors.push('Unsupported contour shape.');
  const paletteValid =
    Array.isArray(l.palette) &&
    l.palette.length >= 1 &&
    l.palette.length <= 12 &&
    l.palette.every((c) => Number.isInteger(c) && c >= 0 && c <= 0xffffff);
  if (!paletteValid) errors.push('Palette must contain 1–12 integer RGB colors.');
  const colorCount = paletteValid ? l.palette.length : 0;
  const ringsValid =
    Array.isArray(l.rings) &&
    l.rings.length >= 1 &&
    l.rings.length <= 80 &&
    l.rings.every(
      (r) =>
        Array.isArray(r) &&
        r.length >= 1 &&
        r.length <= 24 &&
        r.every((c) => Number.isInteger(c) && c >= -1 && c < colorCount),
    );
  if (!ringsValid)
    errors.push('Rings must contain 1–24 valid palette indexes; -1 means an authored gap.');
  if (ringsValid && !l.rings.some((r) => r.some((c) => c >= 0)))
    errors.push('A playable needs at least one colored segment.');
  if (
    l.ringPhaseOffsets !== undefined &&
    (!Array.isArray(l.ringPhaseOffsets) ||
      !ringsValid ||
      l.ringPhaseOffsets.length !== l.rings.length ||
      l.ringPhaseOffsets.some((offset) => !Number.isFinite(offset) || offset < 0 || offset >= 1))
  )
    errors.push(
      'ringPhaseOffsets must contain one finite normalized turn from 0 (inclusive) to 1 (exclusive) per ring.',
    );
  if (
    l.ringShiftDegrees !== undefined &&
    (!Number.isFinite(l.ringShiftDegrees) || l.ringShiftDegrees < -180 || l.ringShiftDegrees > 180)
  )
    errors.push('ringShiftDegrees must be a finite angle from -180 to 180 degrees.');
  if (
    object(l.pattern) &&
    l.pattern.shiftDegrees !== undefined &&
    (!Number.isFinite(l.pattern.shiftDegrees) ||
      l.pattern.shiftDegrees < -180 ||
      l.pattern.shiftDegrees > 180)
  )
    errors.push('pattern.shiftDegrees must be a finite angle from -180 to 180 degrees.');
  if (
    object(l.pattern) &&
    l.pattern.equalColorSpans !== undefined &&
    typeof l.pattern.equalColorSpans !== 'boolean'
  )
    errors.push('pattern.equalColorSpans must be a boolean.');
  const queueValid =
    Array.isArray(l.queue) &&
    l.queue.length >= 1 &&
    l.queue.length <= 1000 &&
    l.queue.every(
      (q) =>
        object(q) &&
        Number.isInteger(q.color) &&
        q.color >= 0 &&
        q.color < colorCount &&
        Number.isInteger(q.power) &&
        q.power >= 1 &&
        q.power <= 20 &&
        typeof q.mystery === 'boolean',
    );
  if (!queueValid)
    errors.push('Queue entries require a valid color, power 1–20, and mystery boolean.');
  for (const [key, min, max] of [
    ['ballScale', 0.6, 1.1],
    ['ballSpeed', 0.8, 1.25],
  ] as const)
    if (l[key] !== undefined && (!Number.isFinite(l[key]) || l[key]! < min || l[key]! > max))
      errors.push(`${key} must be between ${min} and ${max}.`);
  if (l.stemUnlockPolicy !== undefined && l.stemUnlockPolicy !== 'half-per-color')
    errors.push('stemUnlockPolicy must be half-per-color when provided.');
  if (l.queuePolicy !== undefined && l.queuePolicy !== 'fixed-three')
    errors.push('queuePolicy must be fixed-three when provided.');
  for (const [name, min, max] of [
    ['innerRadius', 0.5, 10],
    ['lineSpacing', 0.1, 2],
    ['lineThickness', 0.015, 1],
    ['bpm', 30, 300],
    ['loopBeats', 1, 1024],
    ['queueColumns', 1, 5],
    ['activeCapacity', 1, 8],
    ['trayCapacity', 1, 5],
    ['arenaRingCapacity', 1, 12],
    ['maxRenderedRings', 1, 24],
    ['previewRingCount', 0, 8],
    ['flowerPetals', 3, 9],
    ['roundness', 0, 1],
    ['segmentGap', 0, 0.5],
    ['beatsPerBar', 1, 16],
    ['downbeatOffset', 0, 30],
    ['levelNumber', 1, 1000],
  ] as const) {
    if (!Number.isFinite(l[name]) || l[name] < min || l[name] > max)
      errors.push(`${name} must be between ${min} and ${max}.`);
  }
  for (const name of [
    'queueColumns',
    'activeCapacity',
    'trayCapacity',
    'arenaRingCapacity',
    'maxRenderedRings',
    'previewRingCount',
    'flowerPetals',
    'beatsPerBar',
    'levelNumber',
  ] as const)
    if (!Number.isInteger(l[name])) errors.push(`${name} must be an integer.`);
  if (l.lineThickness + NATIVE_CONFIG.field.wallThickness * 0.11 >= l.lineSpacing)
    errors.push('Line thickness must leave a visible and physical gap between rings.');
  if (l.maxRenderedRings < l.arenaRingCapacity)
    errors.push('maxRenderedRings must cover the gameplay arena.');
  if (!object(l.motion)) errors.push('Motion settings are missing or invalid.');
  else {
    for (const [name, min, max] of [
      ['degreesPerBeat', 0, 90],
      ['speedMultiplier', 0, 5],
      ['flipEaseBeats', 0.01, 16],
      ['conveyorBeatsPerSlot', 0, 200],
      ['conveyorPulseEveryBeats', 0, 200],
      ['conveyorPulseDurationBeats', 0, 200],
      ['conveyorPulseSpeedBoost', 0, 5],
    ] as const) {
      const n = l.motion[name];
      if (!Number.isFinite(n) || n < min || n > max)
        errors.push(`motion.${name} must be between ${min} and ${max}.`);
    }
    if (
      l.motion.phaseDegrees !== undefined &&
      (!Number.isFinite(l.motion.phaseDegrees) || Math.abs(l.motion.phaseDegrees) > 360)
    )
      errors.push('motion.phaseDegrees must be a finite angle between -360 and 360.');
    for (const name of ['conveyorAlternate', 'conveyorHoldFigure'] as const)
      if (typeof l.motion[name] !== 'boolean') errors.push(`motion.${name} must be a boolean.`);
  }
  if (
    !Array.isArray(l.sections) ||
    l.sections.length > 512 ||
    l.sections.some(
      (s) =>
        !object(s) ||
        !Number.isFinite(s.startBeat) ||
        s.startBeat < 0 ||
        s.startBeat >= l.loopBeats ||
        !Number.isFinite(s.degreesPerBeat) ||
        s.degreesPerBeat < 0 ||
        s.degreesPerBeat > 180 ||
        ![-1, 1].includes(s.direction) ||
        !Number.isFinite(s.intensity) ||
        s.intensity < 0 ||
        s.intensity > 1,
    )
  )
    errors.push('Song sections are invalid.');
  else if (l.sections.some((s, i) => i > 0 && s.startBeat <= l.sections[i - 1].startBeat))
    errors.push('Song sections must be ordered by unique ascending startBeat.');
  if (
    !Array.isArray(l.stemLanes) ||
    l.stemLanes.length > 12 ||
    l.stemLanes.some(
      (s) =>
        !object(s) ||
        !Number.isInteger(s.stem) ||
        s.stem < 0 ||
        s.stem > 12 ||
        !Array.isArray(s.colors) ||
        !s.colors.length ||
        s.colors.some((c) => !Number.isInteger(c) || c < 0 || c >= colorCount) ||
        !Number.isInteger(s.requiredBreaks) ||
        s.requiredBreaks < 1,
    )
  )
    errors.push('Stem lanes are invalid.');
  else if (new Set(l.stemLanes.map((lane) => lane.stem)).size !== l.stemLanes.length)
    errors.push('Stem lanes cannot repeat the same instrument.');
  else if (l.stemLanes.some((lane) => new Set(lane.colors).size !== lane.colors.length))
    errors.push('Stem lanes cannot repeat the same color.');
  if (l.referenceCalibration !== undefined) {
    const r = l.referenceCalibration;
    if (
      !object(r) ||
      typeof r.video !== 'string' ||
      !Number.isFinite(r.phaseDegrees) ||
      Math.abs(r.phaseDegrees) > 360 ||
      !Number.isFinite(r.physicsHandoffSeconds) ||
      r.physicsHandoffSeconds < 0 ||
      r.physicsHandoffSeconds > 0.2 ||
      (r.audioSourceOffsetSeconds !== undefined &&
        (!Number.isFinite(r.audioSourceOffsetSeconds) ||
          r.audioSourceOffsetSeconds < 0 ||
          r.audioSourceOffsetSeconds > 10)) ||
      !Number.isFinite(r.measuredFromSeconds) ||
      !Number.isFinite(r.measuredToSeconds) ||
      r.measuredToSeconds < r.measuredFromSeconds ||
      !Number.isFinite(r.angularRmsDegrees)
    )
      errors.push('Reference calibration is invalid.');
  }
  if (!errors.length && options.queueBalance !== false) {
    const demand = colorDemand(l.rings, colorCount);
    if (l.queuePolicy === 'fixed-three') {
      if (l.queue.some((q) => q.power !== QUEUED_BALL_POWER))
        errors.push(`Every queued ball must start with power ${QUEUED_BALL_POWER}.`);
      for (let color = 0; color < colorCount; color++) {
        const expected = Math.ceil(demand[color] / QUEUED_BALL_POWER),
          actual = l.queue.filter((q) => q.color === color).length;
        if (expected !== actual)
          errors.push(
            `Color ${color} has ${demand[color]} segments and requires exactly ${expected} queued balls of power ${QUEUED_BALL_POWER}; found ${actual}.`,
          );
      }
    } else
      for (let color = 0; color < colorCount; color++) {
        const supply = l.queue.filter((q) => q.color === color).reduce((n, q) => n + q.power, 0);
        if (demand[color] !== supply)
          errors.push(
            `Color ${color} has ${demand[color]} segments but ${supply} ball power; preserve exact per-color power.`,
          );
      }
  }
  return errors;
}
export function importNativeLevel(json: string): NativeLevel {
  const value = JSON.parse(json);
  const errors = validateNativeLevel(value);
  if (errors.length) throw Error(errors.join('\n'));
  return cloneLevel(value);
}
export function exportNativeLevel(level: NativeLevel): string {
  const errors = validateNativeLevel(level);
  if (errors.length) throw Error(errors.join('\n'));
  return JSON.stringify(level, null, 2) + '\n';
}

/**
 * Source-parameter web port. Fixed-step gravity and swept capsule contacts reproduce the native
 * rules, ballistic aim, rigid moving figure, authored color conveyor, compression, and tray transfers.
 * This is not Unity/Box2D byte-for-byte determinism; render and collision geometry share each path.
 */
export class NativeModel {
  readonly level: NativeLevel;
  readonly config: NativeConfig;
  rings: NativeRing[] = [];
  balls: NativeBall[] = [];
  wallPoints: Vec2[] = [];
  previousWallPoints: Vec2[] = [];
  time = 0;
  beats = 0;
  rotation = 0;
  angularVelocity = 0;
  compression = 0;
  removedInnerRings = 0;
  shots = 0;
  status: 'playing' | 'won' | 'failed' = 'playing';
  warning: number | null = null;
  private brokenColors: number[] = [];
  private unlockTargets: number[] = [];
  stemProgress: number[] = [];
  unlockedStems: number[] = [];
  private consumed = new Set<number>();
  private queuePower = new Map<number, number>();
  rainbowAvailable = true;
  extraBallAvailable = true;
  private extraCenterCapacity = 0;
  private events: NativeEvent[] = [];
  private accumulator = 0;
  private nextId = 1;
  private contour: Vec2[];
  private contourCache = new Map<number, Vec2[]>();
  private contactBounds = new WeakMap<
    Vec2[],
    { minX: number; minY: number; maxX: number; maxY: number }
  >();
  private geometryStep = 0.125;
  private compressionFrom = 0;
  private compressionTo = 0;
  private compressionStart = 0;
  private compressionDuration = 1;
  private lastInput = -1;
  private lastBreak = 0;
  private noMovesSince = -1;
  private motionFrom = 1;
  private motionTo = 1;
  private motionChangeBeat = 0;
  private lastSection = -1;
  private contactReceipts = new Map<number, Map<number, number>>();
  constructor(
    level: NativeLevel = DEFAULT_NATIVE_LEVEL,
    config: NativeConfig = deriveConfigForLevel(level),
  ) {
    const errors = validateNativeLevel(level);
    if (errors.length) throw Error(errors.join('\n'));
    this.level = cloneLevel(level);
    this.config = JSON.parse(JSON.stringify(config));
    this.contour = makeContour(level.shape, level.flowerPetals, level.roundness);
    this.rotation = (-(level.motion.phaseDegrees ?? 56) * Math.PI) / 180;
    let id = 0;
    this.rings = level.rings.map((colors, ringId) => ({
      id: ringId,
      sourceLayer: ringId,
      radius: 0,
      rotation: this.rotation,
      visible: false,
      eligible: false,
      preview: false,
      alpha: 1,
      points: [],
      layoutLayer: ringId,
      segments: colors.map((color, index) => ({
        id: id++,
        index,
        ringId,
        color,
        alive: color >= 0,
        points: [],
        previousPoints: [],
        brokenAt: -100,
      })),
    }));
    this.unlockTargets = colorUnlockTargets(level);
    this.brokenColors = level.palette.map(() => 0);
    this.stemProgress = level.stemLanes.map(() => 0);
    this.rebuildGeometry();
  }
  get activeCapacity(): number {
    return Math.min(6, this.level.activeCapacity + this.extraCenterCapacity);
  }
  get remaining(): number {
    return this.rings.reduce((n, r) => n + r.segments.filter((s) => s.alive).length, 0);
  }
  get total(): number {
    return this.level.rings.flat().filter((c) => c >= 0).length;
  }
  get activeBalls(): NativeBall[] {
    return this.balls.filter((b) => b.state === 'active' || b.state === 'incoming');
  }
  get trayBalls(): NativeBall[] {
    return this.balls
      .filter((b) => b.state === 'stored' || b.state === 'banking')
      .sort((a, b) => a.slot - b.slot);
  }
  get isAnimatingShot(): boolean {
    return this.balls.some((b) => b.state === 'incoming');
  }
  drainEvents(): NativeEvent[] {
    const result = this.events;
    this.events = [];
    return result;
  }
  snapshot(): NativeSnapshot {
    return {
      time: this.time,
      status: this.status,
      remaining: this.remaining,
      total: this.total,
      shots: this.shots,
      active: this.activeBalls.length,
      activeCapacity: this.activeCapacity,
      tray: this.trayBalls.length,
      queue: this.level.queue.length - this.consumed.size,
      removedInnerRings: this.removedInnerRings,
      compression: this.compression,
      warning: this.warning,
      stemProgress: [...this.stemProgress],
      unlockedStems: [...this.unlockedStems],
    };
  }
  queueBalls(): NativeQueueBall[] {
    const rows = Array(this.level.queueColumns).fill(0);
    const v = this.config.view;
    return this.level.queue.flatMap((entry, sourceIndex) => {
      if (this.consumed.has(sourceIndex)) return [];
      const column = sourceIndex % this.level.queueColumns,
        row = rows[column]++;
      const gap = v.queueX.length > 1 ? v.queueX[1] - v.queueX[0] : 76;
      const x =
        this.level.queueColumns === 3
          ? v.queueX[column]
          : v.center.x + (column - (this.level.queueColumns - 1) * 0.5) * gap;
      return [
        {
          ...entry,
          power: this.queuePower.get(sourceIndex) ?? entry.power,
          sourceIndex,
          column,
          row,
          mystery: entry.mystery && row > 0,
          position: screenToWorld({ x, y: v.queueY + row * v.queuePitchY }, this.config),
          radius: v.queueRadius / this.config.view.pixelsPerUnit,
          fireable: row === 0,
        },
      ];
    });
  }
  fireQueue(column: number): boolean {
    const entry = this.queueBalls().find((q) => q.column === column && q.row === 0);
    if (!entry) return false;
    if (!this.canStartShot()) return false;
    if (!this.reserveSlot()) return this.refuse('Both the active field and tray are full.');
    this.consumed.add(entry.sourceIndex);
    const b = this.makeBall(entry.color, entry.power, entry.position, entry.sourceIndex);
    this.balls.push(b);
    this.beginIncoming(b, entry.position);
    return true;
  }
  /** Native BoosterLaunchWildcardBall: center launch, capacity checked, five piercing breaks.
   * Each break debits one power of that color from the queue tail, preserving native ammo policy. */
  applyExtraBall(): boolean {
    if (!this.extraBallAvailable || this.status !== 'playing' || this.activeCapacity >= 6)
      return false;
    this.extraCenterCapacity++;
    this.extraBallAvailable = false;
    this.warning = null;
    this.noMovesSince = -1;
    this.emit('booster', { x: 0, y: 0 }, -1, { reason: 'extra_ball', power: this.activeCapacity });
    return true;
  }
  fireRainbow(): boolean {
    // Web playables have no boosters; wildcard queue debits belong only to the raw native profile.
    if (this.level.queuePolicy === 'fixed-three') return false;
    if (!this.rainbowAvailable || this.balls.some((b) => b.color === 99 && b.state === 'active'))
      return this.refuse('The rainbow ball is not available.');
    if (!this.canStartShot() || !this.reserveSlot()) return false;
    let best: Vec2 = { x: 0, y: -1 },
      bestDistance = Infinity;
    for (const ring of this.rings) {
      if (!ring.eligible) continue;
      for (const segment of ring.segments) {
        if (!segment.alive) continue;
        const p = segment.points[Math.floor(segment.points.length / 2)],
          d = magnitude(p);
        if (d < bestDistance) {
          best = p;
          bestDistance = d;
        }
      }
    }
    const direction = normalize(best),
      speed = this.config.physics.launchSpeed;
    this.launchBall(99, 5, { x: 0, y: 0 }, { x: direction.x * speed, y: direction.y * speed });
    this.rainbowAvailable = false;
    this.lastInput = this.time;
    this.shots++;
    return true;
  }
  fireTray(slot: number): boolean {
    const b = this.trayBalls.find((b) => b.slot === slot && b.state === 'stored');
    if (!b) return false;
    if (!this.canStartShot()) return false;
    // Removing the selected stored ball frees its slot before oldest-ball banking, exactly as native does.
    const from = vcopy(b.position);
    b.state = 'incoming';
    this.compactTray();
    if (!this.reserveSlot(b.id)) {
      b.state = 'stored';
      this.compactTray();
      return this.refuse('The field cannot accept another ball.');
    }
    this.beginIncoming(b, from);
    return true;
  }
  /** Reproducible QA / comparison input. Same physical launch, without the queue-to-center tween. */
  launchBall(
    color: number,
    power: number,
    position: Vec2 = { x: 0, y: 0 },
    velocity?: Vec2,
  ): NativeBall {
    const b = this.makeBall(color, power, position, -1);
    b.state = 'active';
    b.launchedAt = this.time;
    b.velocity = velocity ? vcopy(velocity) : this.aimVelocity(color, position);
    this.balls.push(b);
    this.emit('launch', b.position, color, { ballId: b.id, power, speed: magnitude(b.velocity) });
    return b;
  }
  step(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.accumulator += Math.min(dt, 0.25);
    const fixed = this.config.physics.fixedStep;
    let n = 0;
    while (this.accumulator + 1e-10 >= fixed && n++ < 32) {
      this.accumulator -= fixed;
      this.fixedStep(fixed);
    }
  }
  private canStartShot(): boolean {
    if (this.status !== 'playing') return false;
    if (this.isAnimatingShot || this.time - this.lastInput < this.config.timing.inputCooldown)
      return this.refuse('The current ball is still launching.');
    return true;
  }
  private refuse(reason: string): false {
    this.emit('refused', { x: 0, y: 0 }, -1, { reason });
    return false;
  }
  private reserveSlot(excludeId = -1): boolean {
    const active = this.activeBalls.filter((b) => b.id !== excludeId);
    if (active.length < this.activeCapacity) return true;
    if (this.trayBalls.length >= this.level.trayCapacity) return false;
    const oldest = active.sort((a, b) => a.launchedAt - b.launchedAt)[0];
    this.bankBall(oldest);
    return true;
  }
  private makeBall(color: number, power: number, position: Vec2, sourceIndex: number): NativeBall {
    const visualRadius = this.config.view.queueRadius / this.config.view.pixelsPerUnit;
    return {
      id: this.nextId++,
      sourceIndex,
      color,
      power,
      state: 'incoming',
      position: vcopy(position),
      previousPosition: vcopy(position),
      velocity: { x: 0, y: 0 },
      radius:
        visualRadius *
        this.config.physics.collisionRadiusRatio *
        (this.config.view.activeBallScale ?? 1),
      visualRadius,
      scale: 1,
      age: 0,
      stateAge: 0,
      bornAt: this.time,
      slot: -1,
      lastBreak: -100,
      flightFrom: vcopy(position),
      flightTo: { x: 0, y: 0 },
      flightDuration: this.config.timing.incomingSeconds,
      flightArc: this.config.timing.incomingArc,
      collisionCooldown: 0,
      lastProgress: vcopy(position),
      stationaryTime: 0,
      launchedAt: this.time,
    };
  }
  private beginIncoming(b: NativeBall, from: Vec2): void {
    b.state = 'incoming';
    b.stateAge = 0;
    b.flightFrom = vcopy(from);
    b.flightTo = { x: 0, y: 0 };
    b.flightDuration = this.config.timing.incomingSeconds;
    b.flightArc = this.config.timing.incomingArc;
    b.slot = -1;
    b.scale = 1;
    this.lastInput = this.time;
    this.shots++;
    this.noMovesSince = -1;
    this.warning = null;
    this.emit('incoming', from, b.color, { ballId: b.id, power: b.power });
  }
  private trayPosition(slot: number): Vec2 {
    const v = this.config.view;
    return screenToWorld({ x: v.trayX[slot] ?? v.center.x, y: v.trayY }, this.config);
  }
  private bankBall(b: NativeBall): void {
    b.state = 'banking';
    b.slot = this.trayBalls.filter((a) => a.id !== b.id).length;
    b.stateAge = 0;
    b.velocity = { x: 0, y: 0 };
    b.flightFrom = vcopy(b.position);
    b.flightTo = this.trayPosition(b.slot);
    const d = distance(b.flightFrom, b.flightTo),
      t = this.config.timing;
    b.flightDuration = clamp(d * t.bankSecondsPerUnit, t.bankBaseSeconds, t.bankMaxSeconds);
    b.flightArc = Math.min(t.bankArc, d * 0.08);
    this.contactReceipts.delete(b.id);
    this.emit('park', b.position, b.color, { ballId: b.id, power: b.power });
  }
  private compactTray(): void {
    this.trayBalls.forEach((b, index) => {
      b.slot = index;
      b.flightTo = this.trayPosition(index);
      if (b.state === 'stored') {
        b.position = vcopy(b.flightTo);
        b.previousPosition = vcopy(b.position);
      }
    });
  }
  /** Intro motion changes geometry only: no puzzle clock, shots or progress. */
  rotateIntro(radians: number): void {
    this.rotation += radians;
    this.rebuildGeometry();
  }
  /** Short ads reveal one musical layer early without changing the authored level. */
  unlockIntroStem(color?: number): void {
    if (!this.level.adFlow || this.level.adFlow.intro === 'none' || this.unlockedStems.length)
      return;
    const lanes = this.level.stemLanes;
    const lane =
      lanes.find((l) => color !== undefined && l.colors.includes(color)) ||
      lanes.reduce(
        (best, next) =>
          this.stemProgress[lanes.indexOf(next)] > this.stemProgress[lanes.indexOf(best)]
            ? next
            : best,
        lanes[0],
      );
    if (!lane) return;
    this.unlockedStems.push(lane.stem);
    this.stemProgress[lanes.indexOf(lane)] = lane.requiredBreaks;
    this.emit('unlock', { x: 0, y: 0 }, color ?? lane.colors[0], { stem: lane.stem });
  }
  private fixedStep(dt: number): void {
    this.time += dt;
    this.beats = Math.max(0, ((this.time - this.level.downbeatOffset) * this.level.bpm) / 60);
    if (this.status !== 'failed') {
      this.advanceMotion(dt);
      this.advanceCompression();
      this.rebuildGeometry();
    }
    for (const b of this.balls) {
      b.age += dt;
      b.stateAge += dt;
      b.previousPosition = vcopy(b.position);
      b.collisionCooldown = Math.max(0, b.collisionCooldown - dt);
      if (b.state === 'incoming' || b.state === 'banking') {
        const t = clamp(b.stateAge / b.flightDuration, 0, 1);
        b.position = ballFlightPosition(b);
        if (
          t >= 1 &&
          !(
            b.state === 'incoming' &&
            b.stateAge < b.flightDuration + (this.config.timing.physicsHandoffSeconds ?? 0)
          )
        ) {
          if (b.state === 'incoming') {
            b.state = 'active';
            b.stateAge = 0;
            b.position = { x: 0, y: 0 };
            b.previousPosition = vcopy(b.position);
            b.lastProgress = vcopy(b.position);
            b.stationaryTime = 0;
            b.launchedAt = this.time;
            b.velocity = this.aimVelocity(b.color, b.position);
            this.emit('launch', b.position, b.color, {
              ballId: b.id,
              power: b.power,
              speed: magnitude(b.velocity),
            });
          } else {
            b.state = 'stored';
            b.stateAge = 0;
            this.emit('bankLanding', b.position, b.color, { ballId: b.id });
          }
        }
      } else if (b.state === 'active' && this.status === 'playing') {
        this.integrateBall(b, dt);
      } else if (b.state === 'spent') {
        b.scale =
          1 + Math.sin(Math.min(1, b.stateAge / this.config.timing.spentSeconds) * Math.PI) * 0.9;
      }
    }
    this.balls = this.balls.filter(
      (b) => b.state !== 'spent' || b.stateAge < this.config.timing.spentSeconds,
    );
    if (this.status === 'playing') this.updateOutcome();
  }
  private advanceMotion(dt: number): void {
    const m = this.level.motion;
    if (m.conveyorHoldFigure) {
      this.angularVelocity = 0;
      return;
    }
    const loop =
      ((this.beats % this.level.loopBeats) + this.level.loopBeats) % this.level.loopBeats;
    let sectionIndex = 0;
    for (let i = 0; i < this.level.sections.length; i++)
      if (this.level.sections[i].startBeat <= loop) sectionIndex = i;
    // Native MusicSyncDirector.ApplySection (lines 175–200) fixes direction to +1.
    // Authored section direction is descriptive chart data; applying it here invents reversals absent in the video.
    const section = this.level.sections[sectionIndex];
    const desired = clamp((section?.degreesPerBeat ?? 90) / 90, 0.5, 2.5) * m.speedMultiplier;
    if (sectionIndex !== this.lastSection) {
      const oldT = clamp((this.beats - this.motionChangeBeat) / m.flipEaseBeats, 0, 1);
      this.motionFrom = this.motionFrom + (this.motionTo - this.motionFrom) * smoothstep(oldT);
      this.motionTo = desired;
      this.motionChangeBeat = this.beats;
      if (this.lastSection === -1) this.motionFrom = desired;
      this.lastSection = sectionIndex;
    }
    const t = clamp((this.beats - this.motionChangeBeat) / m.flipEaseBeats, 0, 1),
      rate = this.motionFrom + (this.motionTo - this.motionFrom) * smoothstep(t);
    this.angularVelocity = (-((m.degreesPerBeat * rate * this.level.bpm) / 60) * Math.PI) / 180;
    if (this.time >= this.level.downbeatOffset) this.rotation += this.angularVelocity * dt;
  }
  private radiusForLayout(layout: number): number {
    const depth = layout + layout * layout * 0.035 * this.config.field.depthStrength;
    return this.level.innerRadius + depth * this.level.lineSpacing;
  }
  private cachedRingPath(layout: number): Vec2[] {
    const index = Math.floor(Math.max(0, layout) / this.geometryStep),
      mix = Math.max(0, layout) / this.geometryStep - index;
    const get = (i: number) => {
      let p = this.contourCache.get(i);
      if (!p) {
        p = offsetContour(
          this.contour,
          this.level.innerRadius,
          this.radiusForLayout(i * this.geometryStep) - this.level.innerRadius,
        );
        this.contourCache.set(i, p);
      }
      return p;
    };
    const a = get(index);
    if (mix < 1e-8) return a;
    const b = get(index + 1);
    return a.map((p, i) => ({ x: p.x + (b[i].x - p.x) * mix, y: p.y + (b[i].y - p.y) * mix }));
  }
  /** Renderer-only access to real future geometry. Does not activate colliders or change source rings. */
  getVisualRing(sourceLayer: number): NativeRing | undefined {
    const ring = this.rings[sourceLayer];
    if (!ring || sourceLayer < this.removedInnerRings) return undefined;
    if (ring.visible && ring.points.length) return ring;
    const l = this.level,
      m = l.motion,
      contour = this.cachedRingPath(ring.layoutLayer);
    const travel = conveyorTravelBeats(
      this.beats,
      m.conveyorPulseEveryBeats,
      m.conveyorPulseDurationBeats,
      m.conveyorPulseSpeedBoost,
    );
    const conveyor =
      (m.conveyorBeatsPerSlot > 0
        ? ((m.conveyorAlternate && ring.id % 2 ? -1 : 1) * travel) /
          (m.conveyorBeatsPerSlot * ring.segments.length)
        : 0) +
      (l.ringPhaseOffsets?.[ring.sourceLayer] ?? 0) +
      (l.shape === 'heart' &&
      m.conveyorBeatsPerSlot <= 0 &&
      ring.segments.length === 2 &&
      ring.segments[0].color !== ring.segments[1].color
        ? heartHalfPhase(contour)
        : 0);
    return {
      ...ring,
      points: contour.map((p) => rotate(p, this.rotation)),
      segments: ring.segments.map((s) => ({
        ...s,
        points: segmentPath(
          contour,
          s.index,
          ring.segments.length,
          conveyor,
          this.rotation,
          this.config.field.samplesPerSegment,
          l.segmentGap,
        ),
      })),
    };
  }
  private rebuildGeometry(): void {
    const l = this.level,
      f = this.config.field,
      m = l.motion,
      // Keep the full arena while future rings remain. Once its outermost ring moves
      // inward, the wall follows the same eased compression and preserves its gap.
      wallLayout =
        Math.min(l.arenaRingCapacity - 1, Math.max(0, this.rings.length - 1 - this.compression)) +
        f.wallMarginSpacings;
    this.previousWallPoints = this.wallPoints;
    this.wallPoints = this.cachedRingPath(wallLayout).map((p) => rotate(p, this.rotation));
    if (!this.previousWallPoints.length) this.previousWallPoints = this.wallPoints;
    const travel = conveyorTravelBeats(
      this.beats,
      m.conveyorPulseEveryBeats,
      m.conveyorPulseDurationBeats,
      m.conveyorPulseSpeedBoost,
    );
    for (const ring of this.rings) {
      const raw = Math.max(0, ring.sourceLayer - this.compression),
        wallWeight = clamp(raw - (l.arenaRingCapacity - 1), 0, 1);
      ring.layoutLayer = raw + wallWeight * (f.wallMarginSpacings + f.previewWallClearance);
      ring.radius = this.radiusForLayout(ring.layoutLayer);
      ring.rotation = this.rotation;
      ring.visible =
        ring.sourceLayer >= this.removedInnerRings &&
        ring.sourceLayer <
          this.removedInnerRings +
            Math.min(l.maxRenderedRings, l.arenaRingCapacity + l.previewRingCount);
      ring.preview = ring.layoutLayer >= wallLayout - 0.0001;
      ring.eligible =
        ring.visible &&
        !ring.preview &&
        ring.sourceLayer < this.removedInnerRings + f.strictBreakWindow;
      ring.alpha = ring.preview ? f.previewAlpha : 1;
      if (!ring.visible) {
        ring.points = [];
        for (const s of ring.segments) {
          s.previousPoints = s.points;
          s.points = [];
        }
        continue;
      }
      const contour = this.cachedRingPath(ring.layoutLayer);
      ring.points = contour.map((p) => rotate(p, this.rotation));
      const conveyor =
        (m.conveyorBeatsPerSlot > 0
          ? ((m.conveyorAlternate && ring.id % 2 ? -1 : 1) * travel) /
            (m.conveyorBeatsPerSlot * ring.segments.length)
          : 0) +
        (l.ringPhaseOffsets?.[ring.sourceLayer] ?? 0) +
        (l.shape === 'heart' &&
        m.conveyorBeatsPerSlot <= 0 &&
        ring.segments.length === 2 &&
        ring.segments[0].color !== ring.segments[1].color
          ? heartHalfPhase(contour)
          : 0);
      for (const s of ring.segments) {
        s.previousPoints = s.points;
        s.points = segmentPath(
          contour,
          s.index,
          ring.segments.length,
          conveyor,
          this.rotation,
          f.samplesPerSegment,
          l.segmentGap,
        );
        if (!s.previousPoints.length) s.previousPoints = s.points;
      }
    }
  }
  private advanceCompression(): void {
    if (this.compressionTo === this.compression) return;
    const t = clamp((this.time - this.compressionStart) / this.compressionDuration, 0, 1);
    this.compression =
      this.compressionFrom + (this.compressionTo - this.compressionFrom) * smootherstep(t);
  }
  private aimVelocity(color: number, from: Vec2): Vec2 {
    let target: NativeSegment | undefined;
    for (const ring of this.rings) {
      if (!ring.eligible) continue;
      target = ring.segments.find((s) => s.alive && s.color === color);
      if (target) break;
    }
    if (!target) return { x: 0, y: this.config.physics.launchSpeed };
    const world = target.points[Math.floor(target.points.length / 2)],
      ring = this.rings[target.ringId];
    const m = this.level.motion,
      conveyorRate =
        m.conveyorBeatsPerSlot > 0
          ? ((-(TAU / (m.conveyorBeatsPerSlot * ring.segments.length)) * this.level.bpm) / 60) *
            (m.conveyorAlternate && ring.id % 2 ? -1 : 1)
          : 0;
    let flight = this.config.physics.aimFlightSeconds,
      solution = solveBallisticAim(
        from,
        world,
        this.config.physics.gravity,
        flight,
        this.config.physics.maxLaunchSpeed,
      );
    for (let i = 0; i < 2; i++) {
      const led = rotate(world, (this.angularVelocity + conveyorRate) * flight);
      solution = solveBallisticAim(
        from,
        led,
        this.config.physics.gravity,
        this.config.physics.aimFlightSeconds,
        this.config.physics.maxLaunchSpeed,
      );
      flight = solution.flightSeconds;
    }
    return solution.velocity;
  }
  private integrateBall(b: NativeBall, dt: number): void {
    const p = this.config.physics;
    b.velocity.y += p.gravity * dt;
    const speed = magnitude(b.velocity);
    if (speed > p.maxSpeed) {
      b.velocity.x *= p.maxSpeed / speed;
      b.velocity.y *= p.maxSpeed / speed;
    }
    b.position.x += b.velocity.x * dt;
    b.position.y += b.velocity.y * dt;
    for (let iteration = 0; iteration < p.solverIterations && b.state === 'active'; iteration++) {
      let hit = false;
      // Native collider membership is independent of the strict break window: every visible
      // colored ring inside the arena stays solid, even while its color is not yet eligible to break.
      for (const ring of this.rings) {
        if (!ring.visible || ring.preview) continue;
        for (const segment of ring.segments) {
          if (!segment.alive) continue;
          if (
            this.resolvePathContact(
              b,
              segment.points,
              segment.previousPoints,
              this.level.lineThickness * p.edgeWidthMultiplier * 0.5,
              dt,
              segment,
              iteration,
            )
          ) {
            hit = true;
            if (b.state !== 'active') break;
          }
        }
        if (b.state !== 'active') break;
      }
      if (b.state === 'active')
        hit =
          this.resolvePathContact(
            b,
            this.wallPoints,
            this.previousWallPoints,
            this.config.field.wallThickness * 0.5,
            dt,
            undefined,
            iteration,
          ) || hit;
      if (!hit) break;
    }
    if (b.state !== 'active') return;
    // Containment fail-safe projects only an escaped body; never teleports through colored pieces.
    if (!pointInsidePolygon(b.position, this.wallPoints)) this.restoreInsideWall(b);
    if (distance(b.position, b.lastProgress) >= p.wedgeDistance) {
      b.lastProgress = vcopy(b.position);
      b.stationaryTime = 0;
    } else b.stationaryTime += dt;
    if (b.stationaryTime > p.wedgeSeconds && magnitude(b.velocity) < 0.6) {
      const d = normalize({ x: -b.position.x, y: -b.position.y });
      b.velocity = { x: d.x * p.wedgeKick, y: d.y * p.wedgeKick };
      b.stationaryTime = 0;
    }
  }
  private pathMayContact(points: Vec2[], position: Vec2, radius: number): boolean {
    let bounds = this.contactBounds.get(points);
    if (!bounds) {
      bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      for (const point of points) {
        if (point.x < bounds.minX) bounds.minX = point.x;
        if (point.x > bounds.maxX) bounds.maxX = point.x;
        if (point.y < bounds.minY) bounds.minY = point.y;
        if (point.y > bounds.maxY) bounds.maxY = point.y;
      }
      this.contactBounds.set(points, bounds);
    }
    const margin = radius + CONTACT_BOUNDS_PADDING;
    return (
      position.x + margin >= bounds.minX &&
      position.x - margin <= bounds.maxX &&
      position.y + margin >= bounds.minY &&
      position.y - margin <= bounds.maxY
    );
  }
  private edgeMayContact(a: Vec2, c: Vec2, position: Vec2, radius: number): boolean {
    const margin = radius + CONTACT_BOUNDS_PADDING;
    return (
      position.x + margin >= Math.min(a.x, c.x) &&
      position.x - margin <= Math.max(a.x, c.x) &&
      position.y + margin >= Math.min(a.y, c.y) &&
      position.y - margin <= Math.max(a.y, c.y)
    );
  }
  private resolvePathContact(
    b: NativeBall,
    points: Vec2[],
    previous: Vec2[],
    edgeRadius: number,
    dt: number,
    segment: NativeSegment | undefined,
    iteration: number,
  ): boolean {
    const p = this.config.physics,
      radius = b.radius + edgeRadius + p.contactOffset;
    // Paths are immutable until the next geometry rebuild, so every ball/solver iteration
    // can share these conservative bounds. The exact closest-point solver and its order stay unchanged.
    if (segment && !this.pathMayContact(points, b.position, radius)) return false;
    let best = -1,
      bestDistance = Infinity,
      closest = { x: 0, y: 0 },
      oldClosest = { x: 0, y: 0 },
      normal = { x: 0, y: 0 };
    const count = segment ? points.length - 1 : points.length;
    for (let i = 0; i < count; i++) {
      const a = points[i],
        c = points[(i + 1) % points.length];
      if (!this.edgeMayContact(a, c, b.position, radius)) continue;
      const q = closestPoint(b.position, a, c),
        dist = distance(b.position, q);
      if (dist >= radius || dist >= bestDistance) continue;
      const oldA = previous[i] ?? a,
        oldC = previous[(i + 1) % previous.length] ?? c,
        oldQ = closestPoint(b.previousPosition, oldA, oldC);
      let n = normalize(
        { x: b.previousPosition.x - oldQ.x, y: b.previousPosition.y - oldQ.y },
        normalize({ x: b.position.x - q.x, y: b.position.y - q.y }),
      );
      // Use the current edge's normal with the previous near side to prevent rotating edges crossing bodies.
      const edge = normalize({ x: c.x - a.x, y: c.y - a.y });
      let edgeN = { x: -edge.y, y: edge.x };
      if (edgeN.x * n.x + edgeN.y * n.y < 0) edgeN = { x: -edgeN.x, y: -edgeN.y };
      const tangentFraction =
        ((q.x - a.x) * (c.x - a.x) + (q.y - a.y) * (c.y - a.y)) /
        Math.max(1e-9, (c.x - a.x) ** 2 + (c.y - a.y) ** 2);
      if (tangentFraction > 0.001 && tangentFraction < 0.999) n = edgeN;
      best = i;
      bestDistance = dist;
      closest = q;
      oldClosest = oldQ;
      normal = n;
    }
    if (best < 0) return false;
    if (b.color === 99 && segment) {
      // Wildcards are sensors for every color; only the white arena wall remains solid.
      if (segment.alive && this.time - b.lastBreak >= p.breakCooldown)
        this.breakSegment(segment, b, closest, normal, 0.65);
      return false;
    }
    const surfaceVelocity = {
      x: (closest.x - oldClosest.x) / dt,
      y: (closest.y - oldClosest.y) / dt,
    };
    // Endpoint's geometric displacement can contain the ball's tangential travel; normal velocity is the physical carry.
    const normalSurface = clamp(surfaceVelocity.x * normal.x + surfaceVelocity.y * normal.y, -3, 3);
    const incoming = b.velocity.x * normal.x + b.velocity.y * normal.y - normalSurface;
    b.position = { x: closest.x + normal.x * radius, y: closest.y + normal.y * radius };
    if (incoming >= -0.02) return true;
    b.velocity.x -= (1 + p.restitution) * incoming * normal.x;
    b.velocity.y -= (1 + p.restitution) * incoming * normal.y;
    let speed = magnitude(b.velocity);
    if (speed < p.minPostBounceSpeed) {
      const dir = normalize(b.velocity, normal);
      b.velocity = { x: dir.x * p.minPostBounceSpeed, y: dir.y * p.minPostBounceSpeed };
      speed = p.minPostBounceSpeed;
    }
    if (speed > p.maxSpeed) {
      b.velocity.x *= p.maxSpeed / speed;
      b.velocity.y *= p.maxSpeed / speed;
    }
    const key = segment?.id ?? -1;
    let receipts = this.contactReceipts.get(b.id);
    if (!receipts) {
      receipts = new Map();
      this.contactReceipts.set(b.id, receipts);
    }
    const last = receipts.get(key) ?? -100;
    if (this.time - last > 0.075 && iteration === 0) {
      receipts.set(key, this.time);
      const impact = clamp(Math.abs(incoming) / p.maxSpeed, 0.12, 1);
      this.emit('impact', closest, b.color, {
        ballId: b.id,
        ringId: segment?.ringId,
        segmentId: segment?.id,
        normal,
        speed: Math.abs(incoming),
        impact,
      });
      if (segment && segment.color === b.color && this.time - b.lastBreak >= p.breakCooldown)
        this.breakSegment(segment, b, closest, normal, impact);
    }
    return true;
  }
  private breakSegment(
    segment: NativeSegment,
    b: NativeBall,
    position: Vec2,
    normal: Vec2,
    impact: number,
  ): void {
    if (
      !segment.alive ||
      !this.rings[segment.ringId].eligible ||
      (segment.color !== b.color && b.color !== 99)
    )
      return;
    if (b.color === 99) this.spendWildcardPower(segment.color);
    const brokenColor = segment.color;
    segment.alive = false;
    segment.brokenAt = this.time;
    b.power--;
    b.lastBreak = this.time;
    this.lastBreak = this.time;
    this.warning = null;
    this.noMovesSince = -1;
    this.emit('break', position, brokenColor, {
      ballId: b.id,
      power: b.power,
      ringId: segment.ringId,
      segmentId: segment.id,
      normal,
      impact,
    });
    this.brokenColors[brokenColor]++;
    for (let i = 0; i < this.level.stemLanes.length; i++) {
      const lane = this.level.stemLanes[i];
      if (!lane.colors.includes(brokenColor)) continue;
      this.stemProgress[i] =
        this.level.stemUnlockPolicy === 'half-per-color'
          ? laneUnlockProgress(lane.colors, this.brokenColors, this.unlockTargets)
          : this.stemProgress[i] + 1;
      if (this.unlockedStems.includes(lane.stem))
        this.stemProgress[i] = Math.max(this.stemProgress[i], lane.requiredBreaks);
      if (this.stemProgress[i] >= lane.requiredBreaks && !this.unlockedStems.includes(lane.stem)) {
        this.unlockedStems.push(lane.stem);
        this.emit('unlock', position, brokenColor, { stem: lane.stem });
      }
    }
    this.unlockIntroStem(brokenColor);
    const ring = this.rings[segment.ringId];
    if (ring.segments.every((s) => !s.alive)) {
      this.emit('ringClear', position, brokenColor, { ringId: ring.id });
      while (
        this.removedInnerRings < this.rings.length &&
        this.rings[this.removedInnerRings].segments.every((s) => !s.alive)
      )
        this.removedInnerRings++;
      // Keep feeding the innermost position even after the last hidden ring enters.
      // The authored inner radius remains the balls' empty center space.
      const target = Math.min(this.removedInnerRings, Math.max(0, this.rings.length - 1));
      if (target !== this.compressionTo) {
        this.compressionFrom = this.compression;
        this.compressionTo = target;
        this.compressionStart = this.time;
        this.compressionDuration =
          ((this.config.timing.compressionBeats * 60) / this.level.bpm) *
          Math.max(1, target - this.compression);
      }
    }
    if (b.power <= 0) this.retireBall(b);
    // The rounded-up web queue can leave one or two unused hits for a color. Retire every
    // live copy only after checking ALL rings, including hidden/future layers. Keep the array
    // stable during collision iteration; ordinary spent cleanup removes the objects later.
    if (
      this.level.queuePolicy === 'fixed-three' &&
      !this.rings.some((r) => r.segments.some((s) => s.alive && s.color === brokenColor))
    ) {
      for (const ball of this.balls)
        if (ball.color === brokenColor && ball.state !== 'spent')
          this.retireBall(ball, 'color_complete');
      this.compactTray();
    }
  }
  private retireBall(b: NativeBall, reason?: string): void {
    if (b.state === 'spent') return;
    const discardedPower = Math.max(0, b.power);
    b.power = 0;
    b.state = 'spent';
    b.stateAge = 0;
    b.slot = -1;
    b.velocity = { x: 0, y: 0 };
    this.contactReceipts.delete(b.id);
    this.emit('spent', b.position, b.color, {
      ballId: b.id,
      power: discardedPower,
      ...(reason ? { reason } : {}),
    });
  }
  private spendWildcardPower(color: number): void {
    for (const allowConsume of [false, true])
      for (let index = this.level.queue.length - 1; index >= 0; index--) {
        const q = this.level.queue[index];
        if (this.consumed.has(index) || q.color !== color) continue;
        const power = this.queuePower.get(index) ?? q.power;
        if (power > 1) {
          this.queuePower.set(index, power - 1);
          return;
        }
        if (allowConsume) {
          this.consumed.add(index);
          return;
        }
      }
  }
  private restoreInsideWall(b: NativeBall): void {
    let best = Infinity,
      q = this.wallPoints[0];
    for (let i = 0; i < this.wallPoints.length; i++) {
      const c = closestPoint(
          b.position,
          this.wallPoints[i],
          this.wallPoints[(i + 1) % this.wallPoints.length],
        ),
        d = distance(c, b.position);
      if (d < best) {
        best = d;
        q = c;
      }
    }
    const n = normalize({ x: -q.x, y: -q.y });
    b.position = {
      x: q.x + n.x * (b.radius + this.config.field.wallThickness),
      y: q.y + n.y * (b.radius + this.config.field.wallThickness),
    };
    const inward = b.velocity.x * n.x + b.velocity.y * n.y;
    if (inward < 0) {
      b.velocity.x -= 2 * inward * n.x;
      b.velocity.y -= 2 * inward * n.y;
    }
  }
  private updateOutcome(): void {
    if (this.remaining === 0) {
      this.status = 'won';
      this.emit('win', { x: 0, y: 0 }, -1);
      return;
    }
    const activeColors = this.activeBalls.map((b) => b.color),
      activeCanMatch = this.rings.some(
        (r) =>
          r.eligible &&
          r.segments.some(
            (s) => s.alive && (activeColors.includes(s.color) || activeColors.includes(99)),
          ),
      );
    const blocked =
      this.activeBalls.length >= this.activeCapacity &&
      this.trayBalls.length >= this.level.trayCapacity &&
      !activeCanMatch;
    if (!blocked || this.isAnimatingShot) {
      this.noMovesSince = -1;
      this.warning = null;
      return;
    }
    if (this.noMovesSince < 0) this.noMovesSince = this.time;
    const elapsed = this.time - this.noMovesSince;
    if (elapsed >= this.config.timing.warningDelay) {
      this.warning = Math.max(
        0,
        this.config.timing.failureCountdown - (elapsed - this.config.timing.warningDelay),
      );
      if (this.warning === this.config.timing.failureCountdown)
        this.emit('warning', { x: 0, y: 0 }, -1);
      if (this.warning <= 0) {
        this.status = 'failed';
        this.emit('fail', { x: 0, y: 0 }, -1, {
          reason: 'No matching ball remains available in the active field.',
        });
      }
    }
  }
  private emit(
    type: NativeEventType,
    position: Vec2,
    color: number,
    extra: Partial<NativeEvent> = {},
  ): void {
    this.events.push({ type, time: this.time, position: vcopy(position), color, ...extra });
  }
}
