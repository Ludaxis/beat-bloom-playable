import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import {
  DEFAULT_NATIVE_LEVEL,
  NATIVE_CONFIG,
  cloneLevel,
  screenToWorld,
  worldToScreen,
} from '../src/native/config';

// Source fidelity is an optional integration check, not a standalone-clone dependency.
const unity = process.env.BEAT_BLOOM_UNITY_PROJECT;
const sourceFile = (path: string) => (unity ? readFileSync(resolve(unity, path), 'utf8') : '');
const content = 'Assets/_Ludaxis/BeatBloom/';
const sourceText = sourceFile(content + 'Resources/LevelOverrides/Level_6.asset');
const fieldText = sourceFile(content + 'Content/Config/FieldConfig.asset');
const ballText = sourceFile(content + 'Content/Config/BallConfig.asset');
const chartText = sourceFile(content + 'Resources/Songs/kissmemore/Chart.asset');
const physicsText = sourceFile('ProjectSettings/Physics2DSettings.asset');
const sourceOnly = { skip: !unity && 'Set BEAT_BLOOM_UNITY_PROJECT for the Unity source audit.' };

function scalar(source: string, key: string): number {
  const match = source.match(new RegExp(`^  ${key}: ([-+0-9.eE]+)$`, 'm'));
  assert.ok(match, `Missing independently parsed native field ${key}`);
  return Number(match[1]);
}
function packed(source: string, key: string): number[] {
  const match = source.match(new RegExp(`^  ${key}: ([a-f0-9]+)$`, 'm'));
  assert.ok(match, `Missing native packed field ${key}`);
  const bytes = Buffer.from(match[1], 'hex');
  assert.equal(bytes.length % 4, 0);
  return Array.from({ length: bytes.length / 4 }, (_, i) => bytes.readInt32LE(i * 4));
}

test(
  'default web level contains the exact native authored segment pattern and queue',
  sourceOnly,
  () => {
    const counts = packed(sourceText, 'explicitLayerSegmentCounts');
    const colors = packed(sourceText, 'explicitSegmentColorIndices');
    const stride = scalar(sourceText, 'explicitMaxSegmentsPerLayer');
    const rings = counts.map((count, i) => colors.slice(i * stride, i * stride + count));
    assert.equal(rings.length, 12);
    assert.equal(rings.flat().length, 96);
    assert.deepEqual(DEFAULT_NATIVE_LEVEL.rings, rings);
    const queue = [
      ...sourceText.matchAll(/  - colorIndex: (\d+)\n    power: (\d+)\n    mystery: ([01])/g),
    ].map((m) => ({ color: +m[1], power: +m[2], mystery: m[3] === '1' }));
    assert.equal(queue.length, 31);
    assert.equal(
      queue.reduce((sum, ball) => sum + ball.power, 0),
      96,
    );
    assert.deepEqual(DEFAULT_NATIVE_LEVEL.queue, queue);
    for (let color = 0; color < 4; color++) {
      assert.equal(
        queue.filter((b) => b.color === color).reduce((n, b) => n + b.power, 0),
        rings.flat().filter((c) => c === color).length,
        `Color ${color} must conserve authored segment power`,
      );
    }
    assert.equal(DEFAULT_NATIVE_LEVEL.queueColumns, scalar(sourceText, 'queueColumnCount'));
    assert.equal(DEFAULT_NATIVE_LEVEL.activeCapacity, scalar(sourceText, 'activeCenterCapacity'));
    assert.equal(DEFAULT_NATIVE_LEVEL.trayCapacity, scalar(sourceText, 'unlockedSlots'));
    assert.equal(DEFAULT_NATIVE_LEVEL.shape, 'hexagon');
    assert.equal(DEFAULT_NATIVE_LEVEL.songId, 'kissmemore');
    assert.equal(DEFAULT_NATIVE_LEVEL.levelNumber, 6);
    assert.equal(
      DEFAULT_NATIVE_LEVEL.source?.levelSha256,
      createHash('sha256').update(sourceText).digest('hex'),
    );
  },
);

