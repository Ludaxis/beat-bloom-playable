import type { NativeShape as Shape } from './types';
export interface Point {
  x: number;
  y: number;
}
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export function resample(source: Point[], count = 240): Point[] {
  const cx = source.reduce((s, p) => s + p.x, 0) / source.length;
  const cy = source.reduce((s, p) => s + p.y, 0) / source.length;
  const radius = Math.max(...source.map((p) => Math.hypot(p.x - cx, p.y - cy)));
  const lengths = [0];
  source.forEach((p, i) => lengths.push(lengths[i] + distance(p, source[(i + 1) % source.length])));
  let cursor = 0;
  return Array.from({ length: count }, (_, i) => {
    const target = (i / count) * lengths[source.length];
    while (cursor < source.length - 1 && lengths[cursor + 1] < target) cursor++;
    const t = (target - lengths[cursor]) / (lengths[cursor + 1] - lengths[cursor] || 1);
    const a = source[cursor],
      b = source[(cursor + 1) % source.length];
    // The current Unity contours use +Y up. Canvas uses +Y down.
    return { x: (lerp(a.x, b.x, t) - cx) / radius, y: -(lerp(a.y, b.y, t) - cy) / radius };
  });
}
// Ports the current September 2026 HeartContour and FlowerContour authoring, not the old ring capture.
export function makeContour(shape: Shape, petals = 5, roundness = 0): Point[] {
  const p: Point[] = [];
  if (shape === 'ring') {
    for (let i = 0; i < 720; i++) {
      const a = (i / 720) * Math.PI * 2;
      p.push({ x: Math.cos(a), y: Math.sin(a) });
    }
  } else if (shape !== 'flower' && shape !== 'heart') {
    const n = ({ triangle: 3, square: 4, pentagon: 5, hexagon: 6, heptagon: 7 } as const)[shape];
    const fillet = ({ 3: 0.16, 4: 0.14, 5: 0.13, 6: 0.12, 7: 0.11 } as Record<number, number>)[n];
    const half = Math.PI / n,
      centre = 1 - fillet,
      apothem = centre * Math.cos(half) + fillet;
    const tangent = Math.atan2(centre * Math.sin(half), apothem);
    for (let i = 0; i < 720; i++) {
      const a = (i / 720) * Math.PI * 2;
      const phi = Math.abs(((((a - Math.PI / 2) % (half * 2)) + half * 2) % (half * 2)) - half);
      const psi = half - phi,
        s = centre * Math.sin(psi);
      const r =
        phi <= tangent
          ? apothem / Math.cos(phi)
          : centre * Math.cos(psi) + Math.sqrt(Math.max(0, fillet * fillet - s * s));
      p.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
  } else if (shape === 'flower') {
    for (let i = 0; i < 360; i++) {
      const a = (i / 360) * Math.PI * 2;
      const u = 0.5 * (1 + Math.cos(petals * (a - Math.PI / 2)));
      const amplitude = Math.max(0.12, Math.min(0.32, 0.26 * Math.sqrt(5 / petals)));
      const r = 1 - amplitude + amplitude * (1 - Math.pow(1 - u, 1.5));
      p.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
  } else {
    const r = 0.52,
      cx = 0.46,
      cy = 0.3,
      tipY = -1.02;
    const dist = Math.hypot(cx, cy - tipY);
    const tangent = Math.atan2(cy - tipY, cx) - Math.asin(r / dist);
    const len = Math.sqrt(dist * dist - r * r);
    const right = { x: Math.cos(tangent) * len, y: tipY + Math.sin(tangent) * len };
    const a0 = Math.atan2(right.y - cy, right.x - cx);
    const cleft = cy + Math.sqrt(r * r - cx * cx);
    const a1 = Math.atan2(cleft - cy, -cx);
    for (let i = 0; i <= 140; i++) {
      const a = lerp(a0, a1, i / 140);
      p.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
    for (let i = 1; i <= 140; i++) {
      const a = lerp(Math.PI - a1, Math.PI - a0, i / 140);
      p.push({ x: -cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
    const left = { x: -right.x, y: right.y };
    const sideLen = Math.hypot(right.x, right.y - tipY);
    const start = { x: (left.x / sideLen) * 0.1, y: tipY + ((left.y - tipY) / sideLen) * 0.1 };
    const end = { x: -start.x, y: start.y };
    for (let i = 1; i < 60; i++)
      p.push({ x: lerp(left.x, start.x, i / 60), y: lerp(left.y, start.y, i / 60) });
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      p.push({
        x: lerp(lerp(start.x, 0, t), lerp(0, end.x, t), t),
        y: lerp(lerp(start.y, tipY, t), lerp(tipY, end.y, t), t),
      });
    }
    for (let i = 1; i < 60; i++)
      p.push({ x: lerp(end.x, right.x, i / 60), y: lerp(end.y, right.y, i / 60) });
  }
  return resample(p).map((q) => {
    const length = Math.hypot(q.x, q.y);
    const r = lerp(length, 1, Math.max(0, Math.min(1, roundness)));
    return { x: (q.x * r) / length, y: (q.y * r) / length };
  });
}
export function closestPoint(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)),
  );
  return { x: a.x + t * dx, y: a.y + t * dy };
}
export function rotate(p: Point, angle: number, scale = 1): Point {
  return {
    x: (p.x * Math.cos(angle) - p.y * Math.sin(angle)) * scale,
    y: (p.x * Math.sin(angle) + p.y * Math.cos(angle)) * scale,
  };
}
/** Conservative edge bounds avoid allocating a closest point for every offset/edge pair.
 * Only nearby edges need the exact projection; equality remains outside the rejection radius.
 */
function withinSegmentDistance(
  p: Point,
  a: Point,
  b: Point,
  radius: number,
  radiusSquared: number,
): boolean {
  if (
    p.x < Math.min(a.x, b.x) - radius ||
    p.x > Math.max(a.x, b.x) + radius ||
    p.y < Math.min(a.y, b.y) - radius ||
    p.y > Math.max(a.y, b.y) + radius
  )
    return false;
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)),
  );
  const x = p.x - (a.x + t * dx),
    y = p.y - (a.y + t * dy);
  return x * x + y * y < radiusSquared;
}
// Contours are immutable. Reuse edge groups across the many offsets sampled during compression.
const offsetSources = new WeakMap<
  Point[],
  {
    base: Point[];
    groups: {
      start: number;
      end: number;
      minX: number;
      minY: number;
      maxX: number;
      maxY: number;
    }[];
  }
