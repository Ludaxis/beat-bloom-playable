import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import sharp from 'sharp';

const origin = process.env.BEAT_BLOOM_QA_ORIGIN || 'http://127.0.0.1:4178';
const out = resolve(process.env.BEAT_BLOOM_QA_OUTPUT || 'qa/native/latest/export');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = {
  date: new Date().toISOString(),
  browser: browser.version(),
  platform: process.platform,
  method:
    'Independent desktop Chrome checks. Actual studio controls and downloads; exported HTML runs in an offline context with only the document and host-provided MRAID stub fulfilled. No production debug API is introduced.',
  cases: [],
  errors: [],
};
async function run(name, fn) {
  const start = Date.now();
  try {
    const detail = await fn();
    report.cases.push({ name, passed: true, seconds: (Date.now() - start) / 1000, ...detail });
    console.log('PASS', name, JSON.stringify(detail ?? {}));
  } catch (e) {
    report.cases.push({ name, passed: false, error: e.stack });
    report.errors.push(name);
    console.error('FAIL', name, e.message);
    throw e;
  }
}
async function makePage(viewport = { width: 576, height: 1280 }, options = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, ...options }),
    page = await context.newPage(),
    errors = [];
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.route('**/favicon.ico', (r) => r.fulfill({ status: 204, body: '' }));
  return { context, page, errors };
}
async function load(page, profile) {
  await page.goto(`${origin}/dist/preview/${profile}.html`);
  await page.waitForFunction(() => window.__beatBloom?.snapshot().ready);
}
async function slider(page, selector, value) {
  const control = page.locator(selector);
  await control.scrollIntoViewIfNeeded();
  const bounds = await control.evaluate((el) => ({ min: Number(el.min), max: Number(el.max) }));
  if (bounds.min === bounds.max) {
    assert.equal(Number(await control.inputValue()), value);
    return;
  }
  const box = await control.boundingBox(),
    ratio = (value - bounds.min) / (bounds.max - bounds.min);
  assert.ok(box);
  await page.mouse.click(box.x + 8 + ratio * (box.width - 16), box.y + box.height / 2);
  for (let i = 0; i < 30 && Number(await control.inputValue()) !== value; i++)
    await control.press(Number(await control.inputValue()) < value ? 'ArrowRight' : 'ArrowLeft');
  assert.equal(Number(await control.inputValue()), value);
}
async function fieldMask(png) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true }),
    mask = [];
  for (
    let y = Math.round((info.height * 240) / 1280);
    y < Math.round((info.height * 810) / 1280);
    y++
  )
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels;
      mask.push(Math.max(data[i], data[i + 1], data[i + 2]) > 115 ? 1 : 0);
    }
  return mask;
}
function exportedHTML(bytes, format) {
  if (format === 'html') return bytes.toString('utf8');
  const entries = unzipSync(bytes);
  assert.deepEqual(Object.keys(entries), ['index.html']);
  return Buffer.from(entries['index.html']).toString('utf8');
}
function metadata(html) {
  const match = html.match(/<script[^>]*id=["']beatbloom-export["'][^>]*>([\s\S]*?)<\/script>/i);
  assert.ok(match, 'export must identify the exact packaged level with inert JSON metadata');
  return JSON.parse(match[1]);
}
async function downloadCurrentLevel(page) {
  const downloading = page.waitForEvent('download', { timeout: 120000 });
  // Surface an API refusal immediately instead of waiting two minutes for a nonexistent file.
  const responseEvent = page.waitForResponse(
    (r) => r.url() === origin + '/api/export' && r.request().method() === 'POST',
    { timeout: 120000 },
  );
  downloading.catch(() => {});
  await page.locator('#export-playable').click();
  const response = await responseEvent;
  assert.ok(
    response.ok(),
    `export API ${response.status()}: ${response.ok() ? '' : await response.text()}`,
  );
  return await downloading;
}
const storeURLs = {
  ios: 'https://apps.apple.com/app/id1234567890',
  android: 'https://play.google.com/store/apps/details?id=com.example.beatbloom.qa',
};
async function verifyOfflineExport(html, network, level, referenceMask, ios = false) {
  const options = ios
    ? {
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
      }
    : {};
  const { context, page, errors } = await makePage({ width: 576, height: 1280 }, options),
    blocked = [],
    entry = `http://playable-qa.invalid/${network}.html`;
  try {
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url === entry)
        return route.fulfill({ status: 200, contentType: 'text/html', body: html });
      if (url.endsWith('/mraid.js'))
        return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
      if (url.endsWith('/favicon.ico')) return route.fulfill({ status: 204, body: '' });
      blocked.push(url);
      return route.abort();
    });
    await page.addInitScript(
      ({ network }) => {
        const h = (window.__host = { exits: [], contexts: [], hidden: true });
        const Audio = window.AudioContext;
        window.AudioContext = class extends Audio {
          constructor(...args) {
            super(...args);
            h.contexts.push(this);
          }
        };
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => h.hidden });
        const listeners = {};
        let ready = false,
          view = false;
        if (network === 'meta') window.FbPlayableAd = { onCTAClick: () => h.exits.push('meta') };
        else
          window.mraid = {
            getState: () => (ready ? 'default' : 'loading'),
            isViewable: () => view,
            open: (url) => h.exits.push(url),
            addEventListener: (name, fn) => (listeners[name] ??= []).push(fn),
            removeEventListener: () => {},
          };
        h.prepare = () => {
          ready = true;
          (listeners.ready ?? []).forEach((f) => f());
        };
        h.activate = () => {
          h.hidden = false;
          ready = true;
          view = true;
          (listeners.ready ?? []).forEach((f) => f());
          (listeners.viewableChange ?? []).forEach((f) => f(true));
          document.dispatchEvent(new Event('visibilitychange'));
        };
        h.visibility = (visible) => {
          h.hidden = !visible;
          view = visible;
          (listeners.viewableChange ?? []).forEach((f) => f(visible));
          document.dispatchEvent(new Event('visibilitychange'));
        };
      },
      { network },
    );
    await context.setOffline(true);
    await page.goto(entry);
    if (network !== 'meta') {
      assert.equal(await page.locator('.canvas canvas').count(), 0);
      await page.evaluate(() => __host.prepare());
    }
    await page.locator('.loading').waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => typeof window.__beatBloom), 'undefined');
    assert.equal(await page.locator('.game h1,.settings,.settings-button,.booster').count(), 0);
    // The runtime replaces document.body when it builds the game; inspect the original inert
    // metadata, then independently verify the actual queue and board rendered from that level.
    const meta = metadata(html);
    assert.deepEqual(meta.level, level);
    assert.equal(meta.network, network);
    assert.equal(meta.profile, 'a-heart');
    assert.deepEqual(meta.storeURLs, network === 'meta' ? null : storeURLs);
    const fronts = await page.locator('.queue-ball:not(.future)').evaluateAll((els) =>
      els.map((el) => ({
        power: Number(el.textContent),
        color: getComputedStyle(el).backgroundColor,
      })),
    );
    assert.deepEqual(
      fronts,
      level.queue.slice(0, 3).map((q) => {
        const rgb = level.palette[q.color];
        return { power: q.power, color: `rgb(${rgb >> 16}, ${(rgb >> 8) & 255}, ${rgb & 255})` };
      }),
    );
    const canvas = await page.locator('.canvas canvas').screenshot(),
      match = overlap(referenceMask, await fieldMask(canvas));
    assert.ok(
      match.iou > 0.97,
      `exported board must match edited preview geometry and palette: ${JSON.stringify(match)}`,
    );
    await page.screenshot({
      path: resolve(out, `export-${network}-${ios ? 'ios' : 'android'}.png`),
    });
    assert.equal(await page.evaluate(() => __host.contexts.length), 0);
    assert.equal(await page.evaluate(() => __host.exits.length), 0);
    await page.evaluate(() => __host.activate());
    await page.locator('.queue-ball:not(.future)[data-column="0"]').click();
    await page.waitForFunction(() => window.__host.contexts[0]?.state === 'running');
    await page.waitForFunction(() => document.querySelector('.capacity').textContent === '1/3');
    assert.equal(
      await page.evaluate(() => __host.exits.length),
      0,
      'gameplay must not trigger store exit',
    );
    await page.evaluate(() => __host.visibility(false));
    await page.waitForFunction(() => __host.contexts[0].state === 'suspended');
    await page.evaluate(() => __host.visibility(true));
    await page.waitForFunction(() => __host.contexts[0].state === 'running');
    // This isolates the already-existing CTA route, without claiming that this export reached a win.
    // The separate native harness checks ordinary full gameplay completion.
    await page.locator('.result').evaluate((el) => {
      el.hidden = false;
    });
    await page.locator('.continue').dblclick({ delay: 60 });
    assert.deepEqual(await page.evaluate(() => __host.exits), [
      network === 'meta' ? 'meta' : ios ? storeURLs.ios : storeURLs.android,
    ]);
    assert.deepEqual(blocked, []);
    assert.deepEqual(errors, []);
    return {
      emulatedUserAgent: ios ? 'iOS' : 'desktop/Android route',
      offline: true,
      boardMaskIoU: match.iou,
      actualEditedQueueAndColors: true,
      audioGestureAndVisibility: true,
      explicitCTA: true,
      debounced: true,
      productionDebugAbsent: true,
      externalAssets: 0,
      notPhysicalDeviceOrNetworkCertification: true,
    };
  } finally {
    await context.close();
  }
}
function overlap(a, b) {
  assert.equal(a.length, b.length);
  let intersection = 0,
    union = 0;
  for (let i = 0; i < a.length; i++) {
    intersection += a[i] && b[i] ? 1 : 0;
    union += a[i] || b[i] ? 1 : 0;
  }
  return { intersection, union, iou: intersection / Math.max(1, union) };
}
function checkPower(level) {
  assert.equal(level.queuePolicy, 'fixed-three');
  assert.ok(level.queue.every((q) => q.power === 3 && q.mystery === false));
  for (let c = 0; c < level.palette.length; c++)
    assert.equal(
      level.queue.filter((q) => q.color === c).length,
      Math.ceil(level.rings.flat().filter((x) => x === c).length / 3),
    );
}
async function centerMeasurement(page, count) {
  const result = await page.locator('.game').evaluate((el) => {
    const box = el.getBoundingClientRect(),
      scale = box.width / 576;
    const items = [...el.querySelectorAll('.band-item')].map((n) => {
      const b = n.getBoundingClientRect();
      return {
        instrument: n.dataset.instrument,
        center: (b.x + b.width / 2 - box.x) / scale,
        left: (b.x - box.x) / scale,
        right: (b.x + b.width - box.x) / scale,
      };
    });
    return {
      items,
      center: items.reduce((n, item) => n + item.center, 0) / items.length,
      left: Math.min(...items.map((i) => i.left)),
      right: Math.max(...items.map((i) => i.right)),
    };
  });
  assert.equal(result.items.length, count);
  assert.ok(Math.abs(result.center - 288) < 0.1, JSON.stringify(result));
  // Source-calibrated piano/drum artwork uses different container widths. Anchor layout is
  // exactly centered; the visible containers may be up to four pixels optically asymmetric.
  result.outerBoundsCenter = (result.left + result.right) / 2;
  assert.ok(Math.abs(result.outerBoundsCenter - 288) <= 4.1, JSON.stringify(result));
  assert.ok(result.left >= 0 && result.right <= 576);
  for (let i = 1; i < count; i++)
    assert.ok(
      result.items[i].left >= result.items[i - 1].right - 1,
      'performer containers must not overlap',
    );
  return result;
}