test(
  'web geometry and physics carry native resolved settings rather than the rejected ad tuning',
  sourceOnly,
  () => {
    assert.equal(
      DEFAULT_NATIVE_LEVEL.innerRadius,
      scalar(sourceText, 'innerRadius') + scalar(fieldText, 'innerRadiusBoost'),
    );
    assert.equal(
      DEFAULT_NATIVE_LEVEL.lineSpacing,
      scalar(sourceText, 'lineSpacing') * scalar(fieldText, 'lineSpacingMultiplier'),
    );
    assert.equal(DEFAULT_NATIVE_LEVEL.lineThickness, scalar(fieldText, 'lineThickness'));
    const projectGravity = Number(physicsText.match(/m_Gravity: \{x: [^,]+, y: ([-.\d]+)\}/)?.[1]);
    assert.ok(
      Number.isFinite(projectGravity),
      'Project gravity must be read, never assumed from Unity defaults',
    );
    assert.equal(
      NATIVE_CONFIG.physics.gravity,
      -projectGravity * scalar(ballText, 'physicsGravityScale'),
    );
    assert.equal(NATIVE_CONFIG.physics.launchSpeed, scalar(ballText, 'physicsLaunchSpeed'));
    assert.equal(NATIVE_CONFIG.physics.maxSpeed, scalar(ballText, 'maxSpeed'));
    assert.equal(NATIVE_CONFIG.physics.breakCooldown, scalar(ballText, 'breakCooldown'));
    assert.equal(
      NATIVE_CONFIG.physics.collisionRadiusRatio,
      scalar(ballText, 'physicsBallRadiusScale') * 2,
    );
    assert.equal(
      DEFAULT_NATIVE_LEVEL.arenaRingCapacity,
      6,
      'Measured opening reference has six colored rings',
    );
  },
);

test('music chart uses the native tempo, offset and section changes', sourceOnly, () => {
  assert.equal(DEFAULT_NATIVE_LEVEL.bpm, scalar(chartText, 'bpm'));
  assert.equal(
    DEFAULT_NATIVE_LEVEL.downbeatOffset,
    scalar(chartText, 'firstDownbeatOffsetSeconds'),
  );
  assert.equal(DEFAULT_NATIVE_LEVEL.beatsPerBar, scalar(chartText, 'beatsPerBar'));
  const sections = [
    ...chartText.matchAll(
      /  - startBeat: ([\d.]+)\n    intensity01: ([\d.]+)\n    rollDirection: (-?\d+)\n    degreesPerBeat: ([\d.]+)/g,
    ),
  ].map((m) => ({ startBeat: +m[1], intensity: +m[2], direction: +m[3], degreesPerBeat: +m[4] }));
  assert.equal(sections.length, 16);
  assert.deepEqual(DEFAULT_NATIVE_LEVEL.sections, sections);
});

test('configuration edits cannot mutate the default level and screen/world input mapping round-trips', () => {
  const original = JSON.stringify(DEFAULT_NATIVE_LEVEL);
  const edit = cloneLevel();
  edit.palette[0] = 0x123456;
  edit.queue[0].power = 99;
  edit.rings[0][0] = 2;
  assert.equal(JSON.stringify(DEFAULT_NATIVE_LEVEL), original);
  for (const p of [
    { x: 288, y: 512 },
    { x: 212, y: 992 },
    { x: 134, y: 895 },
    { x: 0, y: 0 },
    { x: 576, y: 1280 },
  ]) {
    const roundTrip = worldToScreen(screenToWorld(p));
    assert.ok(Math.abs(roundTrip.x - p.x) < 1e-9);
    assert.ok(Math.abs(roundTrip.y - p.y) < 1e-9);
  }
});
