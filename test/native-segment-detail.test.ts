import test from 'node:test';
import assert from 'node:assert/strict';
import {
  closestPoint,
  distance,
  makeContour,
  offsetContour,
  pointAtArc,
  rotate,
  segmentPath,
} from '../src/native/geometry';

test('three equal hexagon colors preserve both rounded corners in every piece', () => {
  for (const offset of [0, 0.4, 2.4]) {
    const contour = offsetContour(makeContour('hexagon'), 2.8, offset);
    const pieces = Array.from({ length: 3 }, (_, i) => segmentPath(contour, i, 3, 0, 0));
    for (let piece = 0; piece < 3; piece++) {
      // Six corners occur half a side-period after the side-centered contour origin.
      for (const local of [20, 60]) {
        const corner = contour[piece * 80 + local];
        const error = Math.min(
          ...pieces[piece]
            .slice(1)
            .map((p, i) => distance(corner, closestPoint(corner, pieces[piece][i], p))),
        );
        assert.ok(error < 1e-10, `piece${piece} discarded a rounded corner at offset${offset}`);
      }
      const rotated = pieces[0].map((p) => rotate(p, (-piece * Math.PI * 2) / 3));
      assert.ok(
        pieces[piece].every((p, i) => distance(p, rotated[i]) < 1e-10),
        'each color owns the same two-corner shape',
      );
    }
  }
});

test('detail does not change moving-contact index correspondence at phase wraps', () => {
  const contour = offsetContour(makeContour('hexagon'), 2.8, 1.2);
  for (const count of [1, 2, 3, 6, 12, 24]) {
    const previous = segmentPath(contour, 0, count, 0.99999, 0.7);
    const current = segmentPath(contour, 0, count, 1.00001, 0.7);
    assert.equal(previous.length, current.length);
    assert.ok(
      current.length - 1 >= contour.length / count,
      'low piece counts retain full contour density',
    );
    assert.ok(
      current.length - 1 <= Math.max(18, Math.ceil(contour.length / count)),
      'detail remains bounded',
    );
    current.forEach((p, i) =>
      assert.ok(
        distance(p, previous[i]) < 0.001,
        'neighboring frames must pair neighboring material points',
      ),
    );
  }
});

test('curved shapes retain precise piece endpoints, rotation and authored gaps', () => {
  for (const shape of ['hexagon', 'heart', 'flower', 'ring'] as const) {
    const contour = offsetContour(makeContour(shape), 2.8, 0.4);
    for (const phase of [-0.01, 0, 0.17, 0.99999, 1.02]) {
      const gap = 0.08,
        rotation = 0.53,
        count = 3;
      for (let index = 0; index < count; index++) {
        const p = segmentPath(contour, index, count, phase, rotation, 18, gap);
        const start = rotate(pointAtArc(contour, (index + gap / 2) / count + phase), rotation);
        const end = rotate(pointAtArc(contour, (index + 1 - gap / 2) / count + phase), rotation);
        assert.ok(distance(p[0], start) < 1e-10);
        assert.ok(distance(p.at(-1)!, end) < 1e-10);
      }
    }
  }
});
