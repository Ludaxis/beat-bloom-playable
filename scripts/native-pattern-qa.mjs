import { unitySource } from './unity-source.mjs';
import { chromium } from 'playwright';
import { register } from 'tsx/esm/api';
register();
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const origin = process.env.BEAT_BLOOM_QA_ORIGIN || 'http://127.0.0.1:4178',
  out = resolve(process.env.BEAT_BLOOM_QA_OUTPUT || 'qa/native/latest/patterns'),
  repo = unitySource(process.argv.includes('--source-only'));
await mkdir(out, { recursive: true });
const report = {
  date: new Date().toISOString(),
  method:
    'Independent Unity source decode, actual studio controls and downloads, public-input model win replay. Balance alone is not a solvability result.',
  cases: [],
  errors: [],
};
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const templates = JSON.parse(await readFile('review/data/ring-templates.json', 'utf8')).templates;
let browser;
const levels = {};
const resumeFrom = process.argv.find((arg) => arg.startsWith('--from='))?.slice(7);
let reachedResume = !resumeFrom;
async function run(name, fn) {
  if (!reachedResume && name !== resumeFrom) return;
  reachedResume = true;
  if (process.env.BEAT_BLOOM_QA_CASE && process.env.BEAT_BLOOM_QA_CASE !== name) return;
  const start = Date.now();
  try {
    const detail = await fn();
    report.cases.push({ name, passed: true, seconds: (Date.now() - start) / 1000, ...detail });
    console.log('PASS', name, JSON.stringify(detail ?? {}));
  } catch (error) {
    report.cases.push({ name, passed: false, error: error.stack });
    report.errors.push(name);
    console.error('FAIL', name, error.message);
    throw error;
  }
}
const scalar = (text, key) => new RegExp(`^  ${key}: (.*)$`, 'm').exec(text)?.[1];
function ints(text, key) {
  const hex = scalar(text, key);
  assert.match(hex, /^(?:[a-f0-9]{8})+$/i);
  const b = Buffer.from(hex, 'hex');
  return Array.from({ length: b.length / 4 }, (_, i) => b.readInt32LE(i * 4));
}
function rgba(text, key) {
  const part = text.split(`  ${key}:\n`)[1]?.split(/\n  [A-Za-z]/)[0] ?? '';
  return [...part.matchAll(/\{r: ([^,]+), g: ([^,]+), b: ([^,]+), a: ([^}]+)\}/g)].map((m) =>
    m.slice(1).map(Number),
  );
}
const rgb = (arr) =>
  (Math.round(arr[0] * 255) << 16) | (Math.round(arr[1] * 255) << 8) | Math.round(arr[2] * 255);
