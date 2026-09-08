import { makeContour, rotate } from './geometry';
import { ballFlightPosition } from './flight';
import { makeLineShards, shardPose, type LineShard } from './shatter';
import {
  Application,
  Assets,
  Buffer,
  BufferUsage,
  Container,
  Filter,
  GlProgram,
  Graphics,
  Mesh,
  MeshGeometry,
  Shader,
  Sprite,
  Text,
  Texture,
} from 'pixi.js';
import type { NativeBall, NativeConfig, NativeEvent, NativeRing, Vec2 } from './types';
import type { NativeModel } from './model';
import { NATIVE_CONFIG, worldToScreen } from './config';
import { SoftCameraImpulse } from './camera';
import { resolveRingAppearance, ringDepthStyle } from './depth';
import {
  BACKDROP_FRAGMENT,
  FILTER_VERTEX,
  VFX,
  clamp01,
  clefPoint,
  clefScale,
  fanOrdinal,
  mix,
  random01,
  smooth,
  springStep,
  type Spring,
} from './vfx';

const STROKE_VERTEX = `
in vec2 aPosition;
in vec2 aUV;
in vec4 aStrokeColor;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec4 uColor;
out vec2 vStroke;
out vec4 vColor;
void main() {
  vec3 p=uProjectionMatrix*uWorldTransformMatrix*uTransformMatrix*vec3(aPosition,1.0);
  gl_Position=vec4(p.xy,0.0,1.0);
  vStroke=aUV;
  vColor=aStrokeColor*uColor;
}`;
const STROKE_FRAGMENT = `
in vec2 vStroke;
in vec4 vColor;
out vec4 finalColor;
void main() {
  float crossStroke=abs(vStroke.x);
  float coverage=vStroke.y<0.0 ? 1.0-0.5*smoothstep(0.0,1.0,crossStroke)
    : 1.0-smoothstep(1.0-vStroke.y,1.0,crossStroke);
  float a=vColor.a*coverage;
  finalColor=vec4(vColor.rgb*a,a);
}`;

/** Keep backing storage across frames; the active view still determines Pixi's exact draw count. */
class StreamedBuffer {
  private storage: Float32Array | Uint32Array;
  private view: Float32Array | Uint32Array;
  constructor(
    private readonly buffer: Buffer,
    private readonly ArrayType: Float32ArrayConstructor | Uint32ArrayConstructor,
  ) {
    this.storage = this.view = new ArrayType(0);
    buffer.shrinkToFit = false;
  }
  upload(values: number[]) {
    if (this.storage.length < values.length) {
      this.storage = new this.ArrayType(2 ** Math.ceil(Math.log2(values.length)));
      this.view = this.storage.subarray(0, values.length);
    } else if (this.view.length !== values.length)
      this.view = this.storage.subarray(0, values.length);
    this.view.set(values);
    // Buffer.data marks the upload dirty even when its typed-array identity is unchanged.
    this.buffer.data = this.view;
  }
}

/** A single streamed WebGL mesh for all field ribbons; neither CPU canvas nor fat blurred lines. */
class RibbonMesh {
  readonly geometry = new MeshGeometry({
    positions: new Float32Array(8),
    uvs: new Float32Array(8),
    indices: new Uint32Array(6),
  });
  readonly colors = new Buffer({
    data: new Float32Array(16),
    usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
  });
  readonly mesh: Mesh<MeshGeometry, Shader>;
  private positions: number[] = [];
  private uvs: number[] = [];
  private rgba: number[] = [];
  private indices: number[] = [];
  private readonly positionStream = new StreamedBuffer(
    this.geometry.attributes.aPosition.buffer,
    Float32Array,
  );
  private readonly uvStream = new StreamedBuffer(this.geometry.attributes.aUV.buffer, Float32Array);
  private readonly indexStream = new StreamedBuffer(this.geometry.indexBuffer, Uint32Array);
  private readonly colorStream = new StreamedBuffer(this.colors, Float32Array);
  constructor(additive = false) {
    this.geometry.addAttribute('aStrokeColor', { buffer: this.colors, format: 'float32x4' });
    this.geometry.batchMode = 'no-batch';
    this.mesh = new Mesh({
      geometry: this.geometry,
      shader: Shader.from({ gl: { vertex: STROKE_VERTEX, fragment: STROKE_FRAGMENT } }),
    });
    if (additive) this.mesh.blendMode = 'add';
  }
  clear() {
    this.positions.length = this.uvs.length = this.rgba.length = this.indices.length = 0;
  }
  stroke(
    points: Vec2[],
    width: number | number[],
    color: number,
    alpha = 1,
    closed = false,
    ribbon = false,
    brightness = 1,
    opacity?: number[],
  ) {
    if (points.length < 2 || alpha <= 0) return;
    const count = points.length,
      offset = this.positions.length / 2;
    const red = (((color >> 16) & 255) / 255) * brightness;
    const green = (((color >> 8) & 255) / 255) * brightness;
    const blue = ((color & 255) / 255) * brightness;
    for (let i = 0; i < count; i++) {
      const previous = points[i === 0 ? (closed ? count - 2 : 0) : i - 1];
      const next = points[i === count - 1 ? (closed ? 1 : count - 1) : i + 1];
      const dx = next.x - previous.x,
        dy = next.y - previous.y,
        length = Math.hypot(dx, dy) || 1;
      const fullWidth = typeof width === 'number' ? width : width[i];
      const half = fullWidth * 0.5;
      const nx = (-dy / length) * half,
        ny = (dx / length) * half;
      this.positions.push(points[i].x + nx, points[i].y + ny, points[i].x - nx, points[i].y - ny);
      const shoulder = ribbon
        ? -1
        : Math.min(0.6, (VFX.field.shoulderPixels * 2) / Math.max(1, fullWidth));
      this.uvs.push(-1, shoulder, 1, shoulder);
      const a = alpha * (opacity?.[i] ?? 1);
      this.rgba.push(red, green, blue, a, red, green, blue, a);
      if (i < count - 1) {
        const n = offset + i * 2;
        this.indices.push(n, n + 1, n + 2, n + 1, n + 3, n + 2);
      }
    }
  }
  upload() {
    this.mesh.visible = this.indices.length > 0;
    if (!this.mesh.visible) return;
    this.uvStream.upload(this.uvs);
    this.positionStream.upload(this.positions);
    this.indexStream.upload(this.indices);
    this.colorStream.upload(this.rgba);
  }
}

interface TrailPoint extends Vec2 {
  time: number;
}
interface BallVisual {
  root: Container;
  aim: Container;
  squash: Container;
  body: Sprite;
  label: Text;
  spring: Spring;
  normal: number;
  impact: number;
  angle: number;
  hasAngle: boolean;
  speed: number;
  trail: TrailPoint[];
  flightTrailUntil: number;
  lastPosition: Vec2;
  lastSeen: number;
}
interface Spark {
  origin: Vec2;
  velocity: Vec2;
  time: number;
  seconds: number;
  color: number;
  size: number;
  stretch: number;
  rotation: number;
  kind: 'shard' | 'spark' | 'confetti';
}
interface Burst {
  position: Vec2;
  time: number;
  color: number;
  radius: number;
  kind: 'launch' | 'spent' | 'impact' | 'absorb';
}
interface ClefFlight {
  sprites: Sprite[];
  start: Vec2;
  target: Vec2;
  color: number;
  colorIndex: number;
  stem?: number;
  time: number;
  seconds: number;
  trails: TrailPoint[][];
  arrived: boolean;
  fusedBreaks: number;
}
interface Shock {
  color: number;
  time: number;
  outline: Vec2[];
  screen: Vec2[];
}
interface EqualizerBar {
  color: number;
  level: number;
  reveal: number;
}

