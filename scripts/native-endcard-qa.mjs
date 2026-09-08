import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const origin = process.env.BEAT_BLOOM_QA_ORIGIN || 'http://127.0.0.1:4178';
const out = resolve(process.env.BEAT_BLOOM_QA_OUTPUT || 'qa/native/latest/endcard');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const report = {
  date: new Date().toISOString(),
  browser: browser.version(),
  platform: process.platform,
  method:
    'Ordinary 96-piece preview playthroughs, explicit preview install/replay checks, three minimal authored production puzzles completed by real-time input, and separately identified isolated CTA checks for twelve prebuilt exports. No production debug API or forced win is added.',
  cases: [],
  errors: [],
};
const profiles = ['a-heart', 'a-flower', 'b-heart', 'b-flower'];
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const approved = {
  icon: sha(await readFile('assets/icon.webp')),
  logo: sha(await readFile('assets/logo.webp')),
};
const resultConcept = (profile) =>
  profile.startsWith('b-') ? 'Tagline0Logo' : 'Footer0FreeToPlay';
const noMystery = '.mystery,.mystery-intro,.mystery-title,.mystery-orb,.intro-close';
const resumeFrom = process.argv.find((arg) => arg.startsWith('--from='))?.slice(7);
let reachedResume = !resumeFrom;
async function run(name, fn) {
  if (!reachedResume && name !== resumeFrom) return;
  reachedResume = true;
  const t = Date.now();
  try {
    const detail = await fn();
    report.cases.push({ name, passed: true, seconds: (Date.now() - t) / 1000, ...detail });
    console.log('PASS', name, JSON.stringify(detail ?? {}));
  } catch (error) {
    report.cases.push({ name, passed: false, error: error.stack });
    report.errors.push(name);
    console.error('FAIL', name, error.message);
    throw error;
  }
}
async function makePage(viewport = { width: 390, height: 844 }, options = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, ...options }),
    page = await context.newPage(),
    errors = [];
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.route('**/favicon.ico', (r) => r.fulfill({ status: 204, body: '' }));
  return { page, context, errors };
}
async function load(page, profile, suffix = '') {
  await page.goto(`${origin}/dist/preview/${profile}.html${suffix}`);
  await page.waitForFunction(() => window.__beatBloom?.snapshot().ready);
}
const snapshot = (page) => page.evaluate(() => __beatBloom.snapshot());
function plainQueue(level) {
  return level.queue.map(({ mystery, ...rest }) => rest);
}
function assertFixedQueue(level) {
  assert.equal(level.queuePolicy, 'fixed-three');
  assert.ok(level.queue.every((q) => q.power === 3 && q.mystery === false));
  for (let color = 0; color < level.palette.length; color++)
    assert.equal(
      level.queue.filter((q) => q.color === color).length,
      Math.ceil(level.rings.flat().filter((c) => c === color).length / 3),
    );
}
async function assertNoMystery(page) {
  assert.equal(await page.locator(noMystery).count(), 0);
  assert.equal(await page.locator('.queue img').count(), 0);
  for (const label of await page.locator('.queue-ball').allTextContents())
    assert.match(label.trim(), /^\d+$/, 'every queued ball exposes ordinary power text');
  for (const label of await page
    .locator('.queue-ball')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label'))))
    assert.doesNotMatch(label, /mystery|unknown/i);
}
async function checkBrand(page, profile, { exactAssets = true, visible = true } = {}) {
  assert.equal(await page.locator('.result').getAttribute('data-concept'), resultConcept(profile));
  assert.equal((await page.locator('.continue').textContent()).trim(), 'Install Now');
  assert.equal((await page.locator('.result-restart').textContent()).trim(), 'Replay');
  const artwork = {};
  for (const name of ['icon', 'logo']) {
    const image = page.locator(`.result-${name}`);
    assert.equal(await image.count(), 1);
    await image.evaluate(async (el) => {
      if (!el.complete) await el.decode();
    });
    assert.ok(await image.evaluate((el) => el.naturalWidth > 0 && el.naturalHeight > 0));
    const src = await image.getAttribute('src');
    assert.match(src, /^data:image\//);
    artwork[name] = sha(Buffer.from(src.split(',')[1], 'base64'));
    if (exactAssets)
      assert.equal(artwork[name], approved[name], `use the existing approved ${name}`);
    if (visible) assert.equal(await image.isVisible(), true);
  }
  assert.equal(
    await page.locator('.word').count(),
    0,
    'old multicolor Unity letter art must not appear',
  );
  assert.equal(
    await page.locator('.celebration-logo').getAttribute('src'),
    await page.locator('.result-logo').getAttribute('src'),
    'pre-endcard celebration uses the same approved Figma logo',
  );
  if (profile.startsWith('b-')) {
    assert.equal(await page.locator('.free-to-play').count(), 0);
    assert.ok((await page.locator('.result h2').textContent()).trim().length > 5);
  } else assert.equal((await page.locator('.free-to-play').textContent()).trim(), 'FREE TO PLAY');
  return artwork;
}
async function checkLayout(page, profile, suffix) {
  await page.locator('.endcard-content,.endcard-actions').evaluateAll(async (els) => {
    await Promise.all(
      els.flatMap((el) => el.getAnimations().map((animation) => animation.finished)),
    );
  });
  const viewport = page.viewportSize(),
    boxes = {};
  for (const selector of [
    '.result-icon',
    '.result-logo',
    '.result h2',
    '.continue',
    '.result-restart',
    ...(profile.startsWith('b-') ? [] : ['.free-to-play']),
  ]) {
    const box = await page.locator(selector).boundingBox();
    assert.ok(box, selector + ' must be visible');
    assert.ok(
      box.x >= -0.5 &&
        box.y >= -0.5 &&
        box.x + box.width <= viewport.width + 0.5 &&
        box.y + box.height <= viewport.height + 0.5,
      `${selector} clips at ${JSON.stringify(viewport)}: ${JSON.stringify(box)}`,
    );
    boxes[selector] = box;
  }
  assert.ok(boxes['.continue'].height >= 44, 'Install Now must retain a 44px tap height');
  assert.ok(boxes['.continue'].width >= 120);
  await page.screenshot({ path: resolve(out, `${profile}-${suffix}.png`) });
  return { viewport, boxes };
}
async function completePreview(page) {
  await page.evaluate(() => {
    __beatBloom.pause(true);
    __beatBloom.restart();
  });
  let last = 96,
    lastAt = 0,
    next = 0;
  for (let i = 0; i < 960; i++) {
    const s = await snapshot(page);
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
        await page.locator(`.queue-ball:not(.future)[data-column="${queued.column}"]`).click();
      next = s.time + 1;
    }
    await page.evaluate(() => __beatBloom.step(0.25));
  }
  const s = await snapshot(page);
  assert.equal(s.status, 'won', JSON.stringify(s));
  assert.equal(s.remaining, 0);
  const events = await page.evaluate(() => __beatBloom.events());
  assert.equal(events.filter((e) => e.type === 'break').length, 96);
  assert.equal(new Set(events.filter((e) => e.type === 'break').map((e) => e.segmentId)).size, 96);
  assert.equal(events.filter((e) => e.type === 'win').length, 1);
  await page.evaluate(() => __beatBloom.step(5));
  await page.locator('.result').waitFor({ state: 'visible' });
  return { simulatedSeconds: s.time, shots: s.shots, uniquePieces: 96 };
}
function metadata(html) {
  const m = html.match(/<script[^>]*id=["']beatbloom-export["'][^>]*>([\s\S]*?)<\/script>/i);
  assert.ok(m);
  return JSON.parse(m[1]);
}
async function hostedPage(network, { html = null, profile = 'a-heart', ios = false } = {}) {
  const host = await makePage(
      { width: 390, height: 844 },
      ios
        ? {
            userAgent:
              'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
          }
        : {},
    ),
    { page, context } = host,
    requests = [];
  await page.addInitScript(
    ({ network }) => {
      const h = (window.__endcardHost = { exits: [], contexts: [], hidden: true });
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
        (listeners.ready ?? []).forEach((fn) => fn());
      };
      h.activate = () => {
        h.hidden = false;
        view = true;
        ready = true;
        (listeners.ready ?? []).forEach((fn) => fn());
        (listeners.viewableChange ?? []).forEach((fn) => fn(true));
        document.dispatchEvent(new Event('visibilitychange'));
      };
    },
    { network },
  );
  const entry = html
    ? `http://endcard-qa.invalid/${network}-${profile}.html`
    : `${origin}/dist/${network}/${profile}.html`;
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.endsWith('/favicon.ico')) return route.fulfill({ status: 204, body: '' });
    if (url.endsWith('/mraid.js'))
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
    if (url === entry)
      return html
        ? route.fulfill({ status: 200, contentType: 'text/html', body: html })
        : route.continue();
    requests.push(url);
    return route.abort();
  });
  if (html) await context.setOffline(true);
  await page.goto(entry);
  if (network !== 'meta') {
    assert.equal(await page.locator('.canvas canvas').count(), 0);
    await page.evaluate(() => __endcardHost.prepare());
  }
  await page.locator('.loading').waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => typeof window.__beatBloom), 'undefined');
  await assertNoMystery(page);
  return { ...host, requests, entry };
}
async function assertHostInstall(page, network, url) {
  assert.equal(await page.evaluate(() => __endcardHost.exits.length), 0);
  await page.locator('.continue').dblclick({ delay: 60 });
  assert.deepEqual(await page.evaluate(() => __endcardHost.exits), [
    network === 'meta' ? 'meta' : url,
  ]);
}
const layouts = {},
  levelSamples = {};