function checkPower(l) {
  assert.ok(l.palette.length >= 1 && l.palette.length <= 12);
  assert.ok(l.rings.flat().every((c) => Number.isInteger(c) && c >= -1 && c < l.palette.length));
  assert.equal(l.queuePolicy, 'fixed-three');
  assert.ok(
    l.queue.every((q) => q.mystery === false && q.power === 3 && q.color < l.palette.length),
  );
  for (let c = 0; c < l.palette.length; c++)
    assert.equal(
      l.queue.filter((q) => q.color === c).length,
      Math.ceil(l.rings.flat().filter((i) => i === c).length / 3),
      `color ${c} global ball count`,
    );
  for (const lane of l.stemLanes) {
    assert.ok(lane.colors.every((c) => c >= 0 && c < l.palette.length));
    assert.ok(Number.isInteger(lane.requiredBreaks) && lane.requiredBreaks >= 1);
  }
}
async function sourceAudit() {
  assert.equal(templates.length, 20);
  const scenePath = 'Assets/Scenes/Main.unity',
    scene = await readFile(resolve(repo, scenePath), 'utf8'),
    loader = scene
      .split(/--- !u!114 /)
      .find(
        (block) =>
          block.includes('guid: 6613d939b29844daab8d5cd53f85b503') &&
          block.includes('\n  levels:\n'),
      );
  assert.ok(loader);
  assert.match(loader, /testLevel: \{fileID: 0\}/);
  const menu = loader.split('\n  levels:\n')[1].split(/\n  [A-Za-z]/)[0];
  const guids = [...menu.matchAll(/guid: ([a-f0-9]{32})/g)].slice(0, 20).map((m) => m[1]);
  assert.equal(guids.length, 20);
  const appPath = 'Assets/_Ludaxis/BeatBloom/Content/Config/AppConfig.asset',
    palettePath = 'Assets/_Ludaxis/BeatBloom/Content/Config/PaletteConfig.asset',
    policyPath = 'Assets/_Ludaxis/BeatBloom/Scripts/Runtime/Gameplay/BeatBloomPalette.cs';
  const app = await readFile(resolve(repo, appPath), 'utf8'),
    pal = await readFile(resolve(repo, palettePath), 'utf8'),
    policy = await readFile(resolve(repo, policyPath), 'utf8'),
    skin = scalar(app, 'skinImportedPalettes') === '1',
    target = rgba(pal, 'gameplayColors'),
    table = policy.split('LoopEscapeSource =')[1].split('};')[0];
  const nativeSource = [...table.matchAll(/new Color\(([^)]+)\)/g)].map((m) =>
    m[1].split(',').map((v) => Number(v.trim().replace(/f$/, ''))),
  );
  assert.equal(nativeSource.length, 10);
  assert.match(policy, /SkinMatchTolerance = 2f \/ 255f/);
  const records = [];
  for (let i = 0; i < 20; i++) {
    const t = templates[i];
    assert.equal(t.levelNumber, i + 1);
    assert.equal(t.source.menu.path, scenePath);
    assert.equal(t.source.menu.sha256, sha(scene));
    assert.equal(t.source.menu.entryIndex, i);
    assert.equal(t.source.wrapper.guid, guids[i]);
    const wrapper = await readFile(resolve(repo, t.source.wrapper.path), 'utf8'),
      wrapperMeta = await readFile(resolve(repo, t.source.wrapper.path + '.meta'), 'utf8');
    assert.equal(sha(wrapper), t.source.wrapper.sha256);
    assert.ok(wrapperMeta.includes(`guid: ${guids[i]}`));
    assert.equal(Number(scalar(wrapper, 'index')), i);
    const sourceGuid = /sourceLevel: \{fileID: 11400000, guid: ([a-f0-9]{32})/.exec(wrapper)?.[1];
    assert.equal(sourceGuid, t.source.guid);
    const raw = await readFile(resolve(repo, t.source.path), 'utf8'),
      sourceMeta = await readFile(resolve(repo, t.source.path + '.meta'), 'utf8');
    assert.ok(sourceMeta.includes(`guid: ${sourceGuid}`));
    assert.equal(sha(raw), t.source.sha256);
    assert.equal(scalar(raw, 'useExplicitSegmentPattern'), '1');
    const stride = Number(scalar(raw, 'explicitMaxSegmentsPerLayer')),
      counts = ints(raw, 'explicitLayerSegmentCounts'),
      flat = ints(raw, 'explicitSegmentColorIndices'),
      rings = counts.map((n, r) => flat.slice(r * stride, r * stride + n));
    assert.deepEqual(t.rings, rings);
    assert.equal(t.rings.length, Number(scalar(raw, 'lineCount')));
    assert.deepEqual(t.source.explicitPattern.layerSegmentCounts, counts);
    assert.equal(t.source.explicitPattern.stride, stride);
    const authored = rgba(raw, 'palette'),
      skinned = authored.map((c) => {
        const idx = skin
          ? nativeSource.findIndex((s) =>
              c.slice(0, 3).every((v, j) => Math.abs(v - s[j]) <= 2 / 255),
            )
          : -1;
        return idx >= 0 ? target[idx] : c;
      });
    assert.deepEqual(t.palette, skinned.map(rgb));
    assert.deepEqual(t.source.authoredRgba, authored);
    assert.deepEqual(t.source.authoredPalette, authored.map(rgb));
    const prefab = await readFile(resolve(repo, t.source.prefab.path), 'utf8');
    assert.equal(sha(prefab), t.source.prefab.sha256);
    assert.match(prefab, /preserveImportedLevelPalette: 1/);
    records.push({
      level: i + 1,
      label: t.label,
      source: t.source.path,
      sourceSHA256: sha(raw),
      wrapperGUID: guids[i],
      rings: rings.length,
      counts,
      palette: t.palette,
      pieces: rings.flat().filter((c) => c >= 0).length,
    });
  }
  await writeFile(
    resolve(out, 'source-audit.json'),
    JSON.stringify(
      {
        date: new Date().toISOString(),
        sceneSHA256: sha(scene),
        skinEnabled: skin,
        appSHA256: sha(app),
        paletteSHA256: sha(pal),
        policySHA256: sha(policy),
        records,
      },
      null,
      2,
    ) + '\n',
  );
  return {
    currentMenuEntries: 20,
    exactRingArrays: true,
    effectivePaletteSkinVerified: true,
    currentSourceHashesVerified: true,
  };
}
async function makeStudio(profile = 'a-heart') {
  browser ??= await chromium.launch({ channel: 'chrome', headless: true });
  report.browser = browser.version();
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true,
    }),
    page = await context.newPage(),
    errors = [],
    requests = [];
  await context.route('**/favicon.ico', (r) => r.fulfill({ status: 204, body: '' }));
  context.on('page', (p) => {
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
  });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  context.on('request', (r) => requests.push(r.url()));
  await page.goto(origin + '/');
  await page.waitForFunction(
    () =>
      document.querySelector('#game')?.contentWindow?.__beatBloom?.snapshot().ready &&
      document.querySelector('#level-json').value.length > 100,
  );
  if (profile !== 'native') {
    await page.locator('#profile').selectOption(profile);
    const song = profile.endsWith('flower') ? 'sunflower' : 'nobatidao';
    await page.waitForFunction(
      (song) =>
        document.querySelector('#game')?.contentWindow?.__beatBloom?.getLevel().songId === song &&
        JSON.parse(document.querySelector('#level-json').value).songId === song,
      song,
    );
  }
  await page.locator('#pause').click();
  await page.locator('#advanced-pattern > summary').click();
  if (await page.locator('#equal-color-spans').isChecked())
    await page.locator('#equal-color-spans').uncheck();
  return { page, context, errors, requests };
}
const game = (page) =>
  page.evaluate(() => document.querySelector('#game').contentWindow.__beatBloom.getLevel());
