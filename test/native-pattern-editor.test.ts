import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cloneLevel } from '../src/native/config';
import { NativeModel, validateNativeLevel } from '../src/native/model';
import { setLayerCount, colorDemand } from '../src/native/level-editor';
import {
  generatePattern,
  applyRingTemplate,
  inferPattern,
  verifyPlayableLevel,
  type PatternOptions,
  type SolvabilityResult,
} from '../src/native/pattern-editor';
import type { NativeLevel } from '../src/native/types';

function continuousRecipe(recipe: PatternOptions): PatternOptions {
  const total = (recipe.shift * 360) / recipe.segmentsPerRing + (recipe.shiftDegrees ?? 0);
  const angle = ((((total + 180) % 360) + 360) % 360) - 180;
  return { ...recipe, shift: 0, shiftDegrees: angle === -180 && total > 0 ? 180 : angle };
}

function assertConservation(level: NativeLevel): void {
  assert.deepEqual(validateNativeLevel(level), []);
  assert.deepEqual(
    colorDemand(level.rings, level.palette.length).map((pieces) => Math.ceil(pieces / 3) * 3),
    level.palette.map((_, color) =>
      level.queue.filter((b) => b.color === color).reduce((sum, b) => sum + b.power, 0),
    ),
  );
  assert.ok(level.queue.every((b) => b.mystery === false && b.power === 3));
  assert.ok(
    level.stemLanes.every((l) => l.colors.every((c) => c >= 0 && c < level.palette.length)),
  );
  const mapped = new Set(level.stemLanes.flatMap((l) => l.colors));
  assert.ok(
    level.rings
      .flat()
      .filter((c) => c >= 0)
      .every((c) => mapped.has(c)),
    'each playable color must contribute to an existing voice',
  );
}
function replay(level: NativeLevel, receipt: SolvabilityResult): void {
  const model = new NativeModel(level),
    broken = new Set<number>();
  let next = 0,
    wins = 0;
  for (let step = 0; step < receipt.steps; step++) {
    while (receipt.inputs[next]?.step === step) {
      const input = receipt.inputs[next++];
      assert.equal(
        input.type === 'queue' ? model.fireQueue(input.index) : model.fireTray(input.index),
        true,
        'recorded ordinary input must be accepted',
      );
    }
    model.step(receipt.fixedStep);
    for (const event of model.drainEvents()) {
      if (event.type === 'break') {
        assert.ok(!broken.has(event.segmentId!));
        broken.add(event.segmentId!);
      }
      if (event.type === 'win') wins++;
      assert.notEqual(event.type, 'booster');
    }
  }
  assert.equal(next, receipt.inputs.length);
  assert.equal(wins, 1);
  assert.equal(model.status, 'won');
  assert.equal(model.remaining, 0);
  assert.equal(broken.size, level.rings.flat().filter((c) => c >= 0).length);
  assert.equal(
    model.queueBalls().reduce((sum, b) => sum + b.power, 0) +
      model.balls.reduce((sum, b) => sum + b.power, 0),
    0,
  );
}

for (const options of [
  { colorCount: 1, segmentsPerRing: 1, colorsPerRing: 1, shift: 0 },
  { colorCount: 3, segmentsPerRing: 7, colorsPerRing: 3, shift: 2 },
  { colorCount: 12, segmentsPerRing: 24, colorsPerRing: 12, shift: -1 },
  { colorCount: 12, segmentsPerRing: 1, colorsPerRing: 1, shift: 999999 },
])
  test(`generator conserves ammo and exposes all ${options.colorCount} requested colors (${options.segmentsPerRing} segments)`, () => {
    const source = cloneLevel(),
      before = cloneLevel(source),
      level = generatePattern(source, options);
    assertConservation(level);
    assert.deepEqual(source, before);
    assert.deepEqual(level, generatePattern(source, options));
    assert.equal(level.rings.length, source.rings.length);
    assert.equal(level.palette.length, options.colorCount);
    assert.equal(new Set(level.rings.flat()).size, options.colorCount);
    assert.ok(
      level.rings.every(
        (r) => r.length === options.segmentsPerRing && new Set(r).size === options.colorsPerRing,
      ),
    );
    assert.deepEqual(
      level.stemLanes.map((l) => l.stem),
      source.stemLanes
        .filter((l) => l.colors.some((color) => color < options.colorCount))
        .map((l) => l.stem),
    );
    assert.deepEqual(
      level.palette.slice(0, Math.min(source.palette.length, options.colorCount)),
      source.palette.slice(0, options.colorCount),
    );
    assert.deepEqual(level.pattern, options);
    assert.deepEqual(inferPattern(level), continuousRecipe(options));
  });

