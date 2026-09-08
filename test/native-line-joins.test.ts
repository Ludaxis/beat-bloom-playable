import test from 'node:test';
import assert from 'node:assert/strict';
import { RibbonMesh } from '../src/native/render';
import { makeContour, offsetContour, heartHalfPhase, segmentPath } from '../src/native/geometry';

test('adjacent heart colors share both stroke edges at the notch and tip', () => {
  for (const offset of [0, 0.4, 1.2, 2.4])
    for (const rotation of [0, 1.3, 3.4]) {
      const contour = offsetContour(makeContour('heart', 5, 0.2), 5.1, offset);
      const phase = heartHalfPhase(contour);
      const paths = [0, 1].map((i) => segmentPath(contour, i, 2, phase, rotation));
      const meshes = paths.map((points, i) => {
        const other = paths[1 - i];
        const mesh = Object.assign(Object.create(RibbonMesh.prototype), {
          positions: [],
          uvs: [],
          rgba: [],
          indices: [],
        });
        mesh.stroke(points, 0.2, i ? 0xff0000 : 0x0000ff, 1, false, false, 1, undefined, [
          other.at(-2)!,
          other[1],
        ]);
        return mesh;
      });
      for (const i of [0, 1]) {
        const end = (meshes[i] as any).positions.slice(-4);
        const start = (meshes[1 - i] as any).positions.slice(0, 4);
        end.forEach((n: number, j: number) =>
          assert.ok(Math.abs(n - start[j]) < 1e-8, 'both colors meet on the same cross-section'),
        );
      }
    }
});
