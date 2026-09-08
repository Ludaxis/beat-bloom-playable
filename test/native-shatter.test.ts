import test from 'node:test';
import assert from 'node:assert/strict';
import { makeLineShards, shardPose } from '../src/native/shatter';
import { VFX } from '../src/native/vfx';
test('glass fragments preserve source color/thickness and leave geometry untouched', () => {
  const path = Array.from({ length: 30 }, (_, i) => ({ x: i * 4, y: Math.sin(i / 7) * 20 })),
    before = JSON.stringify(path);
  const shards = makeLineShards(path, 8, 0xff3366, 10, 42);
  assert.equal(shards.length, VFX.shatter.pieces);
  assert.equal(JSON.stringify(path), before);
  for (const shard of shards) {
    assert.equal(shard.width, 8);
    assert.equal(shard.color, 0xff3366);
    assert.ok(shard.points.length >= 3 && shard.points.length <= 5);
    assert.equal(shardPose(shard, 10).alpha, 1);
    assert.equal(shardPose(shard, 11).alive, false);
    assert.equal(shardPose(shard, 11).alpha, 0);
    assert.ok(shardPose(shard, 10.6).y > shard.center.y);
  }
  assert.deepEqual(makeLineShards(path, 8, 0xff3366, 10, 42), shards);
});
test('absolute-time trajectories are frame-rate independent and degenerate paths are skipped', () => {
  assert.deepEqual(makeLineShards([], 1, 0, 0, 0), []);
  const s = makeLineShards(
    [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ],
    4,
    0,
    0,
    0,
  )[0];
  const pose = shardPose(s, 0.4);
  for (let i = 0; i < 24; i++) shardPose(s, i / 60);
  assert.deepEqual(shardPose(s, 0.4), pose);
});

test('glass cuts vary in size and remain convex, finite and bounded', () => {
  const path = [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 40, y: 0 },
    { x: 60, y: 0 },
    { x: 80, y: 0 },
    { x: 100, y: 0 },
    { x: 120, y: 0 },
    { x: 140, y: 0 },
  ];
  for (let seed = 0; seed < 100; seed++) {
    const shards = makeLineShards(path, 8, 0xff3366, 0, seed);
    assert.ok(shards.length <= VFX.shatter.pieces);
    const areas = shards.map((shard) => {
      const points = shard.points;
      let area = 0;
      for (let i = 0; i < points.length; i++) {
        const a = points[i],
          b = points[(i + 1) % points.length],
          c = points[(i + 2) % points.length];
        assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y));
        assert.ok((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) > 0, 'convex cut');
        area += a.x * b.y - b.x * a.y;
      }
      assert.ok(shardPose(shard, 0.3).scaleX >= 0.35);
      return area / 2;
    });
    assert.ok(Math.max(...areas) > Math.min(...areas) * 1.5, 'mixed fragment sizes');
  }
  assert.deepEqual(
    makeLineShards(
      [
        { x: 1, y: 1 },
        { x: 1, y: 1 },
      ],
      8,
      0,
      0,
      0,
    ),
    [],
  );
});