export interface NativeRenderAssets {
  [key: string]: string;
}
export interface NativeFlightTiming {
  launchTime: number;
  arrivalTime: number;
}

/** Source-driven presentation of the native game at the video's 576 x 1280 logical resolution. */
export class NativeRenderer {
  readonly app = new Application();
  readonly viewport = new Container();
  private readonly scene = new Container();
  private readonly background = new Graphics();
  private readonly field = new RibbonMesh();
  private readonly equalizer = new Graphics();
  private readonly trails = new RibbonMesh(true);
  private readonly clearPulse = new RibbonMesh(true);
  private readonly lineLight = new RibbonMesh(true);
  private readonly glyphTrails = new RibbonMesh(true);
  private readonly particles = new Graphics();
  private readonly ballsLayer = new Container();
  private readonly glyphLayer = new Container();
  private readonly overlay = new Graphics();
  private readonly topEffects = new Graphics();
  private readonly ballVisuals = new Map<number, BallVisual>();
  private readonly presentBalls = new Set<number>();
  private readonly screenPointPool: Vec2[] = [];
  private readonly screenPoints: Vec2[] = [];
  private readonly trailWidths: number[] = [];
  private readonly trailAlphas: number[] = [];
  private ballTexture!: Texture;
  private clefTexture!: Texture;
  private backdrop!: Filter;
  private config: NativeConfig = NATIVE_CONFIG;
  private palette: number[] = [0xf64648, 0x63cd42, 0x308aff, 0xfed22b];
  private colorTargets = new Map<number, number>();
  private sparks: Spark[] = [];
  private lineShards: LineShard[] = [];
  private lastModel?: NativeModel;
  private bursts: Burst[] = [];
  private flights: ClefFlight[] = [];
  private shocks: Shock[] = [];
  private flashes = new Map<number, number>();
  private equalizerBars: EqualizerBar[] = [];
  private equalizerCredits = new Map<number, number>();
  private equalizerActivation = new Map<number, number>();
  private equalizerBreaks = new Map<number, number>();
  private plannedSegments = 96;
  private readonly cameraImpulse = new SoftCameraImpulse();
  private clock = 0;
  private tier = 0;
  private stageStart = -100;
  private stageStem = -1;
  private finish = -100;
  private initialized = false;
  private introEnabled = false;
  private arenaRingCapacity = 6;
  private remainingRingCount = 0;
  reducedMotion =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  onGlyphArrive?: (color: number, stem: number | undefined, fusedBreaks: number) => void;
  onStage?: (stem: number, phase: number) => void;

  async init(parent: HTMLElement, assets: NativeRenderAssets = {}) {
    await this.app.init({
      width: this.config.view.width,
      height: this.config.view.height,
      backgroundAlpha: 0,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      preference: 'webgl',
      autoStart: false,
      powerPreference: 'high-performance',
    });
    parent.appendChild(this.app.canvas);
    this.app.canvas.setAttribute('aria-hidden', 'true');
    this.app.canvas.style.width = '100%';
    this.app.canvas.style.height = '100%';
    this.app.canvas.style.display = 'block';
    this.background.rect(0, 0, this.config.view.width, this.config.view.height).fill(0x14112e);
    this.backdrop = new Filter({
      glProgram: GlProgram.from({
        vertex: FILTER_VERTEX,
        fragment: BACKDROP_FRAGMENT,
        name: 'beat-bloom-native-backdrop',
      }),
      resources: {
        backdrop: {
          uSize: { value: [576, 1280], type: 'vec2<f32>' },
          uTier: { value: 0, type: 'f32' },
        },
      },
      resolution: 1,
    });
    this.background.filters = [this.backdrop];
    this.ballTexture = this.makeBallTexture();
    this.clefTexture = assets.clef
      ? await Assets.load<Texture>(assets.clef)
      : this.makeClefTexture();
    this.scene.addChild(
      this.clearPulse.mesh,
      this.field.mesh,
      this.lineLight.mesh,
      this.equalizer,
      this.trails.mesh,
      this.particles,
      this.ballsLayer,
      this.glyphTrails.mesh,
      this.glyphLayer,
      this.overlay,
      this.topEffects,
    );
    this.viewport.addChild(this.background, this.scene);
    this.app.stage.addChild(this.viewport);
    this.initialized = true;
  }

  resize(width = this.config.view.width, height = this.config.view.height) {
    if (!this.initialized) return;
    this.app.renderer.resize(width, height);
    const scale = Math.min(width / this.config.view.width, height / this.config.view.height);
    this.viewport.scale.set(scale);
    this.viewport.position.set(
      (width - this.config.view.width * scale) / 2,
      (height - this.config.view.height * scale) / 2,
    );
  }

  setIntro(enabled: boolean) {
    this.introEnabled = enabled;
  }