try {
  await run('two-and-four-instrument-groups-centered', async () => {
    const { page, context, errors } = await makePage();
    try {
      const profiles = [];
      for (const [profile, count] of [
        ['a-heart', 2],
        ['a-flower', 4],
        ['native', 4],
      ]) {
        await load(page, profile);
        await page.evaluate(() => {
          __beatBloom.pause(true);
          __beatBloom.restart();
        });
        const measurement = await centerMeasurement(page, count);
        await page.screenshot({ path: resolve(out, `centered-${profile}.png`) });
        profiles.push({ profile, ...measurement });
      }
      assert.deepEqual(errors, []);
      return { profiles };
    } finally {
      await context.close();
    }
  });
  const studio = await makePage({ width: 1440, height: 1000 });
  let edited, referenceMask;
  try {
    await run('petals-explanation-switch-and-actual-geometry', async () => {
      const { page } = studio;
      await page.goto(origin + '/');
      await page.waitForFunction(
        () => document.querySelector('#game')?.contentWindow?.__beatBloom?.snapshot().ready,
      );
      await page.locator('#profile').selectOption('a-heart');
      await page.waitForFunction(() => {
        const text = document.querySelector('#level-json').value;
        if (text.length < 2) return false;
        return (
          document.querySelector('#game')?.contentWindow?.__beatBloom?.getLevel().songId ===
            'nobatidao' && JSON.parse(text).songId === 'nobatidao'
        );
      });
      const game = () =>
        page.evaluate(() => document.querySelector('#game').contentWindow.__beatBloom.getLevel());
      await page.locator('#pause').click();
      assert.equal(await page.locator('#petals-control').isVisible(), false);
      assert.equal(await page.locator('#petals').isDisabled(), true);
      assert.equal(await page.locator('#petals-unavailable').isVisible(), true);
      assert.match(await page.locator('#petals-unavailable').textContent(), /Flower/);
      assert.match(await page.locator('#petals-unavailable').textContent(), /apply/);
      await page.locator('#shape').selectOption('flower');
      assert.equal((await game()).shape, 'flower');
      assert.equal(await page.locator('#petals-control').isVisible(), true);
      assert.equal(await page.locator('#petals-unavailable').isVisible(), false);
      assert.equal(await page.locator('#petals').isEnabled(), true);
      assert.equal(await page.locator('#petals').getAttribute('min'), '3');
      assert.equal(await page.locator('#petals').getAttribute('max'), '9');
      const masks = [];
      for (const count of [3, 9]) {
        await slider(page, '#petals', count);
        assert.equal((await game()).flowerPetals, count);
        const png = await page.frameLocator('#game').locator('.canvas canvas').screenshot();
        await writeFile(resolve(out, `flower-${count}-petals.png`), png);
        masks.push(await fieldMask(png));
      }
      const change = overlap(...masks);
      assert.ok(change.union > 1000);
      assert.ok(
        change.iou < 0.85,
        'changing petals must visibly change the actual contour, not only the label',
      );
      await slider(page, '#petals', 7);
      await slider(page, '#layers', 7);
      await slider(page, '#visible-layers', 4);
      await slider(page, '#thickness', 12);
      if (
        (await page.locator('#advanced-pattern').count()) &&
        !(await page.locator('#advanced-pattern').evaluate((el) => el.open))
      )
        await page.locator('#advanced-pattern > summary').click();
      await page.locator('[aria-label="First color"]').fill('#be12d7');
      await page.locator('[aria-label="First color"]').dispatchEvent('change');
      edited = await game();
      assert.equal(edited.shape, 'flower');
      assert.equal(edited.flowerPetals, 7);
      assert.equal(edited.rings.length, 7);
      assert.equal(edited.arenaRingCapacity, 4);
      assert.equal(edited.palette[0], 0xbe12d7);
      assert.ok(Math.abs(edited.lineThickness - 12 / 49) < 1e-10);
      checkPower(edited);
      await page.locator('#export-tab').click();
      await page.locator('.store-destinations summary').click();
      await page.locator('#store-ios').fill(storeURLs.ios);
      await page.locator('#store-android').fill(storeURLs.android);
      assert.equal(await page.locator('#export-format').inputValue(), 'html');
      await writeFile(resolve(out, 'edited-level.json'), JSON.stringify(edited, null, 2) + '\n');
      await page.screenshot({ path: resolve(out, 'studio-current-edit.png'), fullPage: true });
      assert.deepEqual(studio.errors, []);
      const reference = await makePage();
      try {
        await load(reference.page, 'a-heart');
        await reference.page.evaluate((level) => {
          __beatBloom.pause(true);
          __beatBloom.setLevel(level);
        }, edited);
        const png = await reference.page.locator('.canvas canvas').screenshot();
        await writeFile(resolve(out, 'edited-preview-field.png'), png);
        referenceMask = await fieldMask(png);
        assert.deepEqual(reference.errors, []);
      } finally {
        await reference.context.close();
      }
      return {
        unavailableExplanation: true,
        switchToFlower: true,
        petalEndpoints: [3, 9],
        changedGeometryMaskIoU: change.iou,
        editedShape: edited.shape,
        editedLayers: 7,
        editedInnerVisibleLayers: 4,
        editedPetals: 7,
        editedPalette: true,
        powerBalanced: true,
        defaultFormat: 'html',
      };
    });
    for (const network of ['unity', 'applovin', 'meta'])
      await run(`current-edited-level-download-${network}`, async () => {
        const { page } = studio;
        await page.locator('#export-network').selectOption(network);
        const download = await downloadCurrentLevel(page);
        assert.match(download.suggestedFilename(), /\.html$/);
        const path = resolve(out, `download-${network}.html`);
        await download.saveAs(path);
        assert.equal(await download.failure(), null);
        const bytes = await readFile(path),
          html = exportedHTML(bytes, 'html'),
          meta = metadata(html),
          cap = network === 'meta' ? 2_000_000 : 5_000_000;
        assert.ok(bytes.length < cap);
        assert.deepEqual(meta.level, edited);
        assert.equal(meta.network, network);
        assert.equal(meta.profile, 'a-heart');
        assert.deepEqual(meta.storeURLs, network === 'meta' ? null : storeURLs);
        const hostChecks = [await verifyOfflineExport(html, network, edited, referenceMask)];
        if (network !== 'meta')
          hostChecks.push(await verifyOfflineExport(html, network, edited, referenceMask, true));
        assert.deepEqual(studio.errors, []);
        return {
          file: path,
          format: 'html',
          bytes: bytes.length,
          limitBytes: cap,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          exactEditedLevel: true,
          hostChecks,
        };
      });
    await run('current-edited-level-zip-download', async () => {
      const { page } = studio;
      await page.locator('#export-network').selectOption('unity');
      await page.locator('#export-format').selectOption('zip');
      const download = await downloadCurrentLevel(page);
      assert.match(download.suggestedFilename(), /\.zip$/);
      const path = resolve(out, 'download-unity.zip');
      await download.saveAs(path);
      const bytes = await readFile(path),
        html = exportedHTML(bytes, 'zip');
      assert.deepEqual(metadata(html).level, edited);
      assert.ok(Buffer.byteLength(html) < 5_000_000);
      assert.deepEqual(studio.errors, []);
      return {
        file: path,
        zipBytes: bytes.length,
        indexHTMLBytes: Buffer.byteLength(html),
        onlyIndexHTML: true,
        exactEditedLevel: true,
      };
    });
    await run('edited-exported-puzzle-completes-through-public-inputs', async () => {
      const { page, context, errors } = await makePage();
      try {
        await load(page, 'a-heart');
        await page.evaluate((level) => {
          __beatBloom.pause(true);
          __beatBloom.setLevel(level);
        }, edited);
        const state = () => page.evaluate(() => __beatBloom.snapshot());
        let last = edited.rings.flat().filter((c) => c >= 0).length,
          lastAt = 0,
          next = 0;
        for (let i = 0; i < 880; i++) {
          const s = await state();
          if (s.status !== 'playing') break;
          if (s.remaining !== last) {
            last = s.remaining;
            lastAt = s.time;
          }
          if (s.time >= next && (s.active < 3 || (s.time - lastAt > 8 && s.tray < 3))) {
            const wanted = s.rings.find((r) => r.eligible && r.colors.length)?.colors ?? [],
              stored = s.balls.find((b) => b.state === 'stored' && wanted.includes(b.color)),
              fronts = s.queueBalls.filter((q) => q.row === 0),
              queued = fronts.find((q) => wanted.includes(q.color)) ?? fronts[0];
            if (stored) await page.locator(`[data-tray="${stored.slot}"]`).click();
            else if (queued)
              await page
                .locator(`.queue-ball:not(.future)[data-column="${queued.column}"]`)
                .click();
            next = s.time + 1;
          }
          await page.evaluate(() => __beatBloom.step(0.25));
        }
        const s = await state(),
          total = edited.rings.flat().filter((c) => c >= 0).length;
        assert.equal(s.status, 'won', JSON.stringify(s));
        assert.equal(s.remaining, 0);
        const events = await page.evaluate(() => __beatBloom.events());
        assert.equal(events.filter((e) => e.type === 'break').length, total);
        assert.equal(
          new Set(events.filter((e) => e.type === 'break').map((e) => e.segmentId)).size,
          total,
        );
        assert.equal(events.filter((e) => e.type === 'win').length, 1);
        await page.evaluate(() => __beatBloom.step(4.2));
        assert.equal(await page.locator('.result').isVisible(), true);
        await page.screenshot({ path: resolve(out, 'edited-level-completed.png') });
        assert.deepEqual(errors, []);
        return {
          sameExportedLevel: true,
          ordinaryQueueAndTrayClicks: true,
          simulatedSeconds: s.time,
          shots: s.shots,
          uniqueBreaks: total,
          completionEvents: 1,
          noForcedCompletion: true,
        };
      } finally {
        await context.close();
      }
    });
  } finally {
    await studio.context.close();
  }
} catch {
  process.exitCode = 1;
} finally {
  await browser.close();
  await writeFile(resolve(out, 'browser-results.json'), JSON.stringify(report, null, 2) + '\n');
}