test('shift rotates ring slots while uneven groups retain balanced demand', () => {
  const recipe = { colorCount: 3, segmentsPerRing: 7, colorsPerRing: 3, shift: 0 };
  const base = generatePattern(cloneLevel(), recipe),
    shifted = generatePattern(cloneLevel(), { ...recipe, shift: 2 });
  assert.deepEqual(colorDemand(base.rings, 3), colorDemand(shifted.rings, 3));
  for (let ring = 0; ring < base.rings.length; ring++)
    for (let slot = 0; slot < 7; slot++)
      assert.equal(shifted.rings[ring][(slot + ring * 2) % 7], base.rings[ring][slot]);
  assert.deepEqual(colorDemand([base.rings[0]], 3), [3, 2, 2]);
});

test('ordinary swatch edits retain the authored pattern and queue', () => {
  const level = generatePattern(cloneLevel(), {
      colorCount: 6,
      segmentsPerRing: 12,
      colorsPerRing: 3,
      shift: 1,
    }),
    before = cloneLevel(level);
  level.palette[2] = 0xff33aa;
  assert.deepEqual(level.rings, before.rings);
  assert.deepEqual(level.queue, before.queue);
  assert.deepEqual(inferPattern(level), continuousRecipe(before.pattern!));
});

test('passing through one-segment rings cannot change the final generated or template queue', () => {
  const source = setLayerCount(cloneLevel(), 8),
    recipe = { colorCount: 4, segmentsPerRing: 12, colorsPerRing: 4, shift: 1 };
  const direct = generatePattern(source, recipe);
  const interim = generatePattern(source, { ...recipe, segmentsPerRing: 1, colorsPerRing: 1 });
  assert.equal(interim.queue.length, 4);
  assert.ok(interim.queue.every((ball) => ball.power === 3));
  const viaSmallRings = generatePattern(interim, recipe);
  assert.deepEqual(viaSmallRings.rings, direct.rings);
  assert.deepEqual(viaSmallRings.palette, direct.palette);
  assert.deepEqual(viaSmallRings.queue, direct.queue);
  assert.equal(viaSmallRings.queue.length, 32);
  assert.ok(viaSmallRings.queue.every((ball) => ball.power === 3));
  const template = { rings: direct.rings, palette: direct.palette };
  assert.deepEqual(
    applyRingTemplate(interim, template).queue,
    applyRingTemplate(source, template).queue,
  );
});

test('invalid generator combinations and templates fail without rewriting source', () => {
  const level = setLayerCount(cloneLevel(), 1),
    before = cloneLevel(level),
    valid = { colorCount: 3, segmentsPerRing: 7, colorsPerRing: 3, shift: 0 };
  for (const options of [
    { ...valid, colorCount: 13 },
    { ...valid, segmentsPerRing: 25 },
    { ...valid, colorsPerRing: 8 },
    { ...valid, colorCount: 4, colorsPerRing: 3 },
    { ...valid, shift: NaN },
    { ...valid, shift: 1.5 },
  ])
    assert.throws(() => generatePattern(level, options), RangeError);
  for (const template of [
    { rings: [], palette: [1] },
    { rings: [[0, 1]], palette: [1] },
    { rings: [[-1, -1]], palette: [1] },
    { rings: [[0]], palette: [-1] },
  ])
    assert.throws(() => applyRingTemplate(level, template), RangeError);
  assert.deepEqual(level, before);
});

test('applying a template preserves exact order, gaps and palette while retaining song and physical tuning', () => {
  const source = generatePattern(cloneLevel(), {
      colorCount: 4,
      segmentsPerRing: 12,
      colorsPerRing: 2,
      shift: 1,
    }),
    before = cloneLevel(source);
  source.shape = 'heart';
  source.lineThickness = 0.2;
  source.motion.speedMultiplier = 0.6;
  const template = {
      rings: [
        [1, -1, 0, 1, 0, 1],
        [0, 0, -1, 1, 0, 1],
      ],
      palette: [0xa833dd, 0x22bbcc],
    },
    saved = JSON.parse(JSON.stringify(template));
  const level = applyRingTemplate(source, template);
  assertConservation(level);
  assert.deepEqual(level.rings, template.rings);
  assert.deepEqual(level.palette, template.palette);
  assert.equal(level.rings.length, 2);
  for (const field of [
    'songId',
    'shape',
    'lineThickness',
    'lineSpacing',
    'motion',
    'bpm',
    'sections',
    'flowerPetals',
  ] as const)
    assert.deepEqual(level[field], source[field]);
  assert.equal(level.pattern, undefined);
  assert.deepEqual(template, saved);
  assert.deepEqual(source.queue, before.queue);
  assert.ok(level.arenaRingCapacity <= 2);
  assert.ok(level.maxRenderedRings <= 2);
  assert.ok(level.previewRingCount <= 2 - level.arenaRingCapacity);
});