  event(e: NativeEvent, timing?: NativeFlightTiming) {
    const color = this.ballColor(e.color);
    const position = worldToScreen(e.position, this.config);
    const scale = this.config.view.pixelsPerUnit;
    if (e.type === 'impact' || e.type === 'break') {
      const visual = e.ballId === undefined ? undefined : this.ballVisuals.get(e.ballId);
      if (visual) {
        visual.spring.position = 1;
        visual.spring.velocity = 0;
        visual.normal = Math.atan2(e.normal?.y ?? 0, e.normal?.x ?? 1);
        visual.impact = clamp01(e.impact ?? (e.speed ?? 5) / VFX.trail.maxSpeed);
      }
    }
    if (e.type === 'launch') {
      this.bursts.push({
        position,
        time: e.time,
        color,
        radius: scale * VFX.launch.radius * 0.5,
        kind: 'launch',
      });
      this.emitSparks(position, color, e.time, VFX.launch.sparks, scale * 2.4, 0.16, 'spark');
    }
    if (e.type === 'break') {
      this.cameraImpulse.trigger('break', e.time, e.normal ?? e.position, this.reducedMotion);
      this.equalizerCredits.set(
        e.color,
        (this.equalizerCredits.get(e.color) ?? 0) + VFX.equalizer.barCount / this.plannedSegments,
      );
      this.equalizerBreaks.set(e.color, e.time);
      if (e.segmentId !== undefined) this.flashes.set(e.segmentId, e.time);
      this.bursts.push({
        position,
        time: e.time,
        color,
        radius: scale * VFX.impact.scale * 0.48,
        kind: 'impact',
      });
      if (!this.reducedMotion) {
        const segment = this.lastModel?.rings[e.ringId ?? -1]?.segments.find(
          (s) => s.id === e.segmentId,
        );
        if (segment) {
          const path = segment.points.map((p) => worldToScreen(p, this.config));
          const width = (this.lastModel?.level.lineThickness ?? 0.18) * scale;
          this.lineShards.push(...makeLineShards(path, width, color, e.time, e.segmentId ?? 0));
          this.lineShards = this.lineShards.slice(-VFX.shatter.maxConcurrent);
        }
      }
      this.makeFlight(e, position, color, timing);
    }
    if (e.type === 'ringClear') {
      if (!this.reducedMotion && this.lastModel) {
        const model = this.lastModel;
        const cleared = model.rings[e.ringId ?? -1];
        const source = cleared?.points.length
          ? cleared.points.map((p) => rotate(p, -model.rotation))
          : makeContour(model.level.shape, model.level.flowerPetals, model.level.roundness);
        const radius = Math.max(0.001, ...source.map((p) => Math.hypot(p.x, p.y)));
        const count = Math.min(VFX.shockwave.samples, source.length);
        const outline = Array.from({ length: count }, (_, i) => {
          const p = source[Math.floor((i * source.length) / count)];
          return { x: p.x / radius, y: p.y / radius };
        });
        outline.push({ ...outline[0] });
        this.shocks.push({
          color,
          time: e.time,
          outline,
          screen: outline.map(() => ({ x: 0, y: 0 })),
        });
        if (this.shocks.length > VFX.shockwave.maxConcurrent) this.shocks.shift();
      }
      this.cameraImpulse.trigger('ringClear', e.time, e.position, this.reducedMotion);
    }
    if (e.type === 'spent') {
      const visual = e.ballId === undefined ? undefined : this.ballVisuals.get(e.ballId);
      const radius = visual ? visual.body.width * 0.5 : this.config.view.queueRadius;
      this.bursts.push({ position, time: e.time, color, radius, kind: 'spent' });
      this.emitSparks(
        position,
        color,
        e.time,
        VFX.spent.shards,
        scale * 3.2,
        VFX.spent.seconds,
        'shard',
      );
    }
    if (e.type === 'unlock') {
      this.stageStart = e.time;
      this.stageStem = e.stem ?? e.color;
      this.tier = Math.max(this.tier, e.stem ?? this.tier + 1);
      this.cameraImpulse.trigger('unlock', e.time, { x: 0, y: -1 }, this.reducedMotion);
      for (const [colorIndex, laneIndex] of this.colorTargets) {
        if (laneIndex === (e.stem ?? e.color + 1) - 1)
          this.equalizerActivation.set(colorIndex, e.time);
      }
      const target = this.instrumentTarget(e.color);
      this.bursts.push({ position: target, time: e.time, color, radius: 39, kind: 'absorb' });
    }
    if (e.type === 'win') {
      this.finish = e.time;
      this.makeCelebration(e.time);
    }
  }

  draw(model: NativeModel, dt: number, beat: number) {
    if (!this.initialized) return;
    this.lastModel = model;
    this.config = model.config;
    this.palette = model.level.palette;
    this.arenaRingCapacity = model.level.arenaRingCapacity;
    this.remainingRingCount = model.rings.length - model.removedInnerRings;
    this.colorTargets.clear();
    model.level.stemLanes.forEach((lane, index) =>
      lane.colors.forEach((color) => this.colorTargets.set(color, index)),
    );
    this.clock = model.time;
    // Presentation only needs these counters, not snapshot's queue/tray/progress array copies.
    let total = 0,
      remaining = 0;
    for (const ring of model.rings)
      for (const segment of ring.segments) {
        if (segment.color >= 0) total++;
        if (segment.alive) remaining++;
      }
    this.plannedSegments = total;
    dt = Math.max(0, Math.min(dt, 0.1));
    this.shakeScene();
    this.updateBackdrop();
    this.drawClearPulse(model);
    this.drawField(model, beat);
    this.drawEqualizer(remaining, dt, beat);
    this.drawBalls(model.balls, dt);
    this.drawFlights(dt);
    this.drawParticles();
    this.drawStage();
    this.app.render();
  }

  private drawField(model: NativeModel, _beat: number) {
    const field = this.field;
    field.clear();
    this.lineLight.clear();
    const view = this.config.view,
      scale = view.pixelsPerUnit;
    const stroke = model.level.lineThickness * scale + VFX.field.shoulderPixels * 2;
    const appearance = resolveRingAppearance(model.level);
    for (const ring of model.rings) {
      if (ring.sourceLayer < model.removedInnerRings) continue;
      const style = ringDepthStyle(
        ring.layoutLayer,
        model.level.arenaRingCapacity,
        this.config.field.wallMarginSpacings,
        appearance,
      );
      const intro = this.introLayerAlpha(ring.layoutLayer);
      const colorAlpha = style.colorAlpha * intro,
        shadowAlpha = style.shadowAlpha * intro;
      if (Math.max(colorAlpha, shadowAlpha) < VFX.field.cullAlpha) continue;
      if (colorAlpha < VFX.field.cullAlpha && !ring.segments.some((s) => s.alive && s.color >= 0))
        continue;
      const visual = model.getVisualRing(ring.sourceLayer);
      if (visual)
        this.drawRing(visual, stroke, colorAlpha, shadowAlpha, this.ringIllumination(visual));
    }
    const wall = this.toScreenPoints(model.wallPoints);
    if (wall.length > 2)
      field.stroke(
        this.close(wall),
        this.config.field.wallThickness * scale + VFX.field.shoulderPixels * 2,
        VFX.field.wallColor,
        VFX.field.wallAlpha * this.introLayerAlpha(this.arenaRingCapacity),
        true,
      );
    field.upload();
    this.lineLight.upload();
    for (const [id, time] of this.flashes)
      if (this.clock - time > VFX.field.flashSeconds) this.flashes.delete(id);
  }

  /** Use the same expanding contour radius as the clear pulse, with a short afterglow.
   * One envelope per ring keeps this bounded independently of its segment count.
   */
  private ringIllumination(ring: NativeRing): number {
    if (this.reducedMotion || !this.shocks.length) return 0;
    let radius = 0;
    for (const p of ring.points) radius = Math.max(radius, Math.hypot(p.x, p.y));
    radius *= this.config.view.pixelsPerUnit;
    const cfg = VFX.shockwave;
    let light = 0;
    for (const pulse of this.shocks) {
      const age = (this.clock - pulse.time) / cfg.seconds;
      if (age < 0 || age >= 1) continue;
      const front = mix(cfg.startRadius, this.config.view.width * cfg.endRadiusFactor, age);
      const distance = front - radius;
      const width = distance < 0 ? cfg.lineLeadPixels : cfg.lineAfterglowPixels;
      const envelope = smooth(1 - clamp01(Math.abs(distance) / width));
      light = Math.max(light, envelope * (1 - age * cfg.lineOuterFade));
    }
    return light;
  }

