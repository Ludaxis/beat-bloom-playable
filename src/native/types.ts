/** Standalone web reproduction of the authored Unity level; never imported by Unity runtime. */
export interface Vec2 {
  x: number;
  y: number;
}
export type NativeShape =
  'hexagon' | 'heart' | 'flower' | 'ring' | 'triangle' | 'square' | 'pentagon' | 'heptagon';
export interface NativeQueueEntry {
  color: number;
  power: number;
  mystery: boolean;
}
export interface EndCardDesign {
  ctaWidth?: number;
  ctaHeight?: number;
  replayEnabled?: boolean;
  logoImage?: string;
  iconImage?: string;
  headlineSize?: number;
  ctaSize?: number;
  headline: string;
  ctaLabel: string;
  ctaColor: number;
  backgroundColor: number;
  logoWidth: number;
  iconSize: number;
}
export interface NativeRingAppearance {
  colorFade: number;
  shadowOpacity: number;
  shadowFade: number;
}
export interface NativeTutorialOptions {
  enabled: boolean;
  placement: 'auto' | 'top' | 'slots';
}
export interface NativeStemLane {
  stem: number;
  colors: number[];
  requiredBreaks: number;
}
export interface NativeSection {
  startBeat: number;
  direction: number;
  degreesPerBeat: number;
  intensity: number;
}
export interface NativeLevel {
  adFlow?: import('./ad-flow').AdFlowOptions;
  /** Approved end-card assets with editable copy, colors and responsive design dimensions. */
  endCard?: EndCardDesign;
  /** Optional non-blocking coaching; omitted settings use the playable defaults. */
  tutorial?: NativeTutorialOptions;
  /** Visual depth only: fade per colored ring, first shadow opacity, fade per outer shadow. */
  ringAppearance?: NativeRingAppearance;
  /** Studio/export balls start at 3 power; each color rounds up across the whole puzzle. */
  ballScale?: number;
  ballSpeed?: number;
  queuePolicy?: 'fixed-three';
  stemUnlockPolicy?: 'half-per-color';
  /** Optional studio recipe; authored rings remain the gameplay authority. */
  pattern?: {
    colorCount: number;
    segmentsPerRing: number;
    colorsPerRing: number;
    shift: number;
    shiftDegrees?: number;
    equalColorSpans?: boolean;
  };
  /** Geometric position along each closed contour, in normalized turns [0,1). */
  ringPhaseOffsets?: number[];
  /** Absolute studio per-ring shift in degrees; keeps mixed-count edits and legacy migration stable. */
  ringShiftDegrees?: number;
  schemaVersion: 1;
  id: string;
  name: string;
  levelNumber: number;
  songId: string;
  shape: NativeShape;
  flowerPetals: number;
  roundness: number;
  palette: number[];
  /** Resolved native values including FieldConfig's radius boost and spacing multiplier. */
  innerRadius: number;
  lineSpacing: number;
  lineThickness: number;
  segmentGap: number;
  arenaRingCapacity: number;
  previewRingCount: number;
  maxRenderedRings: number;
  rings: number[][];
  queue: NativeQueueEntry[];
  queueColumns: number;
  activeCapacity: number;
  trayCapacity: number;
  stemLanes: NativeStemLane[];
  bpm: number;
  beatsPerBar: number;
  loopBeats: number;
  downbeatOffset: number;
  sections: NativeSection[];
  motion: {
    phaseDegrees?: number;
    degreesPerBeat: number;
    speedMultiplier: number;
    flipEaseBeats: number;
    conveyorBeatsPerSlot: number;
    conveyorAlternate: boolean;
    conveyorHoldFigure: boolean;
    conveyorPulseEveryBeats: number;
    conveyorPulseDurationBeats: number;
    conveyorPulseSpeedBoost: number;
  };
  referenceCalibration?: {
    video: string;
    phaseDegrees: number;
    physicsHandoffSeconds: number;
    audioSourceOffsetSeconds?: number;
    measuredFromSeconds: number;
    measuredToSeconds: number;
    angularRmsDegrees: number;
    note: string;
  };
  source?: { level: string; levelSha256: string; field: string; exportedAt: string };
}
export interface NativeConfig {
  view: {
    width: number;
    height: number;
    center: Vec2;
    pixelsPerUnit: number;
    queueX: number[];
    queueY: number;
    queuePitchY: number;
    queueRadius: number;
    activeBallScale?: number;
    trayX: number[];
    trayY: number;
    instrumentX: number[];
    instrumentY: number;
  };
  physics: {
    fixedStep: number;
    gravity: number;
    launchSpeed: number;
    aimFlightSeconds: number;
    maxLaunchSpeed: number;
    maxSpeed: number;
    restitution: number;
    minPostBounceSpeed: number;
    breakCooldown: number;
    collisionRadiusRatio: number;
    edgeWidthMultiplier: number;
    contactOffset: number;
    solverIterations: number;
    wedgeSeconds: number;
    wedgeDistance: number;
    wedgeKick: number;
  };
  timing: {
    incomingSeconds: number;
    physicsHandoffSeconds?: number;
    incomingArc: number;
    bankBaseSeconds: number;
    bankSecondsPerUnit: number;
    bankMaxSeconds: number;
    bankArc: number;
    inputCooldown: number;
    compressionBeats: number;
    spentSeconds: number;
    warningDelay: number;
    failureCountdown: number;
  };
  field: {
    depthStrength: number;
    wallMarginSpacings: number;
    previewWallClearance: number;
    samplesPerSegment: number;
    contourSamples: number;
    strictBreakWindow: number;
    wallThickness: number;
    ghostAlpha: number;
    previewAlpha: number;
  };
}
export interface NativeSegment {
  id: number;
  index: number;
  ringId: number;
  color: number;
  alive: boolean;
  points: Vec2[];
  previousPoints: Vec2[];
  brokenAt: number;
}
export interface NativeRing {
  id: number;
  sourceLayer: number;
  radius: number;
  rotation: number;
  visible: boolean;
  eligible: boolean;
  preview: boolean;
  alpha: number;
  segments: NativeSegment[];
  points: Vec2[];
  layoutLayer: number;
}
export type NativeBallState = 'incoming' | 'active' | 'banking' | 'stored' | 'spent';
export interface NativeBall {
  id: number;
  sourceIndex: number;
  color: number;
  power: number;
  state: NativeBallState;
  position: Vec2;
  previousPosition: Vec2;
  velocity: Vec2;
  radius: number;
  visualRadius: number;
  scale: number;
  age: number;
  stateAge: number;
  bornAt: number;
  slot: number;
  lastBreak: number;
  flightFrom: Vec2;
  flightTo: Vec2;
  flightDuration: number;
  flightArc: number;
  collisionCooldown: number;
  lastProgress: Vec2;
  stationaryTime: number;
  launchedAt: number;
}
export type NativeEventType =
  | 'launch'
  | 'impact'
  | 'break'
  | 'ringClear'
  | 'park'
  | 'bankLanding'
  | 'spent'
  | 'unlock'
  | 'win'
  | 'fail'
  | 'refused'
  | 'incoming'
  | 'warning'
  | 'booster';
export interface NativeEvent {
  type: NativeEventType;
  time: number;
  position: Vec2;
  color: number;
  ballId?: number;
  power?: number;
  ringId?: number;
  segmentId?: number;
  normal?: Vec2;
  speed?: number;
  impact?: number;
  stem?: number;
  reason?: string;
}
export interface NativeQueueBall extends NativeQueueEntry {
  sourceIndex: number;
  column: number;
  row: number;
  position: Vec2;
  radius: number;
  fireable: boolean;
}
export interface NativeSnapshot {
  time: number;
  status: 'playing' | 'won' | 'failed';
  remaining: number;
  total: number;
  shots: number;
  active: number;
  activeCapacity: number;
  tray: number;
  queue: number;
  removedInnerRings: number;
  compression: number;
  warning: number | null;
  stemProgress: number[];
  unlockedStems: number[];
}
