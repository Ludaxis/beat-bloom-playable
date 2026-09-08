/** Presentation constants transcribed from Beat Bloom's BallConfig, VfxConfig and FieldConfig.
 * No values here change physics or puzzle eligibility. The native renderer consumes the model's paths.
 */
export const VFX = {
  shatter: {
    pieces: 7,
    minSize: 0.35,
    sizeVariation: 1.6,
    lengthInWidths: 1.8,
    aspect: 0.48,
    sizeSpread: 0.72,
    tumbleMin: 4,
    tumbleVariation: 6,
    opacity: 0.76,
    edgeOpacity: 0.48,
    facetOpacity: 0.26,
    edgeWidth: 0.65,
    maxConcurrent: 84,
    lifeMin: 0.48,
    lifeMax: 0.78,
    fadeStart: 0.18,
    spread: 125,
    lift: 75,
    gravity: 520,
    spin: 7,
  },
  transferTrail: {
    seconds: 0.18,
    samples: 24,
    headWidth: 0.44,
    brightness: 1.15,
  },
  trail: {
    minSpeed: 2.9,
    maxSpeed: 10,
    cutoff: 1.305,
    headSlow: 0.38,
    headFast: 0.74,
    lengthSlow: 0.9,
    lengthFast: 3.8,
    minTime: 0.04,
    maxTime: 0.26,
    brightnessSlow: 0.55,
    brightnessFast: 1.7,
    minVertex: 0.012,
    teleportDistance: 0.9,
  },
  deform: {
    velocityStretch: 0.18,
    aimSmoothing: 12,
    squash: 0.35,
    tangent: 0.3,
    omega: 80,
    damping: 0.5,
    maxStep: 0.05,
  },
  rainbow: { cyclesPerSecond: 0.55, saturation: 0.85, value: 1, rendererOffset: 0.06 },
  intro: {
    seconds: 1.6,
    startScale: 0.06,
    bloomPortion: 0.55,
    backEase: 1.2,
    revealStart: 0.04,
    revealEnd: 0.7,
    revealSoftness: 1.5,
  },
  equalizer: {
    barCount: 56,
    radius: 25,
    width: 1.5,
    minLength: 0.12,
    maxLength: 0.62,
    attack: 22,
    release: 7,
    reveal: 10,
    resting: 0.08,
    dormant: 0.18,
    dormantAlpha: 0.55,
    activationBrightness: 0.85,
    activationRelease: 1.5,
    breakBrightness: 0.28,
    breakRelease: 2.8,
  },
  field: {
    trackColor: 0x57546b,
    trackAlpha: 0.2,
    // Below one-quarter of one 8-bit coverage step, a neutral outline cannot contribute visibly.
    cullAlpha: 1 / 1024,
    viewportMarginPixels: 4,
    shoulderPixels: 1.0,
    wallColor: 0xe8dbff,
    wallAlpha: 1,
    flashSeconds: 0.11,
    flashBrightness: 2.8,
    flashWidth: 1.45,
  },
  // Comfort pass: one short translation, no roll, oscillation or accumulated collision trauma.
  camera: {
    seconds: 0.18,
    attackFraction: 0.25,
    triggerSpacing: 0.32,
    maxPixels: 1.1,
    breakPixels: 0.5,
    clearPixels: 1.1,
    unlockPixels: 0.75,
  },
  launch: { radius: 1.1, seconds: 0.16, sparks: 10, brightness: 2.6 },
  impact: { seconds: 0.72, scale: 0.62, sparkles: 6, brightness: 1.3 },
  spent: {
    seconds: 0.26,
    anticipation: 0.18,
    squash: 0.86,
    expand: 1.9,
    flash: 0.75,
    shards: 9,
    distance: 0.55,
    size: 0.24,
    stretch: 2.6,
    ringExpand: 2.6,
  },
  shockwave: {
    seconds: 0.85,
    samples: 128,
    maxConcurrent: 2,
    startRadius: 8,
    endRadiusFactor: 0.82,
    attack: 0.08,
    fadePower: 0.9,
    haloWidth: 22,
    haloAlpha: 0.08,
    glowWidth: 8,
    glowAlpha: 0.24,
    coreAlpha: 0.85,
    whiteness: 0.5,
    lineLeadPixels: 24,
    lineAfterglowPixels: 70,
    lineOuterFade: 0.45,
    lineHaloPixels: 14,
    lineHaloAlpha: 0.32,
    lineWhiteness: 0.6,
    lineBodyAlpha: 0.65,
    lineCoreWidth: 0.35,
    lineCoreAlpha: 0.55,
  },
  clef: {
    seconds: 0.62,
    count: 3,
    worldSize: 1.05,
    coreScale: 0.72,
    fanSpread: 0.78,
    maxFusedBreaks: 6,
    fusedScale: 0.08,
    maxFanCount: 5,
    extraPerFusedBreak: 1,
    fanVertical: 0.13,
    splash: 0.22,
    dip: 0.26,
    stagger: 0.12,
    satelliteScale: 0.78,
    rotation: 12,
    convergeStart: 0.62,
    arcLift: 0.65,
    sideArc: 0.42,
    releaseScale: 0.62,
    arrivalScale: 0.2,
    releaseFraction: 0.2,
    spin: 36,
    wobble: 4,
    facingSettle: 0.55,
    trailWidth: 0.14,
    trailSeconds: 0.28,
    absorbSeconds: 0.22,
    maxConcurrent: 18,
  },
  stage: { reveal: 0.34, hold: 0.78, handoff: 0.42, scrimOpacity: 0.72, scrimRadius: 3 },
  celebration: { seconds: 4.2, confettiCount: 170, fireworksCount: 6 },
} as const;