  private drawRing(
    ring: NativeRing,
    stroke: number,
    colorAlpha: number,
    shadowAlpha: number,
    illumination = 0,
  ) {
    for (const segment of ring.segments) {
      if (segment.color < 0) continue;
      const points = this.toScreenPoints(segment.points);
      if (!this.pathOnScreen(points, stroke * VFX.field.flashWidth)) continue;
      if (segment.alive && shadowAlpha >= VFX.field.cullAlpha) {
        this.field.stroke(points, stroke, VFX.field.trackColor, shadowAlpha);
      }
      if (colorAlpha >= VFX.field.cullAlpha && !segment.alive) {
        this.field.stroke(points, stroke, VFX.field.trackColor, colorAlpha * VFX.field.trackAlpha);
      } else if (colorAlpha >= VFX.field.cullAlpha) {
        const base = this.palette[segment.color] ?? 0xffffff;
        this.field.stroke(points, stroke, base, colorAlpha);
        // Additive neon overlays illuminate the actual rotating ring, not a second outline.
        // Only the small band reached by the center pulse is submitted to this mesh.
        const glow = illumination * colorAlpha;
        if (glow > VFX.field.cullAlpha) {
          this.lineLight.stroke(
            points,
            stroke + VFX.shockwave.lineHaloPixels,
            base,
            glow * VFX.shockwave.lineHaloAlpha,
          );
          this.lineLight.stroke(
            points,
            stroke,
            this.lighten(base, VFX.shockwave.lineWhiteness),
            glow * VFX.shockwave.lineBodyAlpha,
          );
          this.lineLight.stroke(
            points,
            stroke * VFX.shockwave.lineCoreWidth,
            0xffffff,
            glow * VFX.shockwave.lineCoreAlpha,
          );
        }
      }
      const flashAt = this.flashes.get(segment.id);
      if (flashAt !== undefined) {
        const phase = clamp01((this.clock - flashAt) / VFX.field.flashSeconds);
        const color = this.palette[segment.color] ?? 0xffffff;
        this.field.stroke(
          points,
          stroke * mix(VFX.field.flashWidth, 1, phase),
          this.lighten(color, 0.46),
          (1 - phase) * 0.86 * colorAlpha,
        );
      }
    }
  }

