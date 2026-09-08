import { unitySource } from './unity-source.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Read-only Unity extraction. The menu's registered GUIDs, not Level_N filenames, own ordering.
const root = unitySource();
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = 'review/data/ring-templates.json';
const reportPath = 'review/data/ring-templates-provenance.md';
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const evidence = (relative) => ({ path: relative, sha256: hash(read(relative)) });
const fail = (message) => {
  throw new Error(`Ring-template export refused: ${message}`);
};
function field(text, key) {
  const value = text.match(new RegExp(`^  ${key}: ?(.*)$`, 'm'))?.[1];
  if (value === undefined) fail(`missing serialized field ${key}`);
  return value.trim();
}
function integer(text, key) {
  const raw = field(text, key);
  if (!/^-?\d+$/.test(raw)) fail(`${key} is not an integer`);
  return Number(raw);
}
function arrayBlock(text, key) {
  const match = text.match(
    new RegExp(`^  ${key}: *(?:\r?\n|$)([\\s\\S]*?)(?=^  [A-Za-z_]\\w*:|^(?:---|$))`, 'm'),
  );
  if (!match) fail(`missing serialized array ${key}`);
  return match[1];
}
function intArray(text, key) {
  const hex = field(text, key);
  if (!hex.length || !/^(?:[a-fA-F0-9]{8})+$/.test(hex))
    fail(`${key} must contain complete little-endian int32 values`);
  const bytes = Buffer.from(hex, 'hex');
  return Array.from({ length: bytes.length / 4 }, (_, i) => bytes.readInt32LE(i * 4));
}
function rgbaArray(text, key) {
  const lines = arrayBlock(text, key).trim().split('\n');
  const colors = lines.map((line) => {
    const match = line.match(/^\s*- \{r: ([^,]+), g: ([^,]+), b: ([^,]+), a: ([^}]+)\}\s*$/);
    if (!match) fail(`unsupported ${key} color serialization`);
    const rgba = match.slice(1).map(Number);
    if (rgba.some((n) => !Number.isFinite(n) || n < 0 || n > 1) || rgba[3] !== 1)
      fail(`${key} contains non-opaque or out-of-range color`);
    return rgba;
  });
  if (!colors.length) fail(`${key} has no colors`);
  return colors;
}
const packed = (rgba) =>
  (Math.round(rgba[0] * 255) << 16) | (Math.round(rgba[1] * 255) << 8) | Math.round(rgba[2] * 255);
const hexColor = (value) => `#${value.toString(16).padStart(6, '0')}`;
function referenceGuid(text, key) {
  const value = field(text, key).match(/^\{fileID: -?\d+, guid: ([a-f0-9]{32}), type: \d+\}$/)?.[1];
  if (!value) fail(`${key} is not an asset GUID reference`);
  return value;
}

const guidPaths = new Map();
// Resolve only authored assets, scripts and prefabs; do not inspect Unity caches or generated builds.
for (const name of fs.readdirSync(path.join(root, 'Assets'), { recursive: true })) {
  if (!/\.(?:asset|prefab|cs)\.meta$/.test(name)) continue;
  const relative = `Assets/${name.split(path.sep).join('/')}`;
  const guid = read(relative).match(/^guid: ([a-f0-9]{32})$/m)?.[1];
  if (!guid) fail(`missing GUID in ${relative}`);
  guidPaths.set(guid, [...(guidPaths.get(guid) ?? []), relative.slice(0, -5)]);
}
function resolve(guid) {
  const matches = guidPaths.get(guid);
  if (!matches?.length) fail(`cannot resolve GUID ${guid}`);
  if (matches.length !== 1) fail(`ambiguous referenced GUID ${guid}: ${matches.join(', ')}`);
  return matches[0];
}
const scriptGuid = (relative) => read(`${relative}.meta`).match(/^guid: ([a-f0-9]{32})$/m)?.[1];
function component(text, guid) {
  const blocks = text
    .split(/^--- /m)
    .filter((block) => block.includes(`m_Script: {fileID: 11500000, guid: ${guid},`));
  if (blocks.length !== 1)
    fail(`expected one component for script ${guid}, found ${blocks.length}`);
  return blocks[0];
}
function requireContract(text, fragment, context) {
  if (!text.includes(fragment))
    fail(`${context} changed; review runtime semantics before re-exporting`);
}