test('first twenty source templates preserve exact rings/palette and valid per-color ammo', () => {
  const data = JSON.parse(
    readFileSync(new URL('../review/data/ring-templates.json', import.meta.url), 'utf8'),
  );
  assert.equal(data.templates.length, 20);
  for (const template of data.templates) {
    const level = applyRingTemplate(cloneLevel(), template);
    assertConservation(level);
    assert.deepEqual(level.rings, template.rings);
    assert.deepEqual(level.palette, template.palette);
  }
});

test('recipe inference rejects stale metadata and a layer resize never leaves a misleading recipe', () => {
  const recipe = { colorCount: 3, segmentsPerRing: 7, colorsPerRing: 3, shift: 1 },
    generated = generatePattern(cloneLevel(), recipe);
  const withoutMetadata = cloneLevel(generated);
  delete withoutMetadata.pattern;
  assert.deepEqual(inferPattern(withoutMetadata), continuousRecipe(recipe));
  const changed = cloneLevel(generated);
  changed.pattern = { ...recipe, segmentsPerRing: 9 };
  assert.deepEqual(inferPattern(changed), continuousRecipe(recipe));
  const resized = setLayerCount(generated, 13);
  assert.equal(resized.pattern, undefined);
  const invalid = cloneLevel(generated);
  invalid.pattern = { ...recipe, shift: NaN };
  assert.deepEqual(inferPattern(invalid), continuousRecipe(recipe));
});

for (const [count, options] of [
  [1, { colorCount: 1, segmentsPerRing: 1, colorsPerRing: 1, shift: 0 }],
  [4, { colorCount: 3, segmentsPerRing: 7, colorsPerRing: 3, shift: 1 }],
  [2, { colorCount: 12, segmentsPerRing: 24, colorsPerRing: 12, shift: 1 }],
] as [number, PatternOptions][])
  test(`ordinary-input receipt replays to a win for ${count} rings / ${options.colorCount} colors`, () => {
    const level = generatePattern(setLayerCount(cloneLevel(), count), options),
      before = cloneLevel(level),
      progress: number[] = [];
    const receipt = verifyPlayableLevel(level, {
      maxWallTimeMs: 30_000,
      maxSimulationSeconds: 480,
      onProgress: (p) => progress.push(p.remaining),
    });
    assert.equal(receipt.status, 'verified-win', JSON.stringify(receipt.summaries));
    assert.equal(receipt.remaining, 0);
    assert.ok(progress.length >= 2);
    assert.deepEqual(level, before);
    replay(level, receipt);
  });

test('bounded checker never calls balanced ammo a verified win when its computation is incomplete', () => {
  const level = generatePattern(cloneLevel(), {
      colorCount: 12,
      segmentsPerRing: 24,
      colorsPerRing: 12,
      shift: 1,
    }),
    before = cloneLevel(level);
  const simulation = verifyPlayableLevel(level, {
    maxSimulationSeconds: 0.001,
    maxAttempts: 1,
    maxWallTimeMs: 30_000,
  });
  assert.equal(simulation.status, 'not-verified');
  assert.ok(simulation.remaining > 0);
  assert.equal(simulation.steps, 1);
  const wall = verifyPlayableLevel(level, { maxWallTimeMs: 1 });
  assert.equal(wall.status, 'not-verified');
  assert.match(wall.reason, /time budget/);
  assert.deepEqual(level, before);
  for (const opts of [{ maxWallTimeMs: 0 }, { maxAttempts: 0 }, { maxSimulationSeconds: Infinity }])
    assert.throws(() => verifyPlayableLevel(level, opts), RangeError);
});

test('a generated 24-layer puzzle completes with twelve visible rings and a replayable receipt', () => {
  const base = setLayerCount(cloneLevel(), 24);
  base.arenaRingCapacity = 12;
  base.maxRenderedRings = 12;
  base.previewRingCount = 0;
  const level = generatePattern(base, {
    colorCount: 1,
    segmentsPerRing: 1,
    colorsPerRing: 1,
    shift: 0,
  });
  const receipt = verifyPlayableLevel(level, { maxWallTimeMs: 30_000, maxSimulationSeconds: 480 });
  assert.equal(receipt.status, 'verified-win', JSON.stringify(receipt.summaries));
  assert.equal(level.queue.length, 8);
  assert.ok(receipt.inputs.length >= 8, 'each 3-power ball enters through an ordinary input');
  replay(level, receipt);
});
