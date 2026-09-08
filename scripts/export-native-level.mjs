import { unitySource } from './unity-source.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = unitySource();
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requested = process.argv[2] || '6';
const number = Number(requested);
if (!Number.isInteger(number) || number < 1 || number > 1000)
  throw Error('Expected native level number');
const relative = `Assets/_Ludaxis/BeatBloom/Resources/LevelOverrides/Level_${number}.asset`;
const source = fs.readFileSync(path.join(root, relative), 'utf8');
const fieldPath = 'Assets/_Ludaxis/BeatBloom/Content/Config/FieldConfig.asset';
const field = fs.readFileSync(path.join(root, fieldPath), 'utf8');
function scalar(text, key, fallback) {
  const match = text.match(new RegExp(`^  ${key}: (.*)$`, 'm'));
  return match ? match[1].trim() : fallback;
}
function num(text, key, fallback = 0) {
  return Number(scalar(text, key, fallback));
}
function ints(hex) {
  const b = Buffer.from(hex, 'hex');
  return Array.from({ length: b.length / 4 }, (_, i) => b.readInt32LE(i * 4));
}
const counts = ints(scalar(source, 'explicitLayerSegmentCounts', ''));
const colors = ints(scalar(source, 'explicitSegmentColorIndices', ''));
const stride = num(source, 'explicitMaxSegmentsPerLayer');
if (!counts.length || !stride)
  throw Error(
    'This exporter requires an authored explicit pattern, never generates substitute rings.',
  );
const rings = counts.map((count, i) => colors.slice(i * stride, i * stride + count));
const paletteBlock = source.split('  palette:\n')[1]?.split('  colorWeights:')[0] || '';
const palette = [
  ...paletteBlock.matchAll(/\{r: ([^,]+), g: ([^,]+), b: ([^,]+), a: ([^}]+)\}/g),
].map(
  (m) => (Math.round(+m[1] * 255) << 16) | (Math.round(+m[2] * 255) << 8) | Math.round(+m[3] * 255),
);
const queueBlock = source.split('  queue:\n')[1]?.split('  queueColumnCount:')[0] || '';
if (/linkGroup: [1-9]|corePower: [1-9]/.test(queueBlock))
  throw Error(
    'Linked and duet balls are not supported by the current web serializer. Refusing loss of authored rules.',
  );
const queue = [
  ...queueBlock.matchAll(/- colorIndex: (\d+)\n    power: (\d+)\n    mystery: (\d+)/g),
].map((m) => ({ color: +m[1], power: +m[2], mystery: !!+m[3] }));
const laneBlock =
  source.split('  colorStemLanes:\n')[1]?.split('  allowIndependentColorStemOrder:')[0] || '';
const stemLanes = [
  ...laneBlock.matchAll(
    /- stemIndex: (\d+)\n    colorIndices: ([a-f0-9]+)\n    requiredBreaks: (\d+)/g,
  ),
].map((m) => ({ stem: +m[1], colors: ints(m[2]), requiredBreaks: +m[3] }));
const songId = scalar(source, 'songId', '');
const chart = fs.readFileSync(
  path.join(root, `Assets/_Ludaxis/BeatBloom/Resources/Songs/${songId}/Chart.asset`),
  'utf8',
);
const sections = [
  ...chart.matchAll(
    /- startBeat: ([\d.]+)\n    intensity01: ([\d.]+)\n    rollDirection: (-?\d+)\n    degreesPerBeat: ([\d.]+)/g,
  ),
].map((m) => ({ startBeat: +m[1], intensity: +m[2], direction: +m[3], degreesPerBeat: +m[4] }));
const shapeNames = {
  0: 'triangle',
  1: 'ring',
  2: 'flower',
  3: 'heart',
  4: 'pentagon',
  5: 'hexagon',
  8: 'square',
  19: 'heptagon',
  20: 'flower',
};
// Native enum has Heart=3; require explicit mapping instead of assuming a visual replacement.
const shape = shapeNames[num(source, 'shape')];
if (!shape) throw Error('Unsupported shape enum');
const level = {
  schemaVersion: 1,
  id: `native-${number}`,
  name: scalar(source, 'displayName'),
  levelNumber: number,
  songId,
  shape,
  flowerPetals: num(field, 'flowerPetals', 5),
  roundness: num(field, 'shapeRoundness'),
  palette,
  innerRadius: num(source, 'innerRadius') + num(field, 'innerRadiusBoost'),
  lineSpacing: num(source, 'lineSpacing') * num(field, 'lineSpacingMultiplier', 1),
  lineThickness: num(field, 'lineThickness'),
  segmentGap: num(field, 'segmentGap'),
  arenaRingCapacity: num(field, 'arenaReachableRingCount', 6),
  previewRingCount: num(field, 'outerPreviewRingCount', 2),
  maxRenderedRings: num(source, 'maxRenderedLines', 10),
  rings,
  queue,
  queueColumns: num(source, 'queueColumnCount'),
  activeCapacity: num(source, 'activeCenterCapacity'),
  trayCapacity: num(source, 'unlockedSlots'),
  stemLanes,
  bpm: num(chart, 'bpm'),
  beatsPerBar: num(chart, 'beatsPerBar', 4),
  loopBeats: Number(chart.match(/    loopBeats: ([\d.]+)/)?.[1] || 64),
  downbeatOffset: num(chart, 'firstDownbeatOffsetSeconds'),
  sections,
  motion: {
    phaseDegrees: 56,
    degreesPerBeat: 12,
    speedMultiplier: num(field, 'continuousRollSpeedMultiplier', 2),
    flipEaseBeats: 1,
    conveyorBeatsPerSlot: num(source, 'colorConveyorBeatsPerSlot'),
    conveyorAlternate: !!num(source, 'colorConveyorAlternate'),
    conveyorHoldFigure: !!num(source, 'colorConveyorHoldFigure'),
    conveyorPulseEveryBeats: num(source, 'colorConveyorPulseEveryBeats'),
    conveyorPulseDurationBeats: num(source, 'colorConveyorPulseDurationBeats'),
    conveyorPulseSpeedBoost: num(source, 'colorConveyorPulseSpeedBoost'),
  },
  source: {
    level: relative,
    levelSha256: crypto.createHash('sha256').update(source).digest('hex'),
    field: fieldPath,
    exportedAt: new Date().toISOString(),
  },
};
const demand = palette.map((_, color) => rings.flat().filter((c) => c === color).length);
const supply = palette.map((_, color) =>
  queue.filter((q) => q.color === color).reduce((s, q) => s + q.power, 0),
);
if (demand.some((d, i) => d !== supply[i]))
  throw Error(`Authored power conservation mismatch demand=${demand}, supply=${supply}`);
const out = path.join(project, `src/native/data/level-${number}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(level, null, 2) + '\n');
console.log(
  JSON.stringify({
    out,
    rings: rings.length,
    segments: rings.flat().filter((c) => c >= 0).length,
    queue: queue.length,
    power: supply.reduce((s, n) => s + n, 0),
    demand,
    supply,
  }),
);