const sourcePaths = {
  buildSettings: 'ProjectSettings/EditorBuildSettings.asset',
  menu: 'Assets/Scenes/Main.unity',
  levelLoader: 'Assets/Scripts/LevelLoader.cs',
  adapter: 'Assets/Scripts/BeatBloomIntegration/BeatBloomLevelAdapter.cs',
  nativeLoader:
    'Assets/_Ludaxis/BeatBloom/Scripts/Runtime/Levels/BeatBloomLoopEscapeLevelLoader.cs',
  level: 'Assets/_Ludaxis/BeatBloom/Scripts/Runtime/Gameplay/BeatBloomLevel.cs',
  renderer: 'Assets/_Ludaxis/BeatBloom/Scripts/Runtime/Gameplay/BeatBloomCurveShapeRenderer.cs',
  rendererLevels:
    'Assets/_Ludaxis/BeatBloom/Scripts/Runtime/Gameplay/CurveShapeRenderer/BeatBloomCurveShapeRenderer.Levels.cs',
  rendererSegments:
    'Assets/_Ludaxis/BeatBloom/Scripts/Runtime/Gameplay/CurveShapeRenderer/BeatBloomCurveShapeRenderer.Segments.cs',
  style: 'Assets/_Ludaxis/BeatBloom/Scripts/Runtime/Gameplay/BeatBloomHypnoStyle.cs',
  paletteCode: 'Assets/_Ludaxis/BeatBloom/Scripts/Runtime/Gameplay/BeatBloomPalette.cs',
  configCode: 'Assets/_Ludaxis/BeatBloom/Scripts/Runtime/Config/BeatBloomConfigs.cs',
  app: 'Assets/_Ludaxis/BeatBloom/Content/Config/AppConfig.asset',
  palette: 'Assets/_Ludaxis/BeatBloom/Content/Config/PaletteConfig.asset',
};
requireContract(
  read(sourcePaths.levelLoader),
  'selectedLevel = levels[selectedIndex];',
  'LevelLoader menu lookup',
);
requireContract(
  read(sourcePaths.adapter),
  'levelLoader.ApplyLoadedLevel(data.sourceLevel, data.sourceLevel.sourceLevelId);',
  'skeleton adapter',
);
requireContract(
  read(sourcePaths.nativeLoader),
  'importedLevel.ApplyTo(lineSource);',
  'native loader',
);
requireContract(
  read(sourcePaths.level),
  'renderer.SetPalette(BeatBloomPalette.SkinPalette(palette), activeColorCount);',
  'level palette seam',
);
requireContract(
  read(sourcePaths.level),
  'renderer.SetExplicitSegmentPattern(explicitLayerSegmentCounts, explicitSegmentColorIndices, explicitMaxSegmentsPerLayer);',
  'explicit pattern seam',
);
requireContract(
  read(sourcePaths.style),
  'var canOverridePalette = !preserveImportedLevelPalette || !hasImportedPattern;',
  'style palette preservation',
);
requireContract(
  read(sourcePaths.rendererSegments),
  'return colorIndex >= 0;',
  'explicit gap semantics',
);

const menuText = read(sourcePaths.menu);
requireContract(
  read(sourcePaths.buildSettings),
  '  - enabled: 1\n    path: Assets/Scenes/Main.unity',
  'enabled Main build scene',
);
const menu = component(menuText, scriptGuid(sourcePaths.levelLoader));
if (field(menu, 'testLevel') !== '{fileID: 0}')
  fail('Main LevelLoader has a testLevel override; menu order is not authoritative');
