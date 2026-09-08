import sourceLevel from './data/level-6.json';
import type { NativeConfig, NativeLevel, Vec2 } from './types';
export const NATIVE_CONFIG: NativeConfig = {
  // Reference-video measurement: 576x1280, centre (288,512), 20.5px ring pitch,
  // 9px stroke; source .38253u pitch + tunnel-depth transform gives 49px/u.
  view: {
    width: 576,
    height: 1280,
    center: { x: 288, y: 512 },
    pixelsPerUnit: 49,
    queueX: [212, 288, 364],
    queueY: 992,
    queuePitchY: 67,
    queueRadius: 24,
    trayX: [134, 211, 288, 365, 442],
    trayY: 895,
    instrumentX: [112, 230, 348, 466],
    instrumentY: 195,
  },
  physics: {
    fixedStep: 1 / 120,
    gravity: 8.71 * 0.95,
    launchSpeed: 4.4,
    aimFlightSeconds: 0.42,
    maxLaunchSpeed: 9.5,
    maxSpeed: 10,
    restitution: 1,
    minPostBounceSpeed: 3.15,
    breakCooldown: 0.035,
    collisionRadiusRatio: 0.588,
    edgeWidthMultiplier: 0.8888889,
    contactOffset: 0.01,
    solverIterations: 4,
    wedgeSeconds: 0.85,
    wedgeDistance: 0.18,
    wedgeKick: 4.4 * 1.1,
  },
  timing: {
    incomingSeconds: 0.38,
    incomingArc: 0.35,
    bankBaseSeconds: 0.24,
    bankSecondsPerUnit: 0.043,
    bankMaxSeconds: 0.6,
    bankArc: 0.65,
    inputCooldown: 0.08,
    compressionBeats: 2.5,
    spentSeconds: 0.26,
    warningDelay: 4,
    failureCountdown: 7,
  },
  field: {
    depthStrength: 0.38,
    wallMarginSpacings: 1,
    previewWallClearance: 0.25,
    samplesPerSegment: 18,
    contourSamples: 240,
    strictBreakWindow: 6,
    wallThickness: 0.18,
    ghostAlpha: 0.07,
    previewAlpha: 0.2,
  },
};
export const DEFAULT_NATIVE_LEVEL = sourceLevel as NativeLevel;
export function cloneLevel(level: NativeLevel = DEFAULT_NATIVE_LEVEL): NativeLevel {
  return JSON.parse(JSON.stringify(level));
}
export function screenToWorld(p: Vec2, config: NativeConfig = NATIVE_CONFIG): Vec2 {
  return {
    x: (p.x - config.view.center.x) / config.view.pixelsPerUnit,
    y: (p.y - config.view.center.y) / config.view.pixelsPerUnit,
  };
}
export function worldToScreen(p: Vec2, config: NativeConfig = NATIVE_CONFIG): Vec2 {
  return {
    x: config.view.center.x + p.x * config.view.pixelsPerUnit,
    y: config.view.center.y + p.y * config.view.pixelsPerUnit,
  };
}

/** The original asset remains untouched. This profile calibrates the recorded run's initial winding. */
export const REFERENCE_NATIVE_LEVEL: NativeLevel = {
  ...cloneLevel(DEFAULT_NATIVE_LEVEL),
  palette: [0xf7404b, 0x6ecd4f, 0x2c8bf9, 0xfddd4b],
  motion: { ...DEFAULT_NATIVE_LEVEL.motion, phaseDegrees: 196.7559594483 },
  referenceCalibration: {
    video: 'BeatBloomNewVersion.mp4',
    phaseDegrees: 196.7559594483,
    physicsHandoffSeconds: 1 / 30,
    audioSourceOffsetSeconds: 0.6024,
    measuredFromSeconds: 3.8,
    measuredToSeconds: 22,
    angularRmsDegrees: 0.293,
    note: 'The recording starts 0.6024 seconds into the native music source, measured by waveform correlation. Palette is measured from lossless decoded video frames, not JPEG intermediates. White-wall fit across 10 reference frames determines phase modulo 60 degrees. First yellow launch chooses the full winding. Raw Unity prefab phase is 56 degrees. The recorded UI-to-physics handoff holds at center for approximately two 60 Hz frames; this is a reference timing calibration, not a claimed Unity engine constant.',
  },
};
/** Center the song's complete band; note flights and staged reveals use the same anchors. */
export function instrumentCenters(
  songId: string,
  view: NativeConfig['view'] = NATIVE_CONFIG.view,
): number[] {
  const count = songId === 'nobatidao' ? 2 : 4;
  const spacing = view.instrumentX[1] - view.instrumentX[0];
  return Array.from({ length: count }, (_, i) => view.center.x + (i - (count - 1) / 2) * spacing);
}
/** Preserve fixed UI furniture while fitting edited/imported larger fields inside the safe viewport. */
export function deriveConfigForLevel(
  level: NativeLevel,
  base: NativeConfig = NATIVE_CONFIG,
): NativeConfig {
  const config: NativeConfig = JSON.parse(JSON.stringify(base));
  config.view.activeBallScale = level.ballScale ?? 1;
  const speed = level.ballSpeed ?? 1;
  config.physics.gravity *= speed * speed;
  for (const key of [
    'launchSpeed',
    'maxLaunchSpeed',
    'maxSpeed',
    'minPostBounceSpeed',
    'wedgeKick',
  ] as const)
    config.physics[key] *= speed;
  config.physics.aimFlightSeconds /= speed;
  config.view.instrumentX = instrumentCenters(level.songId, base.view);
  const layer = level.arenaRingCapacity - 1 + config.field.wallMarginSpacings;
  const depth = layer + layer * layer * 0.035 * config.field.depthStrength;
  const radius = level.innerRadius + depth * level.lineSpacing;
  const safeHalfWidth = config.view.width * 0.5 - 16;
  config.view.pixelsPerUnit = Math.min(
    base.view.pixelsPerUnit,
    safeHalfWidth / (radius + config.field.wallThickness * 0.6),
  );
  // Fitting a larger arena must not turn the same ball into slow motion. Convert
  // velocity and acceleration together so their screen-space values stay stable.
  // Ball size only changes collision geometry; it never changes movement speed.
  const worldPerScreenScale = base.view.pixelsPerUnit / config.view.pixelsPerUnit;
  for (const key of [
    'gravity',
    'launchSpeed',
    'maxLaunchSpeed',
    'maxSpeed',
    'minPostBounceSpeed',
    'wedgeKick',
    'wedgeDistance',
  ] as const)
    config.physics[key] *= worldPerScreenScale;
  if (level.referenceCalibration)
    config.timing.physicsHandoffSeconds = level.referenceCalibration.physicsHandoffSeconds;
  return config;
}