>();
function offsetSource(points: Point[]) {
  let source = offsetSources.get(points);
  if (source) return source;
  const base = sampleClosed(points, 720),
    groups = [];
  for (let start = 0; start < base.length; start += 16) {
    const end = Math.min(start + 16, base.length);
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (let j = start; j <= end; j++) {
      const p = base[j % base.length];
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    groups.push({ start, end, minX, minY, maxX, maxY });
  }
  source = { base, groups };
  offsetSources.set(points, source);
  return source;
}
export function offsetContour(points: Point[], radius: number, offset: number): Point[] {
  // Current Unity algorithm: parallel normals, swallowtail rejection, branch intersection,
  // then equal arc-length sampling. A plain miter offset crosses itself at concave notches.
  const { base, groups } = offsetSource(points),
    n = base.length,
    d = offset / radius;
  const raw = base.map((p, i) => {
    let tx = 0,
      ty = 0;
    for (let k = 1; k <= 4; k++) {
      tx += base[(i + k) % n].x - base[(i - k + n) % n].x;
      ty += base[(i + k) % n].y - base[(i - k + n) % n].y;
    }
    const length = Math.hypot(tx, ty) || 1,
      sign = ty * p.x - tx * p.y < 0 ? -1 : 1;
    return { x: p.x + ((sign * ty) / length) * d, y: p.y - ((sign * tx) / length) * d };
  });
  const tolerance = 0.002 + d * 0.004;
  const minimumDistance = d - tolerance;
  const minimumDistanceSquared = minimumDistance * minimumDistance;
  const alive = raw.map((p, i) => {
    if (d <= tolerance) return true;
    for (const group of groups) {
      if (
        p.x < group.minX - minimumDistance ||
        p.x > group.maxX + minimumDistance ||
        p.y < group.minY - minimumDistance ||
        p.y > group.maxY + minimumDistance
      )
        continue;
      for (let j = group.start; j < group.end; j++) {
        const separation = Math.abs(i - j);
        if (separation <= 2 || separation >= n - 2) continue;
        if (
          withinSegmentDistance(
            p,
            base[j],
            base[(j + 1) % n],
            minimumDistance,
            minimumDistanceSquared,
          )
        )
          return false;
      }
    }
    return true;
  });
  if (!alive.some(Boolean)) throw new Error('Invalid contour offset');
  for (let i = 0; i < n; i++) {
    if (alive[i]) continue;
    let before = (i - 1 + n) % n,
      after = (i + 1) % n;
    while (!alive[before]) before = (before - 1 + n) % n;
    while (!alive[after]) after = (after + 1) % n;
    const p = raw[before],
      q = raw[after],
      prev = raw[(before - 1 + n) % n],
      next = raw[(after + 1) % n];
    const r = { x: p.x - prev.x, y: p.y - prev.y },
      s = { x: q.x - next.x, y: q.y - next.y };
    const denominator = r.x * s.y - r.y * s.x;
    let apex = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    if (alive[(before - 1 + n) % n] && alive[(after + 1) % n] && Math.abs(denominator) > 1e-9) {
      const t = ((q.x - p.x) * s.y - (q.y - p.y) * s.x) / denominator;
      const u = ((q.x - p.x) * r.y - (q.y - p.y) * r.x) / denominator;
      if (t >= 0 && u >= 0 && t <= 12 && u <= 12) apex = { x: p.x + r.x * t, y: p.y + r.y * t };
    }
    raw[i] = apex;
  }
  return sampleClosed(raw, points.length).map((p) => ({ x: p.x * radius, y: p.y * radius }));
}

export function sampleClosed(points: Point[], count: number): Point[] {
  const lengths = [0];
  points.forEach((p, i) => lengths.push(lengths[i] + distance(p, points[(i + 1) % points.length])));
  let cursor = 0;
  return Array.from({ length: count }, (_, i) => {
    const target = (i / count) * lengths[points.length];
    while (cursor < points.length - 1 && lengths[cursor + 1] < target) cursor++;
    const t = (target - lengths[cursor]) / (lengths[cursor + 1] - lengths[cursor] || 1);
    const a = points[cursor],
      b = points[(cursor + 1) % points.length];
    return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
  });
}

export function pointAtArc(points: Point[], u: number): Point {
  const t = (((u % 1) + 1) % 1) * points.length,
    i = Math.floor(t),
    f = t - i;
  const a = points[i],
    b = points[(i + 1) % points.length];
  return { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f) };
}
const heartHalfPhases = new WeakMap<Point[], number>();
/** Start a stationary two-part heart at its lower symmetry-axis crossing. */
export function heartHalfPhase(points: Point[]): number {
  const cached = heartHalfPhases.get(points);
  if (cached !== undefined) return cached;
  let phase = 0,
    lowest = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    if ((a.x <= 0 && b.x >= 0) || (a.x >= 0 && b.x <= 0)) {
      const t = a.x === b.x ? 0 : -a.x / (b.x - a.x);
      const y = lerp(a.y, b.y, t);
      if (y > lowest) {
        lowest = y;
        phase = (i + t) / points.length;
      }
    }
  }
  heartHalfPhases.set(points, phase);
  return phase;
}
export function segmentPath(
  points: Point[],
  index: number,
  count: number,
  conveyor: number,
  rotation: number,
  samples = 18,
  gap = 0,
): Point[] {
  // A long color piece must retain the contour's detail: three pieces need 80 steps each
  // on a 240-point contour, rather than turning its rounded corners into 54 coarse chords.
  // Keep the count and parameter correspondence fixed as the conveyor moves. Removing
  // collinear vertices per frame would pair unrelated edges in the moving-contact solver.
  const steps = Math.max(1, Math.ceil(samples), Math.ceil(points.length / count));
  return Array.from({ length: steps + 1 }, (_, i) =>
    rotate(
      pointAtArc(points, (index + gap * 0.5 + ((1 - gap) * i) / steps) / count + conveyor),
      rotation,
    ),
  );
}
export function pointInsidePolygon(p: Point, points: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i],
      b = points[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
export function normalize(v: Point, fallback: Point = { x: 0, y: -1 }): Point {
  const d = Math.hypot(v.x, v.y);
  return d > 1e-8 ? { x: v.x / d, y: v.y / d } : fallback;
}
export function smoothstep(t: number): number {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
}
export function smootherstep(t: number): number {
  t = clamp(t, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}