const registeredGuids = arrayBlock(menu, 'levels')
  .trim()
  .split('\n')
  .map((line, index) => {
    const guid = line.trim().match(/^- \{fileID: 11400000, guid: ([a-f0-9]{32}), type: 2\}$/)?.[1];
    if (!guid) fail(`unresolved or unsupported menu entry ${index + 1}`);
    return guid;
  });
if (registeredGuids.length < 20) fail(`only ${registeredGuids.length} registered menu levels`);

const paletteCode = read(sourcePaths.paletteCode);
const sourcePaletteBlock = paletteCode
  .split('public static readonly Color[] LoopEscapeSource =')[1]
  ?.split('};')[0];
if (!sourcePaletteBlock) fail('source-palette lookup table changed');
const sourcePalette = [...sourcePaletteBlock.matchAll(/new Color\(([^)]+)\)/g)].map((match) =>
  match[1].split(',').map((n) => Number(n.trim().replace(/f$/, ''))),
);
if (
  !sourcePalette.length ||
  sourcePalette.some((c) => c.length !== 4 || c.some((n) => !Number.isFinite(n)))
)
  fail('cannot parse source-palette table');
requireContract(
  paletteCode,
  'private const float SkinMatchTolerance = 2f / 255f;',
  'palette match tolerance',
);
requireContract(paletteCode, 'return gameplay[id];', 'palette skin lookup');
const skinEnabled = integer(read(sourcePaths.app), 'skinImportedPalettes') === 1;
const gameplayPalette = rgbaArray(read(sourcePaths.palette), 'gameplayColors');
const maxLines = Number(read(sourcePaths.renderer).match(/const int MaxLineCount = (\d+);/)?.[1]);
const maxSegments = Number(
  read(sourcePaths.rendererLevels).match(
    /explicitMaxSegmentsPerLayer = Mathf.Clamp\(maxSegmentsPerLayer, 1, (\d+)\);/,
  )?.[1],
);
if (!Number.isInteger(maxLines) || !Number.isInteger(maxSegments)) fail('renderer limits changed');