  /** Clip actual line segments, not a radius guess that can hide a heart's inward notch. */
  private pathOnScreen(points: Vec2[], stroke: number): boolean {
    if (points.length < 2) return false;
    const scale = this.scene.scale.x,
      center = this.config.view.center;
    const margin = stroke * 0.5 + VFX.field.viewportMarginPixels / Math.max(scale, 0.001);
    const left = center.x - this.scene.position.x / scale - margin;
    const right = center.x + (this.config.view.width - this.scene.position.x) / scale + margin;
    const top = center.y - this.scene.position.y / scale - margin;
    const bottom = center.y + (this.config.view.height - this.scene.position.y) / scale + margin;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i],
        dx = b.x - a.x,
        dy = b.y - a.y;
      let enter = 0,
        leave = 1;
      const clip = (direction: number, distance: number) => {
        if (direction === 0) return distance >= 0;
        const t = distance / direction;
        if (direction < 0) {
          if (t > leave) return false;
          enter = Math.max(enter, t);
        } else {
          if (t < enter) return false;
          leave = Math.min(leave, t);
        }
        return true;
      };
      if (
        clip(-dx, a.x - left) &&
        clip(dx, right - a.x) &&
        clip(-dy, a.y - top) &&
        clip(dy, bottom - a.y)
      )
        return true;
    }
    return false;
  }

  /** BeatBloomCenterEqualizer: chronological earned bars; motion means the stem is audible. */
  private drawEqualizer(remaining: number, dt: number, beat: number) {
    const eq = VFX.equalizer;
    const targetCount = Math.ceil(
      ((this.plannedSegments - remaining) / this.plannedSegments) * eq.barCount,
    );
    while (this.equalizerBars.length < targetCount) {
      let color = 0,
        credit = -Infinity;
      for (const [candidate, value] of this.equalizerCredits)
        if (value > credit) {
          color = candidate;
          credit = value;
        }
      this.equalizerCredits.set(color, (this.equalizerCredits.get(color) ?? 0) - 1);
      this.equalizerBars.push({ color, level: 0, reveal: 0 });
    }
    const graphic = this.equalizer.clear(),
      center = this.config.view.center;
    const phase = ((beat % 1) + 1) % 1;
    const kick = (1 - phase) ** 2.35;
    const offBeat = clamp01(1 - Math.abs(phase - 0.5) / 0.16) ** 2 * 0.24;
    const pulse = Math.max(kick, offBeat);
    this.equalizerBars.forEach((bar, index) => {
      const spatial = index / eq.barCount,
        seed = (index * 0.61803398875) % 1;
      const activeAt = this.equalizerActivation.get(bar.color);
      const active = activeAt !== undefined;
      const activation = active ? clamp01(1 - (this.clock - activeAt) * eq.activationRelease) : 0;
      const breakFlash = clamp01(
        1 - (this.clock - (this.equalizerBreaks.get(bar.color) ?? -100)) * eq.breakRelease,
      );
      const low = 0.5 + 0.5 * Math.sin(Math.PI * 2 * (beat * 0.5 + spatial * 2 + seed * 0.17));
      const mid = 0.5 + 0.5 * Math.sin(Math.PI * 2 * (beat + spatial * 5 + seed * 0.41 + 0.19));
      const high =
        0.5 + 0.5 * Math.sin(Math.PI * 2 * (beat * 1.5 - spatial * 8 + seed * 0.73 + 0.61));
      const spectrum = low * 0.42 + mid * 0.35 + high * 0.23;
      const musicLevel = clamp01(mix(0.08, 0.38, spectrum) + pulse * mix(0.34, 0.62, spectrum));
      const target = Math.min(
        1,
        (active && !this.reducedMotion ? mix(eq.resting, 1, musicLevel) : eq.dormant) +
          activation * 0.45,
      );
      bar.level = mix(
        bar.level,
        target,
        1 - Math.exp(-(target > bar.level ? eq.attack : eq.release) * dt),
      );
      bar.reveal = mix(bar.reveal, 1, 1 - Math.exp(-eq.reveal * dt));
      const length = bar.reveal * eq.radius * mix(eq.minLength, eq.maxLength, bar.level);
      const angle = spatial * Math.PI * 2 - Math.PI / 2;
      const color = this.lighten(
        this.palette[bar.color] ?? 0xffffff,
        clamp01(
          bar.level * 0.22 + breakFlash * eq.breakBrightness + activation * eq.activationBrightness,
        ),
      );
      const alpha = bar.reveal * (0.48 + bar.level * 0.52) * (active ? 1 : eq.dormantAlpha);
      graphic
        .moveTo(center.x + Math.cos(angle) * eq.radius, center.y + Math.sin(angle) * eq.radius)
        .lineTo(
          center.x + Math.cos(angle) * (eq.radius + length),
          center.y + Math.sin(angle) * (eq.radius + length),
        )
        .stroke({ color, alpha, width: eq.width });
    });
  }

  private drawBalls(balls: NativeBall[], dt: number) {
    this.trails.clear();
    const present = this.presentBalls;
    present.clear();
    for (const ball of balls) {
      present.add(ball.id);
      let visual = this.ballVisuals.get(ball.id);
      if (!visual) {
        visual = this.makeBall(ball);
        this.ballVisuals.set(ball.id, visual);
      }
      visual.lastSeen = this.clock;
      const position = worldToScreen(ball.position, this.config);
      const moving =
        ball.state === 'active' || ball.state === 'incoming' || ball.state === 'banking';
      visual.root.visible = moving;
      if (moving) {
        const delta = Math.hypot(
          position.x - visual.lastPosition.x,
          position.y - visual.lastPosition.y,
        );
        const speed =
          dt > 0
            ? Math.min(VFX.trail.maxSpeed, delta / dt / this.config.view.pixelsPerUnit)
            : visual.speed;
        visual.speed = mix(visual.speed, speed, 0.5);
        const transfer = ball.state === 'incoming' || ball.state === 'banking';
        if (transfer && !this.reducedMotion) {
          // Reconstruct a short, bounded ribbon from the real flight curve. Sampling does not
          // depend on frame rate, world zoom, velocity cutoffs or a missed first launch frame.
          const t = VFX.transferTrail;
          const startAge = Math.max(0, ball.stateAge - t.seconds);
          for (let i = 0; i < t.samples; i++) {
            const age = mix(startAge, ball.stateAge, i / (t.samples - 1));
            const point = worldToScreen(ballFlightPosition(ball, age), this.config);
            const sample = visual.trail[i] ?? { x: 0, y: 0, time: 0 };
            sample.x = point.x;
            sample.y = point.y;
            sample.time = this.clock - (ball.stateAge - age);
            visual.trail[i] = sample;
          }
          visual.trail.length = t.samples;
          visual.flightTrailUntil = this.clock + t.seconds;
        } else {
          const teleport =
            Math.max(VFX.trail.teleportDistance, this.config.physics.maxSpeed * dt * 2) *
            this.config.view.pixelsPerUnit;
          if (delta > teleport) visual.trail.length = 0;
          if (
            dt > 0 &&
            (visual.trail.length === 0 ||
              delta > VFX.trail.minVertex * this.config.view.pixelsPerUnit)
          )
            visual.trail.push({ ...position, time: this.clock });
        }
        visual.root.position.copyFrom(position);
        this.deformBall(visual, ball, dt);
      } else if (ball.state === 'stored') {
        visual.trail.length = 0;
        visual.speed = 0;
      }
      visual.lastPosition = position;
      this.drawBallTrail(visual, visual.body.width, this.ballColor(ball.color, 1));
    }
    for (const [id, visual] of this.ballVisuals) {
      if (present.has(id)) continue;
      visual.root.visible = false;
      if (this.clock - visual.lastSeen > VFX.trail.maxTime) {
        visual.root.destroy({ children: true });
        this.ballVisuals.delete(id);
      } else this.drawBallTrail(visual, this.config.view.queueRadius * 2, visual.body.tint);
    }
    this.trails.upload();
  }

  private makeBall(ball: NativeBall): BallVisual {
    const root = new Container(),
      aim = new Container(),
      squash = new Container();
    const body = new Sprite(this.ballTexture);
    body.anchor.set(0.5);
    const label = new Text({
      text: String(ball.power),
      style: {
        fontFamily: 'Lilita One',
        fontSize: 30,
        fill: 0x141015,
        fontWeight: '400',
        align: 'center',
      },
      resolution: 2,
    });
    label.anchor.set(0.5);
    root.addChild(aim, label);
    aim.addChild(squash);
    squash.addChild(body);
    this.ballsLayer.addChild(root);
    return {
      root,
      aim,
      squash,
      body,
      label,
      spring: { position: 0, velocity: 0 },
      normal: 0,
      impact: 0,
      angle: 0,
      hasAngle: false,
      speed: 0,
      trail: [],
      flightTrailUntil: -Infinity,
      lastPosition: worldToScreen(ball.position, this.config),
      lastSeen: this.clock,
    };
  }

  private deformBall(v: BallVisual, ball: NativeBall, dt: number) {
    const speed = Math.hypot(ball.velocity.x, ball.velocity.y);
    if (speed > VFX.trail.minSpeed * 0.5) {
      const target = Math.atan2(ball.velocity.y, ball.velocity.x);
      if (!v.hasAngle) {
        v.angle = target;
        v.hasAngle = true;
      } else {
        const delta = Math.atan2(Math.sin(target - v.angle), Math.cos(target - v.angle));
        v.angle += delta * (1 - Math.exp(-VFX.deform.aimSmoothing * dt));
      }
    }
    const stretch =
      1 +
      VFX.deform.velocityStretch *
        clamp01((speed - VFX.trail.minSpeed) / (VFX.trail.maxSpeed - VFX.trail.minSpeed));
    v.aim.rotation = v.angle;
    v.aim.scale.set(stretch, 1 / stretch);
    springStep(v.spring, Math.min(dt, VFX.deform.maxStep));
    const amplitude = v.spring.position * v.impact;
    v.squash.rotation = v.normal - Math.PI / 2;
    v.squash.scale.set(1 + VFX.deform.tangent * amplitude, 1 - VFX.deform.squash * amplitude);
    const centerScale = this.config.view.activeBallScale ?? 1;
    const transit = clamp01(ball.stateAge / Math.max(0.001, ball.flightDuration));
    const sizeScale =
      ball.state === 'incoming'
        ? mix(1, centerScale, transit)
        : ball.state === 'banking'
          ? mix(centerScale, 1, transit)
          : ball.state === 'stored'
            ? 1
            : centerScale;
    const diameter =
      ball.visualRadius * 2 * this.config.view.pixelsPerUnit * ball.scale * sizeScale;
    v.body.width = diameter;
    v.body.height = diameter;
    v.body.tint = this.ballColor(ball.color);
    v.label.text = String(ball.power);
    v.label.style.fontSize = diameter * 0.61;
    v.label.position.set(0, diameter * 0.015);
    v.label.scale.set(1);
  }

  private drawBallTrail(v: BallVisual, diameter: number, color: number) {
    const t = VFX.trail;
    const speed01 = clamp01((v.speed - t.minSpeed) / (t.maxSpeed - t.minSpeed));
    const length =
      (mix(t.lengthSlow, t.lengthFast, speed01) * diameter) / this.config.view.pixelsPerUnit;
    const transfer = this.clock < v.flightTrailUntil;
    const seconds = transfer
      ? VFX.transferTrail.seconds
      : Math.max(t.minTime, Math.min(t.maxTime, length / mix(t.minSpeed, t.maxSpeed, speed01)));
    let retained = 0;
    for (const point of v.trail)
      if (this.clock - point.time <= seconds) v.trail[retained++] = point;
    v.trail.length = retained;
    if (v.trail.length < 2 || this.reducedMotion || (!transfer && v.speed < t.cutoff)) return;
    const points = v.trail;
    const width =
      (transfer ? VFX.transferTrail.headWidth : mix(t.headSlow, t.headFast, speed01)) * diameter;
    const widths = this.trailWidths,
      alphas = this.trailAlphas;
    widths.length = alphas.length = 0;
    for (const point of points) {
      const remaining = clamp01(1 - (this.clock - point.time) / seconds);
      widths.push(width * remaining);
      alphas.push(remaining);
    }
    this.trails.stroke(
      points,
      widths,
      color,
      1,
      false,
      true,
      transfer ? VFX.transferTrail.brightness : mix(t.brightnessSlow, t.brightnessFast, speed01),
      alphas,
    );
  }

  private makeFlight(e: NativeEvent, start: Vec2, color: number, timing?: NativeFlightTiming) {
    if (!this.clefTexture) return;
    const launchTime = timing?.launchTime ?? e.time;
    const seconds = timing
      ? Math.max(0.001, timing.arrivalTime - timing.launchTime)
      : VFX.clef.seconds;
    // A native fusion key includes color/lane and a shared sample-aligned target. It never combines
    // unrelated notes merely because their on-screen particles happen to overlap.
    const fusion =
      timing &&
      this.flights.find(
        (f) =>
          f.colorIndex === e.color &&
          !f.arrived &&
          Math.abs(f.time - launchTime) <= 1 / 48000 &&
          Math.abs(f.seconds - seconds) <= 1 / 48000,
      );
    if (fusion && fusion.fusedBreaks < VFX.clef.maxFusedBreaks) {
      const count = fusion.fusedBreaks + 1;
      fusion.start.x = mix(fusion.start.x, start.x, 1 / count);
      fusion.start.y = mix(fusion.start.y, start.y, 1 / count);
      fusion.fusedBreaks = count;
      const targetCount = Math.min(
        VFX.clef.maxFanCount,
        (this.reducedMotion ? 2 : VFX.clef.count) + (count - 1) * VFX.clef.extraPerFusedBreak,
      );
      while (fusion.sprites.length < targetCount) {
        const sprite = new Sprite(this.clefTexture);
        sprite.anchor.set(0.5);
        sprite.tint = color;
        sprite.blendMode = 'add';
        sprite.visible = false;
        this.glyphLayer.addChild(sprite);
        fusion.sprites.push(sprite);
        fusion.trails.push([]);
      }
      return;
    }
    if (this.flights.length >= VFX.clef.maxConcurrent) return;
    const sprites: Sprite[] = [];
    const count = this.reducedMotion ? 2 : VFX.clef.count;
    for (let i = 0; i < count; i++) {
      const sprite = new Sprite(this.clefTexture);
      sprite.anchor.set(0.5);
      sprite.tint = color;
      sprite.blendMode = 'add';
      sprite.visible = false;
      this.glyphLayer.addChild(sprite);
      sprites.push(sprite);
    }
    this.flights.push({
      sprites,
      start,
      target: this.instrumentTarget(e.color),
      color,
      colorIndex: e.color,
      stem: e.stem,
      time: launchTime,
      seconds,
      trails: sprites.map(() => []),
      arrived: false,
      fusedBreaks: 1,
    });
  }

  private drawFlights(dt: number) {
    this.glyphTrails.clear();
    this.flights = this.flights.filter((flight) => {
      if (this.clock < flight.time) {
        flight.sprites.forEach((sprite) => {
          sprite.visible = false;
        });
        return true;
      }
      const progress = clamp01((this.clock - flight.time) / flight.seconds);
      if (progress >= 1 && !flight.arrived) {
        flight.arrived = true;
        this.onGlyphArrive?.(flight.colorIndex, flight.stem, flight.fusedBreaks);
        this.bursts.push({
          position: flight.target,
          time: this.clock,
          color: flight.color,
          radius: 23,
          kind: 'absorb',
        });
      }
      const linger = this.clock - flight.time - flight.seconds;
      if (linger > VFX.clef.trailSeconds) {
        flight.sprites.forEach((sprite) => sprite.destroy());
        return false;
      }
      const scale = this.config.view.pixelsPerUnit;
      flight.sprites.forEach((sprite, ordinal) => {
        sprite.visible = progress < 1;
        const point = this.reducedMotion
          ? {
              x: mix(flight.start.x, flight.target.x, progress),
              y: mix(flight.start.y, flight.target.y, progress),
            }
          : clefPoint(flight.start, flight.target, ordinal, progress, scale, flight.sprites.length);
        sprite.position.copyFrom(point);
        const sign = fanOrdinal(ordinal, flight.sprites.length);
        const facing = 1 - smooth((progress - VFX.clef.facingSettle) / (1 - VFX.clef.facingSettle));
        sprite.rotation =
          (((sign * VFX.clef.rotation + Math.sin(progress * Math.PI * 2) * VFX.clef.wobble) *
            Math.PI) /
            180) *
          facing;
        const size =
          VFX.clef.worldSize *
          scale *
          clefScale(progress) *
          (ordinal ? VFX.clef.satelliteScale : 1) *
          (1 + (flight.fusedBreaks - 1) * VFX.clef.fusedScale);
        sprite.width = size;
        sprite.height = (size * this.clefTexture.height) / this.clefTexture.width;
        sprite.alpha = Math.min(1, progress * 12);
        const trail = flight.trails[ordinal];
        if (dt > 0 && progress < 1) trail.push({ ...point, time: this.clock });
        while (trail.length && this.clock - trail[0].time > VFX.clef.trailSeconds) trail.shift();
        if (trail.length > 1 && !this.reducedMotion) {
          const widths = this.trailWidths,
            alphas = this.trailAlphas;
          widths.length = alphas.length = 0;
          for (const point of trail) {
            const remaining = clamp01(1 - (this.clock - point.time) / VFX.clef.trailSeconds);
            widths.push(VFX.clef.trailWidth * scale * remaining);
            alphas.push(remaining * 0.7);
          }
          this.glyphTrails.stroke(trail, widths, flight.color, 1, false, true, 1, alphas);
        }
      });
      return true;
    });
    this.glyphTrails.upload();
  }

  private emitSparks(
    position: Vec2,
    color: number,
    time: number,
    count: number,
    speed: number,
    seconds: number,
    kind: Spark['kind'],
  ) {
    if (this.reducedMotion) count = Math.min(count, 3);
    for (let i = 0; i < count; i++) {
      const seed = i + time * 91,
        angle = (i / count) * Math.PI * 2 + random01(seed) * 0.65;
      const velocity = speed * mix(0.3, 1, random01(seed + 10));
      this.sparks.push({
        origin: { ...position },
        velocity: { x: Math.cos(angle) * velocity, y: Math.sin(angle) * velocity },
        time,
        seconds: seconds * mix(0.6, 1, random01(seed + 20)),
        color,
        size: mix(1.4, 4, random01(seed + 30)),
        stretch: mix(1.4, 2.6, random01(seed + 40)),
        rotation: angle,
        kind,
      });
    }
    if (this.sparks.length > 400) this.sparks.splice(0, this.sparks.length - 400);
  }

  private drawParticles() {
    const graphics = this.particles.clear(),
      top = this.topEffects.clear();
    if (this.reducedMotion) this.lineShards = [];
    this.lineShards = this.lineShards.filter((shard) => {
      const pose = shardPose(shard, this.clock);
      if (!pose.alive) return false;
      const c = Math.cos(pose.angle),
        s = Math.sin(pose.angle);
      shard.points.forEach((p, i) => {
        const x = pose.x + p.x * pose.scaleX * c - p.y * s,
          y = pose.y + p.x * pose.scaleX * s + p.y * c;
        if (i === 0) graphics.moveTo(x, y);
        else graphics.lineTo(x, y);
      });
      graphics
        .closePath()
        .fill({ color: shard.color, alpha: pose.alpha * VFX.shatter.opacity })
        .stroke({
          width: VFX.shatter.edgeWidth,
          color: 0xffffff,
          alpha: pose.alpha * VFX.shatter.edgeOpacity * pose.face,
          join: 'bevel',
        });
      // One translucent facet suggests glass catching light as it tumbles.
      for (const [i, p] of [shard.points[0], shard.points[1], shard.facet].entries()) {
        const x = pose.x + p.x * pose.scaleX * c - p.y * s;
        const y = pose.y + p.x * pose.scaleX * s + p.y * c;
        if (i === 0) graphics.moveTo(x, y);
        else graphics.lineTo(x, y);
      }
      graphics
        .closePath()
        .fill({ color: 0xffffff, alpha: pose.alpha * VFX.shatter.facetOpacity * pose.face });
      return true;
    });
    this.sparks = this.sparks.filter((p) => {
      const age = this.clock - p.time,
        phase = age / p.seconds;
      if (phase < 0) return true;
      if (phase >= 1) return false;
      const drag = p.kind === 'confetti' ? age : (1 - Math.exp(-age * 3)) / 3;
      const x = p.origin.x + p.velocity.x * drag;
      const y = p.origin.y + p.velocity.y * drag + age * age * (p.kind === 'confetti' ? 76 : 21);
      const opacity = p.kind === 'confetti' ? Math.min(1, (1 - phase) * 4) : (1 - phase) ** 1.4;
      const angle = p.rotation + age * (p.kind === 'confetti' ? 5.1 : 1.8);
      const size = p.size * (p.kind === 'confetti' ? 1 : 1 - phase * 0.7);
      const target = p.kind === 'confetti' ? top : graphics;
      const dx = Math.cos(angle) * size * p.stretch,
        dy = Math.sin(angle) * size * p.stretch;
      target
        .moveTo(x + dx, y + dy)
        .lineTo(x - dy * 0.35, y + dx * 0.35)
        .lineTo(x - dx, y - dy)
        .lineTo(x + dy * 0.35, y - dx * 0.35)
        .closePath()
        .fill({ color: p.color, alpha: opacity });
      return true;
    });
    this.bursts = this.bursts.filter((burst) => {
      const age = this.clock - burst.time;
      const duration =
        burst.kind === 'launch'
          ? VFX.launch.seconds
          : burst.kind === 'spent'
            ? VFX.spent.seconds
            : burst.kind === 'absorb'
              ? VFX.clef.absorbSeconds
              : VFX.impact.seconds;
      const phase = age / duration;
      if (phase < 0) return true;
      if (phase >= 1) return false;
      const { x, y } = burst.position;
      const alpha = (1 - phase) ** 1.3;
      const radius =
        burst.radius *
        (burst.kind === 'spent'
          ? mix(VFX.spent.squash, VFX.spent.expand, smooth(phase))
          : mix(0.35, 1.7, phase));
      graphics
        .circle(x, y, radius)
        .stroke({ width: mix(3.5, 0.8, phase), color: burst.color, alpha: alpha * 0.7 });
      if (burst.kind === 'spent') {
        graphics
          .circle(x, y, radius * 0.55)
          .fill({ color: this.lighten(burst.color, VFX.spent.flash), alpha: alpha * 0.84 });
        for (let i = 0; i < VFX.spent.shards; i++) {
          const angle = (i / VFX.spent.shards) * Math.PI * 2;
          const r = radius * 0.9;
          const a = angle + 0.23,
            b = angle - 0.23;
          graphics
            .moveTo(x + Math.cos(angle) * r * 0.45, y + Math.sin(angle) * r * 0.45)
            .quadraticCurveTo(
              x + Math.cos(a) * r * 1.3,
              y + Math.sin(a) * r * 1.3,
              x + Math.cos(angle) * r * 1.4,
              y + Math.sin(angle) * r * 1.4,
            )
            .quadraticCurveTo(
              x + Math.cos(b) * r * 1.3,
              y + Math.sin(b) * r * 1.3,
              x + Math.cos(angle) * r * 0.45,
              y + Math.sin(angle) * r * 0.45,
            )
            .fill({ color: burst.color, alpha: alpha * 0.42 });
        }
      } else if (burst.kind === 'absorb') {
        top
          .circle(x, y, radius * 1.45)
          .stroke({ color: burst.color, width: 8, alpha: alpha * 0.11 });
        top
          .circle(x, y, radius)
          .stroke({ color: this.lighten(burst.color, 0.5), width: 2.2, alpha: alpha * 0.9 });
      }
      return true;
    });
  }

  private drawStage() {
    this.overlay.clear();
    const age = this.clock - this.stageStart;
    const duration = VFX.stage.reveal + VFX.stage.hold + VFX.stage.handoff;
    if (age >= 0 && age <= duration) {
      const opacity =
        age < VFX.stage.reveal
          ? smooth(age / VFX.stage.reveal)
          : 1 - smooth((age - VFX.stage.reveal - VFX.stage.hold) / VFX.stage.handoff);
      const center = this.config.view.center;
      const radius = this.config.view.pixelsPerUnit * VFX.stage.scrimRadius;
      for (let i = 12; i >= 0; i--)
        this.overlay
          .circle(center.x, center.y, radius * (1 + i / 28))
          .fill({ color: 0x070710, alpha: (opacity * VFX.stage.scrimOpacity) / 18 });
      this.onStage?.(this.stageStem, age / duration);
    }
    const finishAge = this.clock - this.finish;
    if (this.finish >= 0 && finishAge >= 0) {
      this.overlay
        .rect(0, 0, this.config.view.width, this.config.view.height)
        .fill({ color: 0, alpha: clamp01(finishAge / 0.28) });
    }
  }

  private makeCelebration(time: number) {
    if (this.reducedMotion) return;
    const { width, height } = this.config.view;
    for (let i = 0; i < VFX.celebration.confettiCount; i++) {
      const seed = 810 + i;
      const left = i % 2 === 0;
      this.sparks.push({
        origin: { x: left ? width * 0.25 : width * 0.75, y: height * 0.95 },
        velocity: {
          x: (random01(seed) - (left ? 0.35 : 0.65)) * 400,
          y: -mix(380, 630, random01(seed + 99)),
        },
        time: time + random01(seed + 25) * 1.6,
        seconds: 4.3,
        color: this.palette[i % this.palette.length],
        size: mix(2, 5, random01(seed + 10)),
        stretch: 1.8,
        rotation: random01(seed + 70) * Math.PI * 2,
        kind: 'confetti',
      });
    }
    for (let i = 0; i < VFX.celebration.fireworksCount; i++) {
      const center = {
        x: width * mix(0.12, 0.88, random01(i + 901)),
        y: height * mix(0.08, 0.5, random01(i + 918)),
      };
      this.emitSparks(
        center,
        this.palette[i % this.palette.length],
        time + 0.8 + i * 0.4,
        24,
        250,
        0.9,
        'confetti',
      );
    }
  }

  private instrumentTarget(colorIndex: number): Vec2 {
    // Level 6 color lanes map red/green/blue/yellow to ukulele/violin/piano/drum.
    const view = this.config.view;
    const lane = this.colorTargets.get(colorIndex) ?? colorIndex;
    return { x: view.instrumentX[lane % view.instrumentX.length], y: view.instrumentY };
  }

  private ballColor(colorIndex: number, rendererIndex = 0): number {
    if (colorIndex !== 99) return this.palette[colorIndex] ?? this.palette[0];
    const rainbow = VFX.rainbow;
    const hue =
      (((this.clock * rainbow.cyclesPerSecond + rendererIndex * rainbow.rendererOffset) % 1) + 1) %
      1;
    const hsv = (offset: number) => {
      const phase = (hue * 6 + offset) % 6;
      return Math.round(
        rainbow.value * (1 - rainbow.saturation * Math.max(0, Math.min(phase, 4 - phase, 1))) * 255,
      );
    };
    return (hsv(5) << 16) | (hsv(3) << 8) | hsv(1);
  }

  private updateBackdrop() {
    const uniforms = this.backdrop.resources.backdrop.uniforms;
    uniforms.uTier = this.tier;
    uniforms.uSize[0] = this.config.view.width;
    uniforms.uSize[1] = this.config.view.height;
  }

  private drawClearPulse(model: NativeModel) {
    const mesh = this.clearPulse,
      cfg = VFX.shockwave;
    mesh.clear();
    if (this.reducedMotion) this.shocks.length = 0;
    this.shocks = this.shocks.filter((p) => this.clock - p.time < cfg.seconds);
    // The pulse stays in the shape's natural orientation, independent of board rotation.
    const coreWidth =
      model.level.lineThickness * this.config.view.pixelsPerUnit + VFX.field.shoulderPixels * 2;
    for (const pulse of this.shocks) {
      const age = clamp01((this.clock - pulse.time) / cfg.seconds);
      const radius = mix(cfg.startRadius, this.config.view.width * cfg.endRadiusFactor, age);
      const alpha = smooth(clamp01(age / cfg.attack)) * (1 - age) ** cfg.fadePower;
      for (let i = 0; i < pulse.outline.length; i++) {
        const point = pulse.outline[i],
          target = pulse.screen[i];
        target.x = this.config.view.center.x + point.x * radius;
        target.y = this.config.view.center.y + point.y * radius;
      }
      // Local ribbons shade only the expanding outline, not every pixel of the screen.
      mesh.stroke(
        pulse.screen,
        coreWidth + cfg.haloWidth,
        pulse.color,
        alpha * cfg.haloAlpha,
        true,
      );
      mesh.stroke(
        pulse.screen,
        coreWidth + cfg.glowWidth,
        pulse.color,
        alpha * cfg.glowAlpha,
        true,
      );
      mesh.stroke(
        pulse.screen,
        coreWidth,
        this.lighten(pulse.color, cfg.whiteness),
        alpha * cfg.coreAlpha,
        true,
      );
    }
    mesh.upload();
  }

  private shakeScene() {
    const offset = this.cameraImpulse.sample(this.clock, this.reducedMotion);
    this.scene.pivot.copyFrom(this.config.view.center);
    this.scene.position.set(
      this.config.view.center.x + offset.x,
      this.config.view.center.y + offset.y,
    );
    this.scene.rotation = 0;
    const intro = VFX.intro;
    const phase = clamp01(this.clock / (intro.seconds * intro.bloomPortion));
    const x1 = phase - 1;
    const bloom = 1 + (intro.backEase + 1) * x1 * x1 * x1 + intro.backEase * x1 * x1;
    this.scene.scale.set(this.introEnabled ? mix(intro.startScale, 1, bloom) : 1);
  }

  private introLayerAlpha(layer: number): number {
    if (!this.introEnabled || this.clock >= VFX.intro.seconds) return 1;
    const intro = VFX.intro;
    const reveal = clamp01(
      (this.clock / intro.seconds - intro.revealStart) / (intro.revealEnd - intro.revealStart),
    );
    const front =
      reveal * (Math.max(this.arenaRingCapacity, this.remainingRingCount) + intro.revealSoftness);
    return smooth((front - layer) / intro.revealSoftness);
  }

  private makeBallTexture(): Texture {
    const size = 128,
      canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#fff';
    context.beginPath();
    context.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
    context.fill();
    return Texture.from(canvas);
  }

  private makeClefTexture(): Texture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#fff';
    context.strokeStyle = '#fff';
    context.lineWidth = 11;
    context.beginPath();
    context.moveTo(40, 98);
    context.lineTo(40, 37);
    context.lineTo(98, 25);
    context.lineTo(98, 85);
    context.stroke();
    context.beginPath();
    context.ellipse(28, 99, 17, 12, -0.3, 0, Math.PI * 2);
    context.ellipse(86, 86, 17, 12, -0.3, 0, Math.PI * 2);
    context.fill();
    return Texture.from(canvas);
  }

  /** Stroke() copies coordinates immediately, so every path can share this scratch pool. */
  private toScreenPoints(points: Vec2[]): Vec2[] {
    const { center, pixelsPerUnit } = this.config.view;
    for (let i = 0; i < points.length; i++) {
      const point = this.screenPointPool[i] ?? (this.screenPointPool[i] = { x: 0, y: 0 });
      point.x = center.x + points[i].x * pixelsPerUnit;
      point.y = center.y + points[i].y * pixelsPerUnit;
      this.screenPoints[i] = point;
    }
    this.screenPoints.length = points.length;
    return this.screenPoints;
  }

  private close(points: Vec2[]): Vec2[] {
    const first = points[0],
      last = points[points.length - 1];
    if (first && last && Math.hypot(first.x - last.x, first.y - last.y) > 0.01) points.push(first);
    return points;
  }

  private lighten(color: number, amount: number): number {
    const red = Math.round(mix((color >> 16) & 255, 255, amount));
    const green = Math.round(mix((color >> 8) & 255, 255, amount));
    const blue = Math.round(mix(color & 255, 255, amount));
    return (red << 16) | (green << 8) | blue;
  }

  reset() {
    this.ballVisuals.forEach((v) => v.root.destroy({ children: true }));
    this.ballVisuals.clear();
    this.flights.forEach((f) => f.sprites.forEach((s) => s.destroy()));
    this.flights = [];
    this.lineShards = [];
    this.lastModel = undefined;
    this.sparks = [];
    this.bursts = [];
    this.shocks = [];
    this.flashes.clear();
    this.equalizerBars = [];
    this.equalizerCredits.clear();
    this.equalizerActivation.clear();
    this.equalizerBreaks.clear();
    this.equalizer.clear();
    this.cameraImpulse.reset();
    this.clock = this.tier = 0;
    this.stageStart = this.finish = -100;
  }

  destroy() {
    this.reset();
    if (this.initialized) {
      this.app.destroy(true, { children: true });
      this.initialized = false;
    }
    this.ballTexture?.destroy(true);
  }
}
