import type { Vec2 } from './types';
import { VFX, random01 } from './vfx';
// Three silhouettes from BeatBloomVfxDirector.Materials.CreateShardTexture.
// Store counter-clockwise outlines for the lightweight vector equivalent of the native atlas.
const GLASS_SHAPES = [
  [
    [0.05, -0.43],
    [0.1, 0.36],
    [0.96, -0.05],
  ],
  [
    [0.04, -0.21],
    [0.16, 0.31],
    [0.96, 0.04],
    [0.55, -0.19],
  ],
  [
    [0.04, -0.34],
    [0.13, 0.27],
    [0.68, 0.43],
    [0.96, -0.16],
    [0.43, -0.46],
  ],
].map((shape) => shape.reverse());
export interface LineShard {
  points: Vec2[];
  center: Vec2;
  velocity: Vec2;
  spin: number;
  time: number;
  seconds: number;
  width: number;
  color: number;
  facet: Vec2;
  tumble: number;
}
/** Small fragments sampled from the actual line contour. Rendering only; no collision bodies. */
export function makeLineShards(
  path: Vec2[],
  width: number,
  color: number,
  time: number,
  seed: number,
): LineShard[] {
  if (path.length < 2) return [];
  const cfg = VFX.shatter,
    count = Math.min(cfg.pieces, path.length - 1),
    shards: LineShard[] = [];
  // Unequal cuts are generated only on break. Convex glass outlines are cheap to
  // draw and triangulate, with no fragment textures, filters or physics bodies.
  const weights = Array.from(
    { length: count },
    (_, i) => cfg.minSize + random01(seed * 43 + i * 19) * cfg.sizeVariation,
  );
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const at = (fraction: number): Vec2 => {
    const t = Math.min(path.length - 1, Math.max(0, fraction * (path.length - 1)));
    const i = Math.min(path.length - 2, Math.floor(t));
    return {
      x: path[i].x + (path[i + 1].x - path[i].x) * (t - i),
      y: path[i].y + (path[i + 1].y - path[i].y) * (t - i),
    };
  };
  let cut = 0;
  for (let i = 0; i < count; i++) {
    const start = at(cut / total);
    cut += weights[i];
    const end = at(cut / total);
    const center = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length < 0.001) continue;
    const tx = (end.x - start.x) / length,
      ty = (end.y - start.y) / length;
    const r = (offset: number) => random01(seed * 31 + i * 17 + offset);
    const flakeLength = width * cfg.lengthInWidths * (1 + (r(5) - 0.5) * 2 * cfg.sizeSpread);
    const flakeWidth = flakeLength * cfg.aspect * (1 + (r(6) - 0.5) * 2 * cfg.sizeSpread);
    const outline = GLASS_SHAPES[Math.floor(r(7) * GLASS_SHAPES.length)];
    const points = outline.map(([x, y]) => {
      const along = (x - 0.5) * flakeLength,
        across = y * flakeWidth;
      return { x: along * tx - across * ty, y: along * ty + across * tx };
    });
    const facet = points.reduce(
      (center, p) => ({ x: center.x + p.x / points.length, y: center.y + p.y / points.length }),
      { x: 0, y: 0 },
    );
    shards.push({
      points,
      center,
      facet,
      tumble: cfg.tumbleMin + r(11) * cfg.tumbleVariation,
      velocity: { x: (r(1) - 0.5) * cfg.spread, y: -cfg.lift * (0.35 + r(2) * 0.65) },
      spin: (r(3) - 0.5) * cfg.spin,
      time,
      seconds: cfg.lifeMin + r(4) * (cfg.lifeMax - cfg.lifeMin),
      width,
      color,
    });
  }
  return shards;
}
export function shardPose(shard: LineShard, now: number) {
  const age = Math.max(0, now - shard.time),
    progress = age / shard.seconds,
    fade = Math.max(
      0,
      Math.min(1, (progress - VFX.shatter.fadeStart) / (1 - VFX.shatter.fadeStart)),
    );
  return {
    x: shard.center.x + shard.velocity.x * age,
    y: shard.center.y + shard.velocity.y * age + 0.5 * VFX.shatter.gravity * age * age,
    angle: shard.spin * age,
    face: Math.abs(Math.cos(age * shard.tumble)),
    scaleX: 0.35 + 0.65 * Math.abs(Math.cos(age * shard.tumble)),
    alpha: (1 - fade) ** 2,
    alive: progress < 1,
  };
}