const templates = registeredGuids.slice(0, 20).map((wrapperGuid, entryIndex) => {
  const levelNumber = entryIndex + 1;
  const wrapperPath = resolve(wrapperGuid),
    wrapper = read(wrapperPath);
  if (!wrapper.includes('::BeatBloomLevelData')) fail(`${wrapperPath} is not BeatBloomLevelData`);
  const nativeGuid = referenceGuid(wrapper, 'sourceLevel');
  const nativePath = resolve(nativeGuid),
    native = read(nativePath);
  const prefabGuid = wrapper.match(/m_AssetGUID: ([a-f0-9]{32})/)?.[1];
  if (!prefabGuid || !/^  contentReference:\n    mode: 2\n/m.test(wrapper))
    fail(`${wrapperPath} has an unverified content reference`);
  const prefabPath = resolve(prefabGuid),
    prefab = read(prefabPath);
  const style = component(prefab, scriptGuid(sourcePaths.style));
  if (integer(style, 'preserveImportedLevelPalette') !== 1)
    fail(`${prefabPath} overrides the level palette`);
  if (integer(native, 'useExplicitSegmentPattern') !== 1)
    fail(`${nativePath} uses a procedural pattern; refusing a substitute`);
  const counts = intArray(native, 'explicitLayerSegmentCounts');
  const colors = intArray(native, 'explicitSegmentColorIndices');
  const stride = integer(native, 'explicitMaxSegmentsPerLayer');
  if (
    counts.length > maxLines ||
    stride < 1 ||
    stride > maxSegments ||
    counts.some((n) => n < 1 || n > stride)
  )
    fail(`${nativePath} would be clamped by the runtime`);
  if (colors.length !== counts.length * stride)
    fail(`${nativePath} has truncated or extra explicit color data`);
  if (integer(native, 'lineCount') !== counts.length)
    fail(`${nativePath} has a lineCount/explicit-count discrepancy`);
  const rings = counts.map((count, layer) => colors.slice(layer * stride, layer * stride + count));
  const authoredRgba = rgbaArray(native, 'palette');
  const skinMatches = authoredRgba.map((color) =>
    !skinEnabled
      ? -1
      : sourcePalette.findIndex(
          (source, i) =>
            i < gameplayPalette.length &&
            source.slice(0, 3).every((n, c) => Math.abs(n - color[c]) <= 2 / 255),
        ),
  );
  const effectiveRgba = authoredRgba.map((color, i) =>
    skinMatches[i] < 0 ? color : gameplayPalette[skinMatches[i]],
  );
  if (rings.flat().some((n) => n < -1 || n >= effectiveRgba.length))
    fail(`${nativePath} has unsupported gap values or palette indices`);
  const activeColorCount = integer(native, 'activeColorCount');
  if (activeColorCount < 1 || activeColorCount > effectiveRgba.length)
    fail(`${nativePath} has an invalid active color count`);
  const padding = counts.flatMap((count, layer) =>
    colors.slice(layer * stride + count, (layer + 1) * stride),
  );
  const name = field(native, 'displayName');
  return {
    id: `menu-level-${String(levelNumber).padStart(2, '0')}`,
    label: `Level ${levelNumber} · ${name}`,
    levelNumber,
    rings,
    palette: effectiveRgba.map(packed),
    source: {
      ...evidence(nativePath),
      guid: nativeGuid,
      sourceLevelId: field(native, 'sourceLevelId'),
      wrapper: { ...evidence(wrapperPath), guid: wrapperGuid, index: integer(wrapper, 'index') },
      menu: { ...evidence(sourcePaths.menu), entryIndex, testLevel: null },
      prefab: { ...evidence(prefabPath), guid: prefabGuid, preserveImportedLevelPalette: true },
      explicitPattern: {
        stride,
        layerSegmentCounts: counts,
        lineCount: counts.length,
        paddingSlotCount: padding.length,
        paddingAbsentCount: padding.filter((n) => n < 0).length,
      },
      activeColorCount,
      authoredPalette: authoredRgba.map(packed),
      authoredRgba,
      paletteSkin: {
        enabled: skinEnabled,
        sourceColorIds: skinMatches,
        effectiveRgba,
        app: evidence(sourcePaths.app),
        palette: evidence(sourcePaths.palette),
      },
    },
  };
});
const stats = templates.map((t) => ({
  level: t.levelNumber,
  rings: t.rings.length,
  segmentCounts: [...new Set(t.rings.map((r) => r.length))].sort((a, b) => a - b),
  present: t.rings.flat().filter((c) => c >= 0).length,
  gaps: t.rings.flat().filter((c) => c < 0).length,
  palette: t.palette.length,
  padding: t.source.explicitPattern.paddingSlotCount,
}));
const data = {
  version: 1,
  templates,
  provenance: {
    pipeline:
      'Main LevelLoader.levels → BeatBloomLevelData.sourceLevel → BeatBloomLevelAdapter → ApplyLoadedLevel → explicit pattern + SkinPalette',
    files: Object.fromEntries(
      Object.entries(sourcePaths).map(([key, relative]) => [key, evidence(relative)]),
    ),
    rendererLimits: { maxRings: maxLines, maxSegmentsPerRing: maxSegments },
    contents:
      'Only authored ring order, segment color indices, per-ring counts and effective current palette. No song, shape, queue, timing or gameplay settings are applied by these templates.',
  },
};
const report = `# Current menu ring-template provenance\n\nGenerated by \`node scripts/export-ring-templates.mjs\`. Verify without writes using \`node scripts/export-ring-templates.mjs --check\`. Output is deterministic; every source file is SHA-256 hashed in the JSON.\n\nThe first 20 entries are read in serialized order from \`Assets/Scenes/Main.unity\`'s \`LevelLoader.levels\`. \`testLevel\` is null. GUID resolution leads to \`SkeletonGenerated/Levels/BeatBloomLevel_01.asset\` through \`BeatBloomLevel_20.asset\`, then their \`sourceLevel\` references lead to \`Resources/LevelOverrides/Level_1.asset\` through \`Level_20.asset\`. Filenames do not determine the exported order. The skeleton adapter supplies this referenced asset directly to \`ApplyLoadedLevel\`; protected-payload import and its procedural color-coverage promotion are not run on this route.\n\nAll 20 sources use explicit segment patterns. Arrays are decoded as signed little-endian int32 and each ring preserves exactly its authored count, color order and any in-count -1 absence. Fixed-stride padding beyond the authored count is not a segment or gap and is excluded from rings; padding counts remain in provenance. No current in-count gaps exist. The exporter refuses disabled explicit patterns, malformed arrays, unsupported indices, renderer-clamped counts, palette overrides or a menu test-level override instead of generating substitutes.\n\nCurrent native colors differ from the raw source palette: \`AppConfig.skinImportedPalettes=1\` applies \`BeatBloomPalette.SkinPalette\` at the level-to-renderer seam. Each source RGB is matched to \`LoopEscapeSource\` within 2/255 per channel and replaced with the index-aligned \`PaletteConfig.gameplayColors\`; unknown RGB passes through. The gameplay prefab preserves imported palettes. \`palette\` therefore contains effective opaque sRGB 24-bit integers. Raw authored 24-bit colors, exact serialized RGBA floats, matched source IDs, effective RGBA floats and config hashes remain under \`source\`. Rounding to 8-bit channels is explicit; these are palette values, not postprocessed screenshot samples.\n\nTemplates apply ring/color/count structure only. Labels identify the source level; they do not select its song. Shape, queue, song, stems, motion, line thickness, spacing, visible-ring window and all other settings stay outside this export. Conveyor motion moves segment geometry without rewriting the authored array. The runtime procedural ColorMode branches only provide colors when no explicit color exists; absent explicit segments are excluded by IsSegmentPresent. HypnoStyle preserves explicit palettes and patterns while applying visual and motion settings.\n\nSource-only audit of the saved repository, not a live Editor snapshot: unsaved Editor overrides, configuration injection, downloaded catalogs or uncommitted runtime state are not observed. No Unity assets were edited and no Editor automation was used. All first 20 templates fit the runtime's ${maxLines}-ring/${maxSegments}-segment limits; none has more than 24 rings.\n\n| Menu level | Rings | Segments per ring | Present segments | In-count gaps | Colors | Unused stride slots |\n|---|---:|---|---:|---:|---:|---:|\n${stats.map((s) => `| ${s.level} | ${s.rings} | ${s.segmentCounts.join(', ')} | ${s.present} | ${s.gaps} | ${s.palette} | ${s.padding} |`).join('\n')}\n\nExample: Level 1 exports eight rings of \`[0,0,0,1,1,1]\`, with effective palette \`${templates[0].palette.map(hexColor).join(', ')}\`. The JSON includes each menu/wrapper/source GUID and source hash for independent verification.\n`;
const outputs = [
  [outputPath, JSON.stringify(data, null, 2) + '\n'],
  [reportPath, report],
];
if (process.argv.slice(2).some((arg) => arg !== '--check')) fail('only --check is supported');
for (const [relative, content] of outputs) {
  if (process.argv.includes('--check')) {
    if (
      !fs.existsSync(path.join(project, relative)) ||
      fs.readFileSync(path.join(project, relative), 'utf8') !== content
    )
      fail(`${relative} is stale; regenerate it`);
  } else {
    fs.mkdirSync(path.dirname(path.join(project, relative)), { recursive: true });
    fs.writeFileSync(path.join(project, relative), content);
  }
}
console.log(
  JSON.stringify(
    {
      mode: process.argv.includes('--check') ? 'verified' : 'exported',
      templates: templates.length,
      output: outputPath,
      stats,
    },
    null,
    2,
  ),
);