try {
  await run('approved-figma-brand-source-provenance', async () => {
    const provenance = JSON.parse(await readFile('assets/provenance.json', 'utf8')),
      records = [];
    for (const [name, node, expected] of [
      ['icon', '2011-47202', 'c8f788521ba4ec36ac430da79cd147e2c865ebe068e4cd6c372c94b9bf539618'],
      ['logo', '6-2443', 'e74ce21723fbd1cef66f031340a219c80bc8ed3d07988a48f15c8cffd3929021'],
    ]) {
      const record = provenance.assets.find((a) => a.output === `${name}.webp`);
      assert.ok(record);
      assert.equal(new URL(record.approvedFigmaNode).searchParams.get('node-id'), node);
      assert.match(record.source, /assets\/source\/brand\/figma-/);
      const source = await readFile(resolve(record.source.replace(/^Playables\/beat-bloom\//, ''))),
        output = await readFile(`assets/${name}.webp`);
      assert.equal(sha(source), expected);
      assert.equal(record.sourceSha256, expected);
      assert.equal(record.outputBytes, output.length);
      const info = await sharp(output).metadata();
      assert.equal(info.width, name === 'icon' ? 320 : 640);
      records.push({
        name,
        node,
        url: record.approvedFigmaNode,
        source: record.source,
        sourceSHA256: expected,
        outputSHA256: sha(output),
        outputBytes: output.length,
        width: info.width,
        height: info.height,
      });
    }
    await writeFile(resolve(out, 'brand-provenance.json'), JSON.stringify(records, null, 2) + '\n');
    return { records };
  });
  await run('all-five-preview-profiles-remove-and-normalize-mystery-balls', async () => {
    const { page, context, errors } = await makePage();
    try {
      const results = [];
      for (const profile of ['native', ...profiles]) {
        await load(page, profile, '?intro=1');
        await assertNoMystery(page);
        await checkBrand(page, profile, { visible: false });
        if (profile === 'native') {
          await page.waitForFunction(() => __beatBloom.snapshot().time > 1.7, undefined, {
            timeout: 6000,
          });
          assert.equal((await snapshot(page)).paused, false);
        }
        const r = await page.evaluate(() => {
          __beatBloom.pause(true);
          const current = __beatBloom.getLevel(),
            legacy = structuredClone(current);
          legacy.queue.forEach((q) => (q.mystery = true));
          const returned = __beatBloom.setLevel(legacy);
          return {
            current,
            legacy,
            returned,
            after: __beatBloom.getLevel(),
            queueBalls: __beatBloom.snapshot().queueBalls,
          };
        });
        assertFixedQueue(r.current);
        assertFixedQueue(r.after);
        assert.ok(r.current.queue.every((q) => q.mystery === false));
        assert.ok(r.after.queue.every((q) => q.mystery === false));
        assert.deepEqual(r.returned, r.after);
        assert.deepEqual(r.after, r.current);
        assert.deepEqual(plainQueue(r.after), plainQueue(r.legacy));
        assert.deepEqual(plainQueue(r.after), plainQueue(r.current));
        assert.ok(r.queueBalls.every((q) => q.mystery === false));
        assert.equal(
          r.after.rings.flat().filter((c) => c >= 0).length,
          r.current.rings.flat().filter((c) => c >= 0).length,
        );
        if (profile !== 'native')
          assert.equal(r.after.rings.flat().filter((c) => c >= 0).length, 96);
        await assertNoMystery(page);
        if (profile !== 'native') {
          assert.equal(r.after.shape, profile.endsWith('flower') ? 'flower' : 'heart');
          assert.equal(r.after.songId, profile.endsWith('flower') ? 'sunflower' : 'nobatidao');
        }
        levelSamples[profile] = r.after;
        await page.screenshot({ path: resolve(out, `plain-balls-${profile}.png`) });
        results.push({
          profile,
          song: r.after.songId,
          shape: r.after.shape,
          queueBalls: r.after.queue.length,
          allFlagsPlain: true,
          ammunitionAndOrderPreserved: true,
        });
      }
      assert.deepEqual(errors, []);
      return { profiles: results, legacyIntroQueryIgnored: true };
    } finally {
      await context.close();
    }
  });
  for (const profile of profiles)
    await run(`ordinary-completion-preview-install-and-replay-${profile}`, async () => {
      const { page, context, errors } = await makePage();
      try {
        await load(page, profile);
        const playthrough = await completePreview(page),
          artwork = await checkBrand(page, profile);
        await page.waitForTimeout(300);
        const measured = [];
        for (const [width, height] of [
          [390, 844],
          [320, 568],
          [844, 390],
          [568, 320],
        ]) {
          await page.setViewportSize({ width, height });
          await page.waitForTimeout(60);
          measured.push(await checkLayout(page, profile, `endcard-${width}x${height}`));
        }
        layouts[profile] = measured[0];
        const before = await snapshot(page),
          url = page.url();
        await page.locator('.continue').click();
        await page.locator('.announcement').waitFor({ state: 'visible' });
        assert.equal(page.url(), url);
        assert.equal(context.pages().length, 1);
        const after = await snapshot(page);
        for (const key of ['status', 'remaining', 'shots', 'queue'])
          assert.equal(after[key], before[key]);
        assert.equal(await page.locator('.result').isVisible(), true);
        const announcement = await page.locator('.announcement').evaluate((el) => {
          // Toasts intentionally ignore pointers. Briefly include this element in hit testing,
          // restoring its style in the same JS call; this checks occlusion without changing its pixels.
          const r = el.getBoundingClientRect(),
            pointer = el.style.pointerEvents;
          try {
            el.style.pointerEvents = 'auto';
            const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            return { text: el.textContent, onTop: top === el || el.contains(top) };
          } finally {
            el.style.pointerEvents = pointer;
          }
        });
        assert.ok(announcement.text.trim());
        assert.equal(
          announcement.onTop,
          true,
          'preview install confirmation must appear above the end card',
        );
        await page.screenshot({
          path: resolve(out, `${profile}-preview-install-confirmation.png`),
        });
        await page.locator('.result-restart').click();
        const reset = await snapshot(page);
        assert.equal(reset.remaining, 96);
        assert.equal(reset.shots, 0);
        assert.equal(reset.status, 'playing');
        assert.equal(await page.locator('.result').isVisible(), false);
        await assertNoMystery(page);
        assert.deepEqual(errors, []);
        return {
          ...playthrough,
          concept: resultConcept(profile),
          approvedArtwork: artwork,
          layouts: measured,
          previewInstallAnnouncesOnly: true,
          replayResets: true,
        };
      } finally {
        await context.close();
      }
    });
  await run('concepts-have-distinct-layout-hierarchy', async () => {
    const a = layouts['a-heart'].boxes,
      b = layouts['b-heart'].boxes,
      difference = ['.result-icon', '.result-logo', '.result h2'].reduce(
        (n, s) => n + Math.abs(a[s].y - b[s].y),
        0,
      );
    assert.ok(
      difference > 30,
      'concept A and B must differ structurally, not only by a hidden data attribute',
    );
    return { anchorYDifferencePixels: difference, footerOnlyInA: true };
  });
  await run('studio-preview-end-card-control', async () => {
    const { page, context, errors } = await makePage({ width: 1440, height: 1000 });
    try {
      await page.goto(origin + '/');
      await page.waitForFunction(
        () => document.querySelector('#game')?.contentWindow?.__beatBloom?.snapshot().ready,
      );
      await page.locator('#profile').selectOption('a-flower');
      await page.waitForFunction(
        () =>
          document.querySelector('#game')?.contentWindow?.__beatBloom?.getLevel().songId ===
            'sunflower' &&
          JSON.parse(document.querySelector('#level-json').value || '{}').songId === 'sunflower',
      );
      await page.locator('#pause').click();
      const frame = page.frames().find((f) => f.url().includes('/dist/preview/a-flower.html'));
      assert.ok(frame);
      const before = await frame.evaluate(() => __beatBloom.snapshot()),
        url = frame.url();
      await page.locator('#design-tab').click();
      await frame.locator('.result').waitFor({ state: 'visible' });
      await checkBrand(frame, 'a-flower');
      assert.equal(
        (await frame.evaluate(() => __beatBloom.snapshot())).status,
        'playing',
        'the editor preview must not fabricate a win',
      );
      await frame.locator('.continue').click();
      assert.equal(frame.url(), url);
      assert.equal(context.pages().length, 1);
      const after = await frame.evaluate(() => __beatBloom.snapshot());
      for (const key of ['status', 'remaining', 'shots', 'queue'])
        assert.equal(after[key], before[key]);
      await frame.locator('.announcement').waitFor({ state: 'visible' });
      await page.screenshot({ path: resolve(out, 'studio-end-card-preview.png'), fullPage: true });
      await frame.locator('.result-restart').click();
      assert.equal(await frame.locator('.result').isVisible(), false);
      assert.equal((await frame.evaluate(() => __beatBloom.snapshot())).shots, 0);
      await page.waitForFunction(
        () => document.querySelector('#gameplay-tab').getAttribute('aria-selected') === 'true',
      );
      assert.deepEqual(errors, []);
      return {
        actualStudioButton: true,
        profile: 'a-flower',
        doesNotFabricateWin: true,
        installAnnouncesOnly: true,
        replayReturnsToGameplay: true,
      };
    } finally {
      await context.close();
    }
  });
  for (const [network, profile, ios] of [
    ['unity', 'a-heart', true],
    ['applovin', 'b-flower', false],
    ['meta', 'b-heart', false],
  ])
    await run(`actual-production-completion-install-replay-${network}`, async () => {
      const level = structuredClone(
        levelSamples[profile] ??
          metadata(await readFile(`dist/preview/${profile}.html`, 'utf8')).level,
      );
      level.name = 'QA single-piece completion';
      level.rings = [[0]];
      level.queue = [{ color: 0, power: 1, mystery: true }];
      level.arenaRingCapacity = 1;
      level.maxRenderedRings = 1;
      level.previewRingCount = 0;
      level.stemLanes.forEach((l) => (l.requiredBreaks = 1));
      const response = await fetch(origin + '/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: origin },
        body: JSON.stringify({ network, profile, level, format: 'html' }),
      });
      assert.equal(response.status, 200, response.status === 200 ? '' : await response.text());
      const html = await response.text(),
        meta = metadata(html);
      assertFixedQueue(meta.level);
      assert.deepEqual({ ...meta.level, queue: level.queue }, level);
      assert.deepEqual(meta.level.queue, [{ color: 0, power: 3, mystery: false }]);
      assert.ok(meta.level.queue.every((q) => q.mystery === false));
      const bytes = Buffer.byteLength(html);
      assert.ok(bytes < (network === 'meta' ? 2_000_000 : 5_000_000));
      await writeFile(resolve(out, `fixture-${network}-${profile}.html`), html);
      const { page, context, errors, requests } = await hostedPage(network, { html, profile, ios });
      try {
        await page.evaluate(() => __endcardHost.activate());
        const start = Date.now();
        await page.locator('.queue-ball:not(.future)[data-column="0"]').click();
        await page.locator('.result').waitFor({ state: 'visible', timeout: 20000 });
        const seconds = (Date.now() - start) / 1000;
        const art = await checkBrand(page, profile, { exactAssets: network !== 'meta' });
        await checkLayout(page, profile, `production-${network}-completed`);
        await assertHostInstall(page, network, meta.effectiveStoreURLs?.[ios ? 'ios' : 'android']);
        await page.locator('.result-restart').click();
        assert.equal(await page.locator('.result').isVisible(), false);
        assert.equal((await page.locator('.capacity').textContent()).trim(), '0/3');
        assert.equal(await page.locator('.queue-ball:not(.future)').count(), 1);
        await assertNoMystery(page);
        assert.deepEqual(errors, []);
        assert.deepEqual(requests, []);
        return {
          profile,
          concept: resultConcept(profile),
          realCompletionSeconds: seconds,
          ordinaryQueueClicks: 1,
          authoredSegments: 1,
          noProductionDebug: true,
          noForcedWin: true,
          legacyFlagNormalized: true,
          offline: true,
          brand: art,
          installRoute:
            network === 'meta' ? 'Meta host callback' : ios ? 'iOS store' : 'Android store',
          replay: true,
          htmlBytes: bytes,
          sha256: sha(html),
        };
      } finally {
        await context.close();
      }
    });
  for (const network of ['unity', 'applovin', 'meta'])
    for (const profile of profiles)
      await run(`prebuilt-endcard-and-explicit-bridge-${network}-${profile}`, async () => {
        const { page, context, errors, requests } = await hostedPage(network, { profile });
        try {
          const html = await readFile(`dist/${network}/${profile}.html`, 'utf8'),
            meta = metadata(html);
          assertFixedQueue(meta.level);
          assert.equal(meta.level.shape, profile.endsWith('flower') ? 'flower' : 'heart');
          assert.equal(meta.level.songId, profile.endsWith('flower') ? 'sunflower' : 'nobatidao');
          await page.evaluate(() => __endcardHost.activate());
          await page.locator('.queue-ball:not(.future)[data-column="0"]').click();
          assert.equal(await page.evaluate(() => __endcardHost.exits.length), 0);
          await assertNoMystery(page);
          // Isolated route/layout inspection only: full 96-piece preview and real-time production
          // fixture completion above independently verify the actual win-to-endcard transition.
          await page.locator('.result').evaluate((el) => {
            el.hidden = false;
          });
          await checkBrand(page, profile, { exactAssets: network !== 'meta' });
          await assertHostInstall(page, network, meta.effectiveStoreURLs?.android);
          assert.deepEqual(errors, []);
          assert.deepEqual(requests, []);
          return {
            profile,
            song: meta.level.songId,
            shape: meta.level.shape,
            concept: resultConcept(profile),
            brandedInstallNow: true,
            isolatedCTAOnly: true,
            explicitExitDebounced: true,
            noMystery: true,
            noProductionDebug: true,
          };
        } finally {
          await context.close();
        }
      });
} catch {
  process.exitCode = 1;
} finally {
  if (!reachedResume) {
    report.errors.push(`Unknown resume case: ${resumeFrom}`);
    process.exitCode = 1;
  }
  await browser.close();
  await writeFile(resolve(out, 'browser-results.json'), JSON.stringify(report, null, 2) + '\n');
}