async function control(page, selector, value) {
  const el = page.locator(selector),
    bounds = await el.evaluate((e) => ({ min: Number(e.min), max: Number(e.max) }));
  assert.ok(
    value >= bounds.min && value <= bounds.max,
    `${selector} ${value} not in bounds ${JSON.stringify(bounds)}`,
  );
  await el.scrollIntoViewIfNeeded();
  const box = await el.boundingBox();
  assert.ok(box);
  if (bounds.max !== bounds.min) {
    const x = box.x + 8 + ((value - bounds.min) / (bounds.max - bounds.min)) * (box.width - 16);
    await page.mouse.click(x, box.y + box.height / 2);
    for (let i = 0; i < 35 && Math.abs(Number(await el.inputValue()) - value) > 1e-8; i++)
      await el.press(Number(await el.inputValue()) < value ? 'ArrowRight' : 'ArrowLeft');
  }
  assert.ok(
    Math.abs(Number(await el.inputValue()) - value) < 1e-8,
    `${selector} did not reach ${value}`,
  );
}
async function setColor(page, value) {
  await page.locator('[aria-label="First color"]').fill(value);
  await page.locator('[aria-label="First color"]').dispatchEvent('change');
}
function noErrors(host) {
  assert.deepEqual(host.errors, []);
  assert.deepEqual(
    host.requests.filter((u) => /reference-video|\/reference\/|\.mp4(?:\?|$)/.test(u)),
    [],
  );
}
async function modelModules() {
  return Promise.all([import('../src/native/model.ts'), import('../src/native/pattern-editor.ts')]);
}
function assertWinReplay(NativeModel, level, result) {
  assert.equal(result.status, 'verified-win');
  const model = new NativeModel(level),
    events = [];
  let index = 0;
  const unique = new Set();
  for (let step = 0; step < result.steps; step++) {
    while (index < result.inputs.length && result.inputs[index].step === step) {
      const input = result.inputs[index++];
      assert.ok(input.type === 'queue' || input.type === 'tray');
      assert.equal(
        input.type === 'queue' ? model.fireQueue(input.index) : model.fireTray(input.index),
        true,
        `receipt input ${index} must be accepted`,
      );
    }
    model.step(result.fixedStep);
    for (const e of model.drainEvents()) {
      events.push(e);
      if (e.type === 'break') {
        assert.equal(unique.has(e.segmentId), false);
        unique.add(e.segmentId);
      }
    }
  }
  assert.equal(index, result.inputs.length);
  assert.equal(model.status, 'won');
  assert.equal(model.remaining, 0);
  assert.equal(unique.size, model.total);
  assert.equal(events.filter((e) => e.type === 'win').length, 1);
  assert.equal(events.filter((e) => e.type === 'booster').length, 0);
  return {
    pieces: model.total,
    shots: model.shots,
    simulatedSeconds: model.time,
    acceptedInputs: index,
    uniqueBreaks: unique.size,
    oneWin: true,
  };
}
try {
  if (repo) await run('current-first20-template-source-audit', sourceAudit);
  else
    console.log(
      'Unity source audit skipped: BEAT_BLOOM_UNITY_PROJECT is not set. Packaged-template browser checks still run.',
    );
  if (!process.argv.includes('--source-only')) {
    await run('all20-template-buttons-apply-exact-current-patterns', async () => {
      const host = await makeStudio('a-flower'),
        { page, context } = host;
      try {
        assert.equal(await page.locator('#pattern-template option:not([value=""])').count(), 20);
        await page.locator('#shape').selectOption('heart');
        await control(page, '#thickness', 12);
        await control(page, '#shape-speed', 0.7);
        await control(page, '#segment-speed', 1.4);
        const original = await game(page),
          applied = [];
        for (const template of templates) {
          await page.locator('#pattern-template').selectOption(template.id);
          await page.locator('#apply-template').click();
          const current = await game(page);
          assert.deepEqual(current.rings, template.rings);
          assert.deepEqual(current.palette, template.palette);
          for (const field of ['songId', 'shape', 'lineThickness', 'bpm', 'motion', 'sections'])
            assert.deepEqual(
              current[field],
              original[field],
              `${field} must survive a template change`,
            );
          checkPower(current);
          assert.equal(Number(await page.locator('#layers').inputValue()), template.rings.length);
          assert.equal(
            await page.locator('.palette input[type="color"]').count(),
            template.palette.length,
          );
          assert.equal(await page.locator('#pattern-map').isVisible(), true);
          applied.push({
            level: template.levelNumber,
            rings: current.rings.length,
            palette: current.palette.length,
            pieces: current.rings.flat().filter((c) => c >= 0).length,
          });
        }
        levels.template20 = await game(page);
        await page.screenshot({ path: resolve(out, 'current-template-20.png'), fullPage: true });
        noErrors(host);
        return {
          templatesApplied: applied,
          selectedSongPreserved: 'sunflower',
          geometryAndMotionPreserved: true,
          ammoBalanced: true,
        };
      } finally {
        await context.close();
      }
    });
    await run('pattern-palette-bounds-ammunition-and-stale-proof', async () => {
      const host = await makeStudio(),
        { page, context } = host;
      try {
        await control(page, '#layers', 3);
        // Layer edits re-infer whether spans are equal; this stress fixture requests exact counts.
        if (await page.locator('#equal-color-spans').isChecked())
          await page.locator('#equal-color-spans').uncheck();
        assert.equal(await page.locator('#equal-color-spans').isChecked(), false);
        const cases = [];
        // Grow the segment capacity before asking the UI to introduce additional color identities.
        for (const [colors, segments, per, shift] of [
          [1, 1, 1, 0],
          [6, 7, 3, 2],
          [12, 24, 12, 23],
          [2, 3, 2, 2],
        ]) {
          if (segments > Number(await page.locator('#segments-per-ring').inputValue()))
            await control(page, '#segments-per-ring', segments);
          await control(page, '#color-count', colors);
          await control(page, '#segments-per-ring', segments);
          await control(page, '#colors-per-ring', per);
          await control(page, '#pattern-shift', shift);
          const l = await game(page);
          assert.equal(l.palette.length, colors);
          assert.equal(new Set(l.palette).size, colors);
          assert.equal(l.rings.length, 3);
          assert.ok(l.rings.every((r) => r.length === segments && new Set(r).size === per));
          assert.equal(l.pattern.colorCount, colors);
          assert.equal(l.pattern.segmentsPerRing, segments);
          assert.equal(l.pattern.colorsPerRing, per);
          assert.equal(l.pattern.shift, 0);
          assert.ok(Math.abs(l.ringShiftDegrees - shift) < 1e-9);
          checkPower(l);
          assert.equal(await page.locator('.palette input[type="color"]').count(), colors);
          assert.equal(Number(await page.locator('#pattern-shift').getAttribute('max')), 180);
          assert.equal(
            Number(await page.locator('#colors-per-ring').getAttribute('max')),
            Math.min(colors, segments),
          );
          const noShift = await page.evaluate(() => {
            const a = document.querySelector('#game').contentWindow.__beatBloom,
              current = a.getLevel();
            return a.setPatternShift(0);
          });
          // Fine angular shifts preserve exact authored arrays and ammunition.
          assert.deepEqual(l.rings, noShift.rings);
          assert.deepEqual(l.queue, noShift.queue);
          if (shift > 0) assert.notDeepEqual(l.ringPhaseOffsets, noShift.ringPhaseOffsets);
          await page.evaluate(
            (l) => document.querySelector('#game').contentWindow.__beatBloom.setLevel(l),
            l,
          );
          cases.push({
            colors,
            segments,
            colorsPerRing: per,
            shift,
            pieces: l.rings.flat().length,
            powerBalanced: true,
          });
        }
        // Return to a tiny, concrete puzzle, then verify the real worker receipt independently.
        await control(page, '#color-count', 1);
        await control(page, '#segments-per-ring', 1);
        await control(page, '#layers', 1);
        for (let attempt = 0; attempt < 2; attempt++) {
          await page.locator('#check-solvable').click();
          if (
            ['checking', 'verified-win'].includes(
              await page.locator('#solve-status').getAttribute('data-state'),
            )
          )
            break;
        }
        await page.waitForFunction(
          () => document.querySelector('#solve-status').dataset.state === 'verified-win',
          undefined,
          { timeout: 30000 },
        );
        const provedLevel = await game(page),
          receipt = await page.evaluate(() => __beatBloomStudio.getSolvability());
        assert.ok(receipt?.levelKey);
        const [{ NativeModel }] = await modelModules();
        const replay = assertWinReplay(NativeModel, provedLevel, receipt);
        await writeFile(
          resolve(out, 'tiny-worker-receipt.json'),
          JSON.stringify({ level: provedLevel, receipt, replay }, null, 2) + '\n',
        );
        await setColor(page, '#cf13c4');
        const afterRGB = await game(page);
        for (const field of Object.keys(provedLevel).filter((key) => key !== 'palette'))
          assert.deepEqual(
            afterRGB[field],
            provedLevel[field],
            `RGB-only edit must preserve ${field}`,
          );
        assert.equal(
          await page.locator('#solve-status').getAttribute('data-state'),
          'verified-win',
        );
        assert.equal(
          (await page.evaluate(() => __beatBloomStudio.getSolvability())).levelKey,
          receipt.levelKey,
          'RGB-only styling does not invalidate the indexed-physics proof',
        );
        await control(page, '#segments-per-ring', 24);
        assert.notEqual(
          await page.locator('#solve-status').getAttribute('data-state'),
          'verified-win',
          'structural edits must clear the old proof immediately',
        );
        assert.equal(await page.evaluate(() => __beatBloomStudio.getSolvability()), null);
        const before = await game(page);
        assert.equal(before.queue.length, 8);
        assert.ok(
          before.queue.every((q) => q.power === 3),
          'returning from a one-piece recipe must restore authored power-3 chunks',
        );
        const bad = await page.evaluate(() => {
          const a = document.querySelector('#game').contentWindow.__beatBloom,
            old = JSON.stringify(a.getLevel());
          return [
            { colorCount: 0 },
            { segmentsPerRing: 25 },
            { colorsPerRing: 0 },
            { shift: NaN },
          ].map((change) => {
            let error = '';
            try {
              a.setPattern({ ...a.getLevel().pattern, ...change });
            } catch (e) {
              error = String(e);
            }
            return { error, retained: JSON.stringify(a.getLevel()) === old };
          });
        });
        assert.ok(bad.every((x) => x.error && x.retained));
        assert.deepEqual(await game(page), before);
        noErrors(host);
        return {
          cases,
          actualWorkerWin: replay,
          rgbOnlyPreservesProof: true,
          structuralEditClearsProof: true,
          invalidPatternTransactions: bad.length,
        };
      } finally {
        await context.close();
      }
    });
    await run('independent-shape-and-segment-motion-controls', async () => {
      const host = await makeStudio(),
        { page, context } = host;
      try {
        await page.locator('#shape').selectOption('heart');
        await control(page, '#layers', 3);
        await control(page, '#color-count', 2);
        await control(page, '#segments-per-ring', 6);
        await control(page, '#colors-per-ring', 2);
        await control(page, '#pattern-shift', 1);
        const [{ NativeModel }] = await modelModules(),
          samples = [];
        for (const [shape, segment] of [
          [0, 0],
          [0, 1],
          [1, 0],
          [1, 1],
        ]) {
          await control(page, '#shape-speed', shape);
          await control(page, '#segment-speed', segment);
          const l = await game(page);
          assert.equal(l.motion.speedMultiplier, shape * 2);
          assert.ok(Math.abs(l.motion.conveyorBeatsPerSlot - (segment ? 12 / segment : 0)) < 1e-10);
          const m = new NativeModel(l),
            initial = {
              rotation: m.rotation,
              wall: structuredClone(m.wallPoints),
              points: structuredClone(m.rings[0].segments[0].points),
            };
          for (let i = 0; i < 60; i++) m.step(1 / 120);
          const rotation = m.rotation - initial.rotation,
            wallDelta = Math.max(
              ...m.wallPoints.map((p, i) =>
                Math.hypot(p.x - initial.wall[i].x, p.y - initial.wall[i].y),
              ),
            ),
            points = m.rings[0].segments[0].points;
          const unrotated = points.map((p) => ({
            x: p.x * Math.cos(-rotation) - p.y * Math.sin(-rotation),
            y: p.x * Math.sin(-rotation) + p.y * Math.cos(-rotation),
          }));
          const conveyorDelta = Math.max(
            ...unrotated.map((p, i) =>
              Math.hypot(p.x - initial.points[i].x, p.y - initial.points[i].y),
            ),
          );
          if (shape === 0) {
            assert.equal(rotation, 0);
            assert.equal(wallDelta, 0);
          } else {
            assert.ok(Math.abs(rotation) > 0.01);
            assert.ok(wallDelta > 0.01);
          }
          if (segment === 0) assert.ok(conveyorDelta < 1e-9);
          else assert.ok(conveyorDelta > 0.01);
          samples.push({
            shapeSpeed: shape,
            segmentSpeed: segment,
            rotationRadians: rotation,
            wallDeltaWorldUnits: wallDelta,
            segmentDeltaAfterRemovingRigidRotation: conveyorDelta,
          });
        }
        await page.screenshot({
          path: resolve(out, 'independent-speed-controls.png'),
          fullPage: true,
        });
        noErrors(host);
        return {
          samples,
          stationaryContourWithMovingSegments: true,
          rigidRotationWithoutConveyor: true,
        };
      } finally {
        await context.close();
      }
    });
    await run('advanced-pattern-open-and-all-network-downloads', async () => {
      const host = await makeStudio(),
        { page, context } = host;
      try {
        await page.locator('#shape').selectOption('flower');
        await control(page, '#layers', 4);
        await control(page, '#visible-layers', 3);
        if (await page.locator('#equal-color-spans').isChecked())
          await page.locator('#equal-color-spans').uncheck();
        assert.equal(await page.locator('#equal-color-spans').isChecked(), false);
        await control(page, '#segments-per-ring', 7);
        await control(page, '#color-count', 5);
        await control(page, '#colors-per-ring', 3);
        await control(page, '#pattern-shift', 2);
        await control(page, '#shape-speed', 0.6);
        await control(page, '#segment-speed', 1.7);
        await control(page, '#thickness', 12);
        await control(page, '#petals', 7);
        await setColor(page, '#ed10ca');
        const edited = await game(page);
        checkPower(edited);
        assert.equal(edited.palette.length, 5);
        assert.equal(edited.rings.flat().length, 28);
        levels.edited = edited;
        const popupEvent = context.waitForEvent('page');
        await page.locator('#fullscreen').click();
        const popup = await popupEvent;
        await popup.setViewportSize({ width: 576, height: 1280 });
        await popup.waitForFunction(() => window.__beatBloom?.snapshot().ready);
        await popup.evaluate(() => __beatBloom.pause(true));
        assert.deepEqual(await popup.evaluate(() => __beatBloom.getLevel()), edited);
        await popup.reload();
        await popup.waitForFunction(() => window.__beatBloom?.snapshot().ready);
        assert.deepEqual(await popup.evaluate(() => __beatBloom.getLevel()), edited);
        await popup.screenshot({ path: resolve(out, 'opened-advanced-pattern.png') });
        await page.locator('#export-tab').click();
        const exports = [];
        for (const network of ['unity', 'applovin', 'meta']) {
          await page.locator('#export-network').selectOption(network);
          await page.locator('#export-format').selectOption('html');
          const pending = page.waitForEvent('download', { timeout: 45000 });
          await page.locator('#export-playable').click();
          const download = await pending,
            path = resolve(out, `pattern-${network}.html`);
          await download.saveAs(path);
          const bytes = await readFile(path),
            match = bytes
              .toString()
              .match(/<script[^>]*id=["']beatbloom-export["'][^>]*>([\s\S]*?)<\/script>/);
          assert.ok(match);
          const meta = JSON.parse(match[1]);
          assert.deepEqual(meta.level, edited);
          assert.equal(meta.network, network);
          assert.equal(meta.profile, 'a-heart');
          assert.ok(bytes.length < (network === 'meta' ? 2_000_000 : 5_000_000));
          assert.equal(bytes.includes(Buffer.from('beatbloom:studio-preview:')), false);
          exports.push({ network, htmlBytes: bytes.length, sha256: sha(bytes), exactLevel: true });
        }
        await writeFile(resolve(out, 'edited-level.json'), JSON.stringify(edited, null, 2) + '\n');
        await page.screenshot({
          path: resolve(out, 'advanced-pattern-studio.png'),
          fullPage: true,
        });
        noErrors(host);
        return {
          pattern: edited.pattern,
          layers: 4,
          pieces: 28,
          song: edited.songId,
          openReloadExact: true,
          exports,
        };
      } finally {
        await context.close();
      }
    });
    await run('independent-real-model-solutions-and-no-false-budget-win', async () => {
      const [{ NativeModel }, { generatePattern, applyRingTemplate, verifyPlayableLevel }] =
          await modelModules(),
        { DEFAULT_NATIVE_LEVEL } = await import('../src/native/config.ts'),
        { setLayerCount } = await import('../src/native/level-editor.ts');
      const uneven = generatePattern(setLayerCount(DEFAULT_NATIVE_LEVEL, 3), {
          colorCount: 3,
          segmentsPerRing: 7,
          colorsPerRing: 3,
          shift: 2,
        }),
        template = applyRingTemplate(DEFAULT_NATIVE_LEVEL, templates[0]);
      const cases = [
          ['uneven-generated', uneven],
          ['current-source-template-1', template],
          ['current-source-template-6', applyRingTemplate(DEFAULT_NATIVE_LEVEL, templates[5])],
          ['current-source-template-20', applyRingTemplate(DEFAULT_NATIVE_LEVEL, templates[19])],
          [
            levels.edited ? 'exported-five-color' : 'five-color-generated',
            levels.edited ??
              generatePattern(setLayerCount(DEFAULT_NATIVE_LEVEL, 4), {
                colorCount: 5,
                segmentsPerRing: 7,
                colorsPerRing: 3,
                shift: 2,
              }),
          ],
        ],
        results = [];
      for (const [name, l] of cases) {
        const r = verifyPlayableLevel(l, {
          maxSimulationSeconds: 300,
          maxAttempts: 3,
          maxWallTimeMs: 20000,
        });
        assert.equal(r.status, 'verified-win', `${name}: ${r.reason}; remaining ${r.remaining}`);
        const replay = assertWinReplay(NativeModel, l, r);
        await writeFile(
          resolve(out, `${name}-receipt.json`),
          JSON.stringify({ level: l, receipt: r, replay }, null, 2) + '\n',
        );
        results.push({ name, ...replay });
      }
      const short = verifyPlayableLevel(uneven, {
        maxSimulationSeconds: 0.01,
        maxAttempts: 1,
        maxWallTimeMs: 1000,
      });
      assert.equal(short.status, 'not-verified');
      assert.ok(short.remaining > 0);
      assert.match(short.reason, /not proof|does not mean/i);
      return {
        concretePublicInputWins: results,
        budgetCannotClaimWin: true,
        notVerifiedDoesNotMeanImpossible: true,
      };
    });
    await run('edited-five-color-receipt-through-real-browser-buttons', async () => {
      const saved = JSON.parse(
          await readFile(
            resolve(
              process.env.BEAT_BLOOM_QA_RECEIPT || resolve(out, 'exported-five-color-receipt.json'),
            ),
            'utf8',
          ),
        ),
        host = await makeStudio(),
        { page, context } = host;
      try {
        await page.locator('summary').filter({ hasText: 'Edit rings and queue' }).click();
        await page.locator('#level-json').fill(JSON.stringify(saved.level));
        await page.locator('#apply-json').click();
        assert.deepEqual(await game(page), saved.level);
        const frame = page.frames().find((f) => f.url().includes('/dist/preview/a-heart.html'));
        assert.ok(frame);
        await frame.evaluate(() => __beatBloom.pause(true));
        let step = 0;
        const colors = new Set();
        const advance = async (n) => {
          if (n > 0)
            await frame.evaluate((n) => {
              for (let i = 0; i < n; i++) __beatBloom.step(1 / 120);
            }, n);
        };
        for (const input of saved.receipt.inputs) {
          await advance(input.step - step);
          step = input.step;
          const before = await frame.evaluate(() => __beatBloom.snapshot());
          let color;
          if (input.type === 'queue') {
            color = before.queueBalls.find((q) => q.row === 0 && q.column === input.index).color;
            await frame.locator(`.queue-ball:not(.future)[data-column="${input.index}"]`).click();
          } else {
            color = before.balls.find((b) => b.state === 'stored' && b.slot === input.index).color;
            await frame.locator(`.tray-slot[data-tray="${input.index}"]`).click();
          }
          colors.add(color);
          assert.equal(
            (await frame.evaluate(() => __beatBloom.snapshot())).shots,
            before.shots + 1,
          );
        }
        await advance(saved.receipt.steps - step);
        const final = await frame.evaluate(() => __beatBloom.snapshot()),
          events = await frame.evaluate(() => __beatBloom.events()),
          breaks = events.filter((e) => e.type === 'break');
        assert.equal(final.status, 'won');
        assert.equal(final.remaining, 0);
        assert.equal(breaks.length, 28);
        assert.equal(new Set(breaks.map((e) => e.segmentId)).size, 28);
        assert.equal(events.filter((e) => e.type === 'win').length, 1);
        assert.equal(colors.size, 5);
        assert.equal(events.filter((e) => e.type === 'booster').length, 0);
        await frame.evaluate(() => __beatBloom.step(5));
        await frame.locator('.result').waitFor({ state: 'visible' });
        await frame.locator('.endcard-content,.endcard-actions').evaluateAll(async (els) => {
          await Promise.all(els.flatMap((el) => el.getAnimations().map((a) => a.finished)));
        });
        await page.screenshot({
          path: resolve(out, 'five-color-pattern-browser-win.png'),
          fullPage: true,
        });
        noErrors(host);
        return {
          realDOMInputs: saved.receipt.inputs.length,
          colorsPlayed: colors.size,
          pieces: 28,
          uniqueBreaks: 28,
          oneWin: true,
          simulatedSeconds: final.time,
          endCardVisible: true,
          noStateInjection: true,
        };
      } finally {
        await context.close();
      }
    });
  }
} catch {
  process.exitCode = 1;
} finally {
  if (!reachedResume) {
    report.errors.push(`Unknown resume case: ${resumeFrom}`);
    process.exitCode = 1;
  }
  if (browser) await browser.close();
  await writeFile(
    resolve(
      out,
      process.argv.includes('--source-only') ? 'source-results.json' : 'browser-results.json',
    ),
    JSON.stringify(report, null, 2) + '\n',
  );
}
