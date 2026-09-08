import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { register } from 'tsx/esm/api';
register();
const { NativeModel } = await import('../src/native/model.ts');
const { verifyPlayableLevel, applyRingTemplate } = await import('../src/native/pattern-editor.ts');
const origin = process.env.BEAT_BLOOM_QA_ORIGIN || 'http://127.0.0.1:4178';
const out = resolve(process.env.BEAT_BLOOM_QA_OUTPUT || 'qa/native/2026-09-08-continuous-shift');
await mkdir(out, { recursive: true });
const sha = (b) => createHash('sha256').update(b).digest('hex');
const report = {
  date: new Date().toISOString(),
  method:
    'Isolated Chrome; actual studio controls, immutable level round trips, real model receipts replayed through queue/tray DOM buttons. Desktop timing is not device certification.',
  cases: [],
  errors: [],
};
const browser = await chromium.launch({ channel: 'chrome', headless: true });
report.browser = browser.version();
const level = (p) =>
  p.evaluate(() => document.querySelector('#game').contentWindow.__beatBloom.getLevel());
const noPhase = (l) => {
  const copy = structuredClone(l);
  delete copy.ringPhaseOffsets;
  delete copy.ringShiftDegrees;
  delete copy.pattern;
  return copy;
};
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);
async function studio() {
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true,
    }),
    page = await context.newPage(),
    errors = [],
    requests = [];
  await context.route('**/favicon.ico', (r) => r.fulfill({ status: 204, body: '' }));
  const watch = (p) => {
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
  };
  watch(page);
  context.on('page', watch);
  context.on('request', (r) => requests.push(r.url()));
  await page.goto(origin + '/');
  await page.waitForFunction(
    () =>
      document.querySelector('#game')?.contentWindow?.__beatBloom?.snapshot().ready &&
      document.querySelector('#level-json').value.length > 100,
  );
  await page.locator('#profile').selectOption('a-heart');
  await page.waitForFunction(
    () =>
      document.querySelector('#game')?.contentWindow?.__beatBloom?.getLevel().songId ===
        'nobatidao' &&
      JSON.parse(document.querySelector('#level-json').value).songId === 'nobatidao',
  );
  await page.locator('#pause').click();
  await page.locator('#advanced-pattern > summary').click();
  assert.equal(await page.locator('#use-flower').count(), 0);
  return { context, page, errors, requests };
}
async function slider(p, id, value) {
  const el = p.locator(id);
  await el.scrollIntoViewIfNeeded();
  await el.focus();
  await el.press('Home');
  let n = Number(await el.inputValue()),
    step = Number(await el.getAttribute('step')) || 1;
  const count = Math.round((value - n) / step);
  assert.ok(count >= 0 && count <= 3600);
  for (let i = 0; i < count; i++) await el.press('ArrowRight');
  near(Number(await el.inputValue()), value, 1e-8);
}
async function fine(p, value) {
  await p.locator('#pattern-shift-fine').fill(String(value));
  await p.locator('#pattern-shift-fine').press('Tab');
}
function healthy(h) {
  assert.deepEqual(h.errors, []);
  assert.deepEqual(
    h.requests.filter((u) => /reference-video|\/reference\/|\.mp4(?:\?|$)/.test(u)),
    [],
  );
}
async function run(name, fn) {
  if (process.env.BEAT_BLOOM_QA_CASE && process.env.BEAT_BLOOM_QA_CASE !== name) return;
  const start = Date.now();
  try {
    const detail = await fn();
    report.cases.push({ name, passed: true, seconds: (Date.now() - start) / 1000, ...detail });
    console.log('PASS', name, JSON.stringify(detail));
  } catch (e) {
    report.cases.push({ name, passed: false, error: e.stack });
    report.errors.push(name);
    console.error('FAIL', name, e.stack);
    throw e;
  }
}
let edited, receipt;
try {
  await run('continuous-fine-control-preserves-current-template-and-shared-geometry', async () => {
    const h = await studio(),
      { page: p, context } = h;
    try {
      await p.locator('#pattern-template').selectOption('menu-level-20');
      await p.locator('#apply-template').click();
      const base = await level(p);
      await fine(p, 0);
      const baseline = await level(p),
        m0 = new NativeModel(baseline),
        origin = m0.rings[1].segments[0].points[0],
        samples = [];
      await p.locator('#game').screenshot({ path: resolve(out, 'template-phase-zero.png') });
      for (const degrees of [0.01, 0.1, 0.2, -0.1, 0]) {
        await fine(p, degrees);
        const current = await level(p);
        assert.deepEqual(noPhase(current), noPhase(base));
        near(current.ringShiftDegrees, degrees);
        current.ringPhaseOffsets.forEach((phase, r) =>
          near(phase, ((((r * degrees) / 360) % 1) + 1) % 1),
        );
        const m = new NativeModel(current);
        assert.deepEqual(m.wallPoints, m0.wallPoints);
        m.rings.forEach((r, i) => assert.deepEqual(r.points, m0.rings[i].points));
        assert.deepEqual(m.rings[0].segments, m0.rings[0].segments);
        const point = m.rings[1].segments[0].points[0],
          delta = { x: point.x - origin.x, y: point.y - origin.y };
        samples.push({
          degrees,
          deltaWorld: delta,
          displacementPixels: Math.hypot(delta.x, delta.y) * m.config.view.pixelsPerUnit,
          pointsPerSegment: m.rings[1].segments[0].points.length,
        });
        if (degrees !== 0) assert.ok(Math.hypot(delta.x, delta.y) > 1e-6);
        if (degrees === 0.1)
          await p
            .locator('#game')
            .screenshot({ path: resolve(out, 'template-phase-point-one.png') });
      }
      const tiny = samples[0].deltaWorld,
        one = samples[1].deltaWorld,
        two = samples[2].deltaWorld,
        negative = samples[3].deltaWorld;
      near(tiny.x, one.x * 0.1, 1e-7);
      near(tiny.y, one.y * 0.1, 1e-7);
      near(two.x, one.x * 2, 1e-7);
      near(two.y, one.y * 2, 1e-7);
      assert.ok(
        negative.x * one.x + negative.y * one.y < 0,
        'negative phase follows the opposite contour direction',
      );
      near(Math.hypot(negative.x, negative.y), Math.hypot(one.x, one.y), 2e-4);
      await fine(p, 0.01);
      await p.locator('#pattern-shift-fine').focus();
      await p.locator('#pattern-shift-fine').press('ArrowUp');
      await p.locator('#pattern-shift-fine').press('Tab');
      near((await level(p)).ringShiftDegrees, 0.02);
      const before = await level(p);
      await fine(p, 181);
      assert.deepEqual(await level(p), before);
      assert.match(await p.locator('#editor-message').innerText(), /not changed/i);
      await p.setViewportSize({ width: 390, height: 844 });
      await p.locator('#pattern-shift-fine').scrollIntoViewIfNeeded();
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth), 390);
      await p.screenshot({ path: resolve(out, 'fine-offset-390px.png') });
      healthy(h);
      return {
        exactSourceRingsAmmoPaletteAndTuningPreserved: true,
        outlineUnchanged: true,
        samples,
        fineKeyboardStep: 0.01,
        invalid181RetainsLevel: true,
        mobileNoOverflow: true,
      };
    } finally {
      await context.close();
    }
  });
  await run('equal-span-normalization-and-fractional-current-level-roundtrips', async () => {
    const h = await studio(),
      { page: p, context } = h;
    try {
      await p.locator('#shape').selectOption('triangle');
      await slider(p, '#layers', 4);
      if (await p.locator('#equal-color-spans').isChecked())
        await p.locator('#equal-color-spans').uncheck();
      await slider(p, '#color-count', 3);
      await slider(p, '#segments-per-ring', 6);
      await slider(p, '#colors-per-ring', 3);
      await p.locator('#equal-color-spans').check();
      // Arrow edits are intentionally single requests: the normalized output can differ from the requested input.
      const changes = [];
      for (const requested of [7, 8]) {
        await p.locator('#segments-per-ring').evaluate((el, v) => {
          el.value = String(v);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }, requested);
        const l = await level(p),
          expected = requested === 7 ? 6 : 9;
        assert.ok(l.rings.every((r) => r.length === expected));
        for (const row of l.rings)
          assert.deepEqual(
            [0, 1, 2].map((c) => row.filter((i) => i === c).length),
            [expected / 3, expected / 3, expected / 3],
          );
        assert.equal(l.pattern.equalColorSpans, true);
        changes.push({ requested, actual: expected });
      }
      await p.locator('#segments-per-ring').press('ArrowLeft');
      assert.equal(Number(await p.locator('#segments-per-ring').inputValue()), 6);
      await p.locator('#segments-per-ring').press('ArrowRight');
      assert.equal(Number(await p.locator('#segments-per-ring').inputValue()), 9);
      await p.locator('#equal-color-spans').uncheck();
      await p.locator('#segments-per-ring').press('ArrowRight');
      assert.equal(Number(await p.locator('#segments-per-ring').inputValue()), 10);
      await slider(p, '#segments-per-ring', 7);
      await slider(p, '#colors-per-ring', 3);
      await slider(p, '#visible-layers', 4);
      assert.ok((await level(p)).rings.every((r) => r.length === 7));
      await fine(p, 0.25);
      edited = await level(p);
      assert.equal(edited.pattern.equalColorSpans, false);
      near(edited.ringShiftDegrees, 0.25);
      assert.equal(edited.rings.flat().length, 28);
      const save = p.waitForEvent('download');
      await p.locator('#save').click();
      const saved = await save,
        savePath = resolve(out, 'fractional-level.json');
      await saved.saveAs(savePath);
      assert.deepEqual(JSON.parse(await readFile(savePath, 'utf8')), edited);
      await fine(p, -0.75);
      await p.locator('#load-file').setInputFiles(savePath);
      await p.waitForFunction(
        () =>
          document.querySelector('#game').contentWindow.__beatBloom.getLevel().ringShiftDegrees ===
          0.25,
      );
      assert.deepEqual(await level(p), edited);
      const opened = context.waitForEvent('page');
      await p.locator('#fullscreen').click();
      const popup = await opened;
      await popup.waitForFunction(() => window.__beatBloom?.snapshot().ready);
      assert.deepEqual(await popup.evaluate(() => __beatBloom.getLevel()), edited);
      await popup.reload();
      await popup.waitForFunction(() => window.__beatBloom?.snapshot().ready);
      assert.deepEqual(await popup.evaluate(() => __beatBloom.getLevel()), edited);
      await popup.evaluate(() => __beatBloom.pause(true));
      await popup.setViewportSize({ width: 576, height: 1280 });
      await popup.screenshot({ path: resolve(out, 'fractional-opened-triangle.png') });
      await popup.close();
      await p.locator('#export-tab').click();
      const exports = [];
      for (const network of ['unity', 'applovin', 'meta']) {
        await p.locator('#export-network').selectOption(network);
        const pending = p.waitForEvent('download', { timeout: 45000 });
        await p.locator('#export-playable').click();
        const download = await pending,
          path = resolve(out, `fractional-${network}.html`);
        await download.saveAs(path);
        const bytes = await readFile(path),
          meta = JSON.parse(
            bytes
              .toString()
              .match(/<script[^>]*id=["']beatbloom-export["'][^>]*>([\s\S]*?)<\/script>/)[1],
          );
        assert.deepEqual(meta.level, edited);
        assert.equal(meta.network, network);
        assert.ok(bytes.length < (network === 'meta' ? 2e6 : 5e6));
        assert.ok(!bytes.includes(Buffer.from('beatbloom:studio-preview:')));
        exports.push({ network, bytes: bytes.length, sha256: sha(bytes), exactLevel: true });
      }
      healthy(h);
      return {
        equalSpans: changes,
        disabledPreservesExactCount: 7,
        degrees: 0.25,
        pieces: 28,
        saveLoadOpenReloadExact: true,
        exports,
      };
    } finally {
      await context.close();
    }
  });
  await run('invalid-phase-state-and-export-validation-are-transactional', async () => {
    const h = await studio(),
      { page: p, context } = h;
    try {
      const results = await p.evaluate(() => {
        const a = document.querySelector('#game').contentWindow.__beatBloom,
          before = JSON.stringify(a.getLevel()),
          l = a.getLevel(),
          n = l.rings.length,
          cases = [
            { ringPhaseOffsets: [] },
            { ringPhaseOffsets: Array(n).fill(NaN) },
            { ringPhaseOffsets: Array(n).fill(Infinity) },
            { ringPhaseOffsets: Array(n).fill(-0.1) },
            { ringPhaseOffsets: Array(n).fill(1) },
            { ringPhaseOffsets: Array(n).fill('0') },
            { ringShiftDegrees: 181 },
            { ringShiftDegrees: -181 },
            { ringShiftDegrees: null },
          ];
        return cases.map((change) => {
          let error = '';
          try {
            a.setLevel({ ...l, ...change });
          } catch (e) {
            error = String(e);
          }
          return { error, unchanged: JSON.stringify(a.getLevel()) === before };
        });
      });
      assert.ok(results.every((r) => r.error && r.unchanged));
      const payload = await level(p),
        responses = [];
      for (const change of [
        { ringPhaseOffsets: [] },
        { ringPhaseOffsets: Array(payload.rings.length).fill(1) },
        { ringShiftDegrees: 181 },
      ]) {
        const r = await context.request.post(origin + '/api/export', {
          headers: { origin },
          data: {
            profile: 'a-heart',
            network: 'meta',
            level: { ...payload, ...change },
            format: 'html',
          },
        });
        assert.equal(r.status(), 422);
        const b = await r.json();
        assert.match(b.error, /ringPhaseOffsets|ringShiftDegrees/);
        responses.push({ status: r.status(), error: b.error });
      }
      healthy(h);
      return { runtimeRejectedWithoutMutation: results.length, backendRejects: responses };
    } finally {
      await context.close();
    }
  });
  await run('fractional-real-model-win-replayed-through-browser-buttons', async () => {
    edited ??= JSON.parse(await readFile(resolve(out, 'fractional-level.json'), 'utf8'));
    const started = performance.now();
    receipt = verifyPlayableLevel(edited, {
      maxSimulationSeconds: 300,
      maxAttempts: 3,
      maxWallTimeMs: 20000,
    });
    assert.equal(receipt.status, 'verified-win', receipt.reason);
    const solveMs = performance.now() - started;
    const h = await studio(),
      { page: p, context } = h;
    try {
      await p.locator('#load-file').setInputFiles({
        name: 'fractional.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(edited)),
      });
      await p.waitForFunction(
        () =>
          document.querySelector('#game').contentWindow.__beatBloom.getLevel().ringShiftDegrees ===
          0.25,
      );
      assert.deepEqual(await level(p), edited);
      const frame = p.frames().find((f) => f.url().includes('/dist/preview/a-heart.html'));
      await frame.evaluate(() => __beatBloom.pause(true));
      let current = 0;
      const accepted = [];
      const advance = async (n) => {
        if (n)
          await frame.evaluate((n) => {
            for (let i = 0; i < n; i++) __beatBloom.step(1 / 120);
          }, n);
      };
      for (const input of receipt.inputs) {
        await advance(input.step - current);
        current = input.step;
        const before = await frame.evaluate(() => __beatBloom.snapshot());
        await frame
          .locator(
            input.type === 'queue'
              ? `.queue-ball:not(.future)[data-column="${input.index}"]`
              : `.tray-slot[data-tray="${input.index}"]`,
          )
          .click();
        assert.equal((await frame.evaluate(() => __beatBloom.snapshot())).shots, before.shots + 1);
        accepted.push(input);
      }
      await advance(receipt.steps - current);
      const final = await frame.evaluate(() => __beatBloom.snapshot()),
        events = await frame.evaluate(() => __beatBloom.events()),
        breaks = events.filter((e) => e.type === 'break');
      assert.equal(final.status, 'won');
      assert.equal(final.remaining, 0);
      assert.equal(new Set(breaks.map((e) => e.segmentId)).size, 28);
      assert.equal(events.filter((e) => e.type === 'win').length, 1);
      assert.equal(events.filter((e) => e.type === 'booster').length, 0);
      await frame.evaluate(() => __beatBloom.step(5));
      await frame.locator('.result').waitFor({ state: 'visible' });
      await frame
        .locator('.endcard-content,.endcard-actions')
        .evaluateAll(async (els) =>
          Promise.all(els.flatMap((e) => e.getAnimations().map((a) => a.finished))),
        );
      await p.screenshot({ path: resolve(out, 'fractional-browser-win.png'), fullPage: true });
      await writeFile(
        resolve(out, 'fractional-win-receipt.json'),
        JSON.stringify({ level: edited, receipt, accepted, final, solveMs }, null, 2) + '\n',
      );
      healthy(h);
      return {
        realDOMInputs: accepted.length,
        pieces: 28,
        degrees: 0.25,
        simulatedSeconds: final.time,
        solveMs,
        oneWin: true,
        noStateInjection: true,
      };
    } finally {
      await context.close();
    }
  });
  await run('dense-three-piece-corners-real-time-browser-smoke', async () => {
    const h = await studio(),
      { page: p, context } = h;
    try {
      await p.locator('#shape').selectOption('hexagon');
      await slider(p, '#layers', 12);
      if (await p.locator('#equal-color-spans').isChecked())
        await p.locator('#equal-color-spans').uncheck();
      await slider(p, '#color-count', 3);
      await slider(p, '#segments-per-ring', 3);
      await slider(p, '#colors-per-ring', 3);
      await slider(p, '#visible-layers', 6);
      await fine(p, 0.1);
      const l = await level(p),
        m = new NativeModel(l);
      assert.equal(m.rings[0].segments[0].points.length, 81);
      await p.locator('#game').screenshot({ path: resolve(out, 'smooth-three-piece-hexagon.png') });
      const frame = p.frames().find((f) => f.url().includes('/dist/preview/a-heart.html'));
      const fixture = applyRingTemplate(l, {
        rings: Array.from({ length: 12 }, (_, r) => Array(3).fill(r < 6 ? 0 : 1)),
        palette: l.palette.slice(0, 2),
      });
      fixture.queue.sort((a, b) => b.color - a.color);
      await p.locator('#load-file').setInputFiles({
        name: 'collision-fixture.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(fixture)),
      });
      await p.waitForFunction(
        () =>
          document.querySelector('#game').contentWindow.__beatBloom.getLevel().palette.length === 2,
      );
      await frame.evaluate(() => __beatBloom.pause(false));
      for (const column of [0, 1, 2]) {
        await frame.waitForFunction(
          () => !__beatBloom.snapshot().balls.some((b) => b.state === 'incoming'),
        );
        await frame.locator(`.queue-ball:not(.future)[data-column="${column}"]`).click();
      }
      assert.equal((await frame.evaluate(() => __beatBloom.snapshot())).shots, 3);
      const timing = await frame.evaluate(
        () =>
          new Promise((resolve) => {
            const start = performance.now(),
              deltas = [];
            let last = start,
              maxActive = 0;
            function frame(now) {
              deltas.push(now - last);
              last = now;
              maxActive = Math.max(maxActive, __beatBloom.snapshot().active);
              if (now - start >= 2200) {
                __beatBloom.pause(true);
                const sorted = [...deltas].sort((a, b) => a - b);
                resolve({
                  wallMs: now - start,
                  frames: deltas.length,
                  p50ms: sorted[Math.floor(sorted.length * 0.5)],
                  p95ms: sorted[Math.floor(sorted.length * 0.95)],
                  maxFrameMs: sorted.at(-1),
                  maxActive,
                  state: __beatBloom.snapshot(),
                });
              } else requestAnimationFrame(frame);
            }
            requestAnimationFrame(frame);
          }),
      );
      await writeFile(resolve(out, 'raf-timing.json'), JSON.stringify(timing, null, 2) + '\n');
      assert.ok(
        timing.maxActive >= 3,
        'three launched balls must overlap in active state: ' + JSON.stringify(timing),
      );
      assert.ok(timing.frames > 15, 'catastrophic desktop rendering stall');
      assert.ok(timing.state.time > 1.5);
      healthy(h);
      await writeFile(
        resolve(out, 'collision-smoke-level.json'),
        JSON.stringify(fixture, null, 2) + '\n',
      );
      return {
        shape: 'hexagon',
        rings: 12,
        piecesPerRing: 3,
        pathPointsPerPiece: 81,
        fixture:
          'Valid queue reorder: three green balls collide with six visible red layers; no state injection.',
        timing,
      };
    } finally {
      await context.close();
    }
  });
} catch {
  process.exitCode = 1;
} finally {
  await browser.close();
  await writeFile(resolve(out, 'browser-results.json'), JSON.stringify(report, null, 2) + '\n');
}
