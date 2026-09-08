import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeModel } from '../src/native/model';
import { normalizePlayableQueue } from '../src/native/queue';
import { cloneLevel } from '../src/native/config';

for (const count of [3, 10])
  test(`${count} rings continue shifting inward through the final ring`, () => {
    const level = cloneLevel();
    level.rings = Array.from({ length: count }, () => [0, 1, 2]);
    const model = new NativeModel(normalizePlayableQueue(level));
    for (let index = 0; index < count - 1; index++) {
      const previous = model.compression;
      for (const segment of model.rings[index].segments)
        (model as any).breakSegment(
          segment,
          { id: 100, color: segment.color, power: 3 },
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          1,
        );
      assert.equal(model.compression, previous, 'clearing does not teleport rings');
      for (let frame = 0; frame < 240; frame++) model.step(1 / 120);
      assert.equal(model.compression, index + 1);
      const next = model.rings[index + 1];
      assert.equal(next.layoutLayer, 0);
      assert.equal(next.radius, level.innerRadius);
      assert.equal(next.eligible, true);
      const expectedLayout =
        Math.min(level.arenaRingCapacity - 1, count - 1 - model.compression) +
        model.config.field.wallMarginSpacings;
      const expected = (model as any).cachedRingPath(expectedLayout);
      const actualRadius = Math.max(...model.wallPoints.map((p) => Math.hypot(p.x, p.y)));
      assert.ok(
        Math.abs(
          actualRadius -
            Math.max(...expected.map((p: { x: number; y: number }) => Math.hypot(p.x, p.y))),
        ) < 1e-8,
        'wall follows the outermost remaining ring with its configured gap',
      );
    }
  });
