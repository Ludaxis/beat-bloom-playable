import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeContour,
  offsetContour,
  segmentPath,
  pointInsidePolygon,
} from '../src/native/geometry';
import { DEFAULT_NATIVE_LEVEL } from '../src/native/config';
import type { NativeShape, Vec2 } from '../src/native/types';

const shapes: NativeShape[] = [
  'hexagon',
  'heart',
  'flower',
  'ring',
  'triangle',
  'square',
  'pentagon',
  'heptagon',
];
function cross(a: Vec2, b: Vec2, c: Vec2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}
function intersects(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  return cross(a, b, c) * cross(a, b, d) < -1e-10 && cross(c, d, a) * cross(c, d, b) < -1e-10;
}
function assertSimple(points: Vec2[], label: string): void {
  for (const point of points)
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y), label + ' has invalid point');
  for (let i = 0; i < points.length; i++)
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue;
      assert.ok(
        !intersects(
          points[i],
          points[(i + 1) % points.length],
          points[j],
          points[(j + 1) % points.length],
        ),
        `${label}: contour crosses at edges ${i},${j}`,
      );
    }
  assert.equal(
    pointInsidePolygon({ x: 0, y: 0 }, points),
    true,
    `${label} must contain the launch center`,
  );
}

for (const shape of shapes)
  test(`editable ${shape} geometry remains finite, nested and free of crossed outlines`, () => {
    const contour = makeContour(shape, 5);
    let previous: Vec2[] | undefined;
    for (const ring of [0, 1, 5]) {
      const path = offsetContour(
        contour,
        DEFAULT_NATIVE_LEVEL.innerRadius,
        DEFAULT_NATIVE_LEVEL.lineSpacing * ring,
      );
      assertSimple(path, `${shape} ring ${ring}`);
      if (previous)
        for (const point of previous)
          assert.equal(
            pointInsidePolygon(point, path),
            true,
            `${shape}: outside line must enclose inside line`,
          );
      previous = path;
    }
  });

test('segment paths join continuously under moving color phase; authored gaps remain configurable', () => {
  const points = offsetContour(makeContour('hexagon'), DEFAULT_NATIVE_LEVEL.innerRadius, 0);
  for (const phase of [0, 0.249, 0.999, 1.04]) {
    const segments = Array.from({ length: 12 }, (_, i) => segmentPath(points, i, 12, phase, 0.71));
    for (let i = 0; i < 12; i++) {
      const a = segments[i].at(-1)!,
        b = segments[(i + 1) % 12][0];
      assert.ok(
        Math.hypot(a.x - b.x, a.y - b.y) < 1e-10,
        'zero-gap adjacent pieces must meet without a hidden collider crack',
      );
    }
  }
  const a = segmentPath(points, 0, 12, 0.2, 0, 18, 0.08).at(-1)!;
  const b = segmentPath(points, 1, 12, 0.2, 0, 18, 0.08)[0];
  assert.ok(
    Math.hypot(a.x - b.x, a.y - b.y) > 0.02,
    'an authored positive gap must survive path generation',
  );
});