export interface Point2 {
  x: number;
  y: number;
}
export interface Spring {
  position: number;
  velocity: number;
}
export const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (t: number) => {
  t = clamp01(t);
  return t * t * (3 - 2 * t);
};

/** Exact underdamped step from BeatBloomSpringMath, stable at mobile frame rates. */
export function springStep(s: Spring, dt: number): void {
  const omega = VFX.deform.omega,
    zeta = VFX.deform.damping;
  const damped = omega * Math.sqrt(1 - zeta * zeta),
    decay = Math.exp(-zeta * omega * dt);
  const cosine = Math.cos(damped * dt),
    sine = Math.sin(damped * dt);
  const a = s.position,
    b = (s.velocity + zeta * omega * s.position) / damped;
  s.position = decay * (a * cosine + b * sine);
  s.velocity =
    decay * ((-zeta * omega * a + b * damped) * cosine - (zeta * omega * b + a * damped) * sine);
  if (Math.abs(s.position) < 0.001 && Math.abs(s.velocity) < 0.01) {
    s.position = 0;
    s.velocity = 0;
  }
}

export function cubic(a: Point2, b: Point2, c: Point2, d: Point2, t: number): Point2 {
  const u = 1 - t;
  return {
    x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
    y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y,
  };
}

/** Native clef fan: center/left/right, an anticipation dip, then staggered quadratic homing. */
export function fanOrdinal(ordinal: number, count: number): number {
  if (count <= 1) return 0;
  if (count % 2) {
    if (ordinal === 0) return 0;
    return ((ordinal % 2 ? -1 : 1) * Math.floor((ordinal + 1) / 2)) / (count / 2);
  }
  return ((ordinal % 2 ? 1 : -1) * (Math.floor(ordinal / 2) * 2 + 1)) / (count - 1);
}

export function clefPoint(
  start: Point2,
  target: Point2,
  ordinal: number,
  progress: number,
  scale: number,
  count = 3,
): Point2 {
  const f = VFX.clef;
  const sign = fanOrdinal(ordinal, count);
  const stagger = Math.min(f.stagger, (f.convergeStart - f.splash) / Math.max(1, count - 1));
  const takeoff = f.splash + ordinal * stagger;
  const chase = clamp01((progress - takeoff) / (1 - takeoff)) ** 2;
  const separation = 1 - smooth((progress - f.convergeStart) / (1 - f.convergeStart));
  const dipPhase = clamp01(progress / f.splash);
  const dip = progress < f.splash ? 16 * dipPhase ** 2 * (1 - dipPhase) ** 2 * f.dip : 0;
  const delta = target.x - start.x;
  const base = cubic(
    start,
    { x: start.x + delta * 0.14 + sign * f.sideArc * scale, y: start.y - f.arcLift * scale },
    { x: target.x - delta * 0.1 + sign * f.sideArc * scale, y: target.y + f.arcLift * scale },
    target,
    chase,
  );
  return {
    x: base.x + sign * f.fanSpread * scale * separation,
    y:
      base.y +
      (Math.abs(sign) * f.fanVertical * Math.sin(progress * Math.PI) * separation + dip) * scale,
  };
}

export function clefScale(t: number): number {
  const f = VFX.clef;
  if (t <= f.releaseFraction) {
    const r = t / f.releaseFraction - 1;
    return mix(f.releaseScale, 1, 1 + 2.70158 * r * r * r + 1.70158 * r * r);
  }
  return mix(1, f.arrivalScale, smooth((t - f.releaseFraction) / (1 - f.releaseFraction)));
}

/** Deterministic procedural variation: rendering and screenshot replays share the same particles. */
export function random01(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

export const FILTER_VERTEX = `
precision highp float;
in vec2 aPosition;
out vec2 vTextureCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
void main() {
  vec2 p = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  p.x = p.x * (2.0 / uOutputTexture.x) - 1.0;
  p.y = p.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  gl_Position = vec4(p, 0.0, 1.0);
  vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
}`;

/** Original analytic shader. It does not copy the CC BY-NC-SA Electric reference.
 * Native FieldConfig supplies palette/radius/vignette. Clear pulses use bounded outline
 * geometry instead of adding full-screen procedural work during ring clears.
 */
export const BACKDROP_FRAGMENT = `
precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;
uniform vec2 uSize;
uniform vec4 uInputSize;
uniform float uTier;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 hueTurn(vec3 rgb, float angle) {
  vec3 axis = normalize(vec3(1.0));
  return rgb*cos(angle) + cross(axis,rgb)*sin(angle) + axis*dot(axis,rgb)*(1.0-cos(angle));
}
void main() {
  vec2 px = vTextureCoord * uInputSize.xy;
  vec2 uv = px / uSize;
  vec2 delta = (uv - vec2(0.5,0.36))*vec2(uSize.x/uSize.y,1.0);
  float radial = pow(clamp(length(delta)/0.62,0.0,1.0),1.6);
  // Display-referred samples from the supplied video; source Unity values are (24,24,51)/(16,16,36).
  vec3 center = vec3(22.0,20.0,48.0)/255.0;
  vec3 edge = vec3(16.0,13.0,35.0)/255.0;
  vec3 color = mix(center,edge,radial);
  color = hueTurn(color,uTier*0.13962634) * (1.0+uTier*0.06);
  float vignette = smoothstep(0.62*0.75,0.62*1.7,length(delta));
  color *= 1.0-vignette*0.34;
  color += (hash(floor(px))-0.5)*0.004;
  finalColor = vec4(max(color,vec3(0.0)),1.0);
}`;
