import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { unzipSync } from 'fflate';
import { createHash } from 'node:crypto';

const origin = process.env.BEAT_BLOOM_QA_ORIGIN || 'http://127.0.0.1:4178';
// Maintained runs never overwrite dated acceptance evidence.
const out = resolve(process.env.BEAT_BLOOM_QA_OUTPUT || 'qa/native/latest/runtime');
await mkdir(out, { recursive: true });
const args = new Set(process.argv.slice(2));
const studioDefault = JSON.parse(await readFile('src/native/data/studio-default.json', 'utf8'));
const pieceCount = (level) => level.rings.flat().filter((color) => color >= 0).length;
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
    'Desktop headless Chrome. Public queue/tray controls; deterministic debug stepping changes elapsed time only. Visual parity and mobile-device performance are separate gates.',
  cases: [],
  errors: [],
};
async function run(name, fn) {
  if (process.env.BEAT_BLOOM_QA_CASE && name !== process.env.BEAT_BLOOM_QA_CASE) return;
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
async function makePage(viewport = { width: 576, height: 1280 }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage(),
    errors = [],
    requests = [];
  await context.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (e) => {
    if (e.type() === 'error') errors.push(e.text());
  });
  page.on('request', (r) => {
    if (/^https?:/.test(r.url()) && !r.url().endsWith('/favicon.ico')) requests.push(r.url());
  });
  return { page, context, errors, requests };
}
const snapshot = (page) => page.evaluate(() => window.__beatBloom.snapshot());
const removedGameplayUI =
  '.game h1,.settings,.settings-button,.sound-toggle,.boosters,.booster,[data-booster]';
const removedStudioUI =
  'video,#video,#compare,.reference,.reference-tools,#match-start,#prev-frame,#next-frame,#video-time,#exports,#reset,#opening';
const isReferenceRequest = (url) =>
  /\/reference\/|reference-video|frame-times|\.mp4(?:\?|$)/i.test(url);
async function assertSimplifiedUI(page) {
  assert.equal(
    await page.locator(removedGameplayUI).count(),
    0,
    'removed title/settings/boosters must be absent from the gameplay DOM',
  );
}
async function assertSimplifiedStudio(page) {
  assert.equal(
    await page.locator(removedStudioUI).count(),
    0,
    'video comparison and prebuilt delivery controls must be absent, not hidden',
  );
  assert.equal(await page.getByRole('heading', { name: 'Delivery', exact: true }).count(), 0);
  assert.equal(await page.getByText('Compare with video', { exact: true }).count(), 0);
  assert.equal(
    await page
      .locator('a[href*="/reference/"],a[href*="reference-video"],a[href*="acceptance.md"]')
      .count(),
    0,
  );
}
async function setControl(page, selector, value) {
  const control = page.locator(selector),
    type = await control.getAttribute('type');
  if (type === 'range') {
    const bounds = await control.evaluate((el) => ({ min: Number(el.min), max: Number(el.max) }));
    if (bounds.min === bounds.max) {
      assert.equal(Number(await control.inputValue()), Number(value));
      return;
    }
    // A pointer gesture exercises the real range widget and its input/change listeners.
    await control.scrollIntoViewIfNeeded();
    const box = await control.boundingBox(),
      ratio = (Number(value) - bounds.min) / (bounds.max - bounds.min);
    assert.ok(box);
    await page.mouse.click(
      box.x + 8 + Math.max(0, Math.min(1, ratio)) * (box.width - 16),
      box.y + box.height / 2,
    );
    // Use ordinary keyboard adjustment if native thumb geometry rounded the pointer value.
    for (let n = 0; n < 30 && Number(await control.inputValue()) !== Number(value); n++)
      await control.press(
        Number(await control.inputValue()) < Number(value) ? 'ArrowRight' : 'ArrowLeft',
      );
    assert.equal(Number(await control.inputValue()), Number(value));
  } else {
    await control.fill(String(value));
    await control.dispatchEvent('change');
  }
}
function assertAuthoredPower(level) {
  assert.equal(level.queuePolicy, 'fixed-three');
  assert.ok(level.queue.every((q) => q.power === 3 && q.mystery === false));
  for (let color = 0; color < level.palette.length; color++) {
    const demand = level.rings.flat().filter((c) => c === color).length;
    assert.equal(
      level.queue.filter((q) => q.color === color).length,
      Math.ceil(demand / 3),
      `edited level color ${color} needs the minimal rounded-up global ball count`,
    );
  }
}
function assertStudioDefault(level) {
  const { ballScale, ballSpeed, stemUnlockPolicy, stemLanes, ...actual } = level;
  const {
    ballScale: sourceScale,
    ballSpeed: sourceSpeed,
    stemUnlockPolicy: sourceUnlock,
    stemLanes: sourceLanes,
    ...source
  } = studioDefault;
  assert.deepEqual(actual, source, 'native starts from the actual saved Studio default');
  assert.equal(ballScale, sourceScale ?? 0.85);
  assert.equal(ballSpeed, sourceSpeed ?? 1.0);
  assert.equal(stemUnlockPolicy, 'half-per-color');
  assert.deepEqual(
    stemLanes,
    sourceLanes.map((lane) => ({
      ...lane,
      requiredBreaks: Math.max(
        1,
        [...new Set(lane.colors)].reduce(
          (sum, color) =>
            sum + Math.ceil(studioDefault.rings.flat().filter((c) => c === color).length / 2),
          0,
        ),
      ),
    })),
  );
  assertAuthoredPower(level);
}
function assertRuntimePower(s, level) {
  for (let color = 0; color < level.palette.length; color++) {
    const demand = s.rings.flatMap((r) => r.colors).filter((c) => c === color).length;
    const supply =
      s.queueBalls.filter((q) => q.color === color).reduce((n, q) => n + q.power, 0) +
      s.balls.filter((b) => b.color === color).reduce((n, b) => n + b.power, 0);
    const initialDemand = level.rings.flat().filter((c) => c === color).length,
      initialSurplus =
        level.queue.filter((q) => q.color === color).reduce((n, q) => n + q.power, 0) -
        initialDemand;
    assert.equal(
      supply,
      demand + (demand > 0 ? initialSurplus : 0),
      `runtime color ${color} must preserve its original surplus until that color is cleared`,
    );
    assert.ok(
      s.queueBalls.filter((q) => q.color === color).every((q) => q.power === 3),
      'queued powers stay3',
    );
  }
}
async function load(page, profile = 'native') {
  await page.goto(`${origin}/dist/preview/${profile}.html`);
  await page.waitForFunction(() => window.__beatBloom?.snapshot().ready, undefined, {
    timeout: 30000,
  });
}
async function pixelProof(page, name) {
  const path = resolve(out, name);
  await page.screenshot({ path });
  const { data, info } = await sharp(path).raw().toBuffer({ resolveWithObject: true });
  let bright = 0,
    purple = 0;
  for (let y = Math.round(info.height * 0.21); y < Math.round(info.height * 0.61); y++)
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels,
        r = data[i],
        g = data[i + 1],
        b = data[i + 2];
      if (Math.max(r, g, b) > 110) bright++;
      if (b > r * 1.15 && b > 15) purple++;
    }
  assert.ok(
    bright > info.width * info.height * 0.015,
    'field must contain visible bright lines; a ready flag with a black canvas fails',
  );
  assert.ok(purple > info.width * info.height * 0.03, 'background must render its indigo field');
  return { path, brightPixels: bright, purplePixels: purple };
}

try {
  if (!args.has('--studio-only') && !args.has('--production-only'))
    await run('native-render-layout-and-real-input', async () => {
      const { page, context, errors, requests } = await makePage();
      try {
        await load(page);
        await page.evaluate(() => {
          __beatBloom.pause(true);
          __beatBloom.restart();
          __beatBloom.step(3.8);
        });
        const s = await snapshot(page);
        const initialLevel = await page.evaluate(() => __beatBloom.getLevel());
        assertStudioDefault(initialLevel);
        assert.equal(s.total, pieceCount(studioDefault));
        assertAuthoredPower(initialLevel);
        assert.equal(s.queue, initialLevel.queue.length);
        assert.equal(s.shape, studioDefault.shape);
        await assertSimplifiedUI(page);
        const pixels = await pixelProof(page, 'web-003800.png');
        assert.equal(await page.locator('.queue-ball:not(.future)').count(), 3);
        assert.equal(await page.locator('.tray-slot').count(), 5);
        assert.equal(await page.locator('.tray-slot.locked').count(), 2);
        const centers = await page.locator('.queue-ball:not(.future)').evaluateAll((els) =>
          els.map((el) => {
            const b = el.getBoundingClientRect();
            return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width };
          }),
        );
        for (let i = 0; i < 3; i++) {
          assert.ok(Math.abs(centers[i].x - [212, 288, 364][i]) < 3);
          assert.ok(Math.abs(centers[i].y - 992) < 3);
          assert.equal(centers[i].w, 48);
        }
        await page.locator('.queue-ball:not(.future)[data-column="2"]').click();
        assert.equal((await snapshot(page)).shots, 1);
        assert.equal((await snapshot(page)).balls[0].state, 'incoming');
        await page.evaluate(() => __beatBloom.step(0.2));
        assert.equal((await snapshot(page)).balls[0].state, 'incoming');
        await page.screenshot({ path: resolve(out, 'web-queue-flight.png') });
        await page.evaluate(() => __beatBloom.step(0.6));
        assert.equal((await snapshot(page)).balls[0].state, 'active');
        await page.waitForFunction(() => __beatBloom.snapshot().music.ready, undefined, {
          timeout: 20000,
        });
        assert.equal((await snapshot(page)).music.error, '');
        await page.screenshot({ path: resolve(out, 'web-ball-active.png') });
        assert.deepEqual(errors, []);
        assert.equal(requests.filter((u) => !u.startsWith(origin + '/dist/preview/')).length, 0);
        return {
          ...pixels,
          queueColumns: 3,
          traySlots: 5,
          gestureAudioDecoded: true,
          externalAssets: 0,
          removedGameplayUIAbsent: true,
        };
      } finally {
        await context.close();
      }
    });
  if (!args.has('--visual-only') && !args.has('--studio-only') && !args.has('--production-only')) {
    await run('designer-edit-transaction-and-round-trip', async () => {
      const { page, context, errors } = await makePage();
      try {
        await load(page);
        await page.evaluate(() => __beatBloom.pause(true));
        const result = await page.evaluate(() => {
          const original = __beatBloom.getLevel();
          const edited = {
            ...original,
            shape: 'flower',
            flowerPetals: 7,
            lineThickness: 0.1,
            palette: [0xff00cc, ...original.palette.slice(1)],
          };
          __beatBloom.setLevel(JSON.parse(JSON.stringify(edited)));
          const roundTrip = __beatBloom.getLevel();
          const invalid = [
            null,
            {},
            { ...edited, motion: null },
            { ...edited, sections: [null] },
            { ...edited, stemLanes: [null] },
            { ...edited, queue: [null] },
            { ...edited, lineThickness: edited.lineSpacing },
            { ...edited, songId: 'sunflower' },
          ];
          const rejected = invalid.map((value) => {
            let message = '';
            try {
              __beatBloom.setLevel(value);
            } catch (e) {
              message = String(e);
            }
            return {
              message,
              retained: JSON.stringify(__beatBloom.getLevel()) === JSON.stringify(edited),
            };
          });
          return { roundTrip, edited, rejected };
        });
        assert.deepEqual(result.roundTrip, result.edited);
        for (const r of result.rejected) {
          assert.ok(r.message);
          assert.equal(r.retained, true);
        }
        for (const [shape, thickness] of [
          ['hexagon', 0.07],
          ['heart', 0.18],
          ['flower', 0.28],
          ['ring', 0.12],
        ]) {
          await page.evaluate(
            (o) => {
              __beatBloom.setOptions(o);
              __beatBloom.step(0.1);
            },
            { shape, lineThickness: thickness },
          );
          await pixelProof(page, `edit-${shape}-${thickness}.png`);
          assert.equal((await snapshot(page)).total, pieceCount(studioDefault));
        }
        assert.deepEqual(errors, []);
        return {
          roundTrip: true,
          invalidImports: result.rejected.length,
          shapes: 4,
          thicknesses: 4,
        };
      } finally {
        await context.close();
      }
    });
    await run('preview-api-pause-mute-restart-and-resize', async () => {
      const { page, context, errors } = await makePage();
      try {
        await load(page);
        await page.locator('.queue-ball:not(.future)[data-column="0"]').click();
        await page.waitForFunction(() => __beatBloom.snapshot().music.ready);
        await page.waitForTimeout(150);
        await assertSimplifiedUI(page);
        await page.evaluate(() => __beatBloom.pause(true));
        await page.waitForFunction(() => __beatBloom.snapshot().music.state === 'suspended');
        const paused = await snapshot(page);
        await page.waitForTimeout(180);
        assert.equal((await snapshot(page)).time, paused.time);
        await page.evaluate(() => __beatBloom.setMuted(true));
        assert.equal((await snapshot(page)).music.muted, true);
        await page.evaluate(() => __beatBloom.restart());
        assert.equal((await snapshot(page)).music.muted, true, 'restart must preserve mute choice');
        assert.equal((await snapshot(page)).paused, true, 'restart must preserve manual pause');
        for (const [width, height] of [
          [320, 568],
          [390, 844],
          [768, 1024],
          [844, 390],
        ]) {
          await page.setViewportSize({ width, height });
          await page.waitForTimeout(60);
          const box = await page.locator('.game').boundingBox();
          assert.ok(
            box.x >= -1 &&
              box.y >= -1 &&
              box.x + box.width <= width + 1 &&
              box.y + box.height <= height + 1,
          );
          await page.screenshot({ path: resolve(out, `responsive-${width}x${height}.png`) });
        }
        await page.evaluate(() => __beatBloom.pause(false));
        await page.locator('.queue-ball:not(.future)[data-column="0"]').click();
        await page.waitForFunction(() => __beatBloom.snapshot().music.ready);
        const before = await snapshot(page);
        await page.evaluate(() => {
          Object.defineProperty(document, 'hidden', { configurable: true, value: true });
          document.dispatchEvent(new Event('visibilitychange'));
        });
        await page.waitForTimeout(150);
        const hidden = await snapshot(page);
        await page.waitForTimeout(150);
        assert.equal((await snapshot(page)).time, hidden.time);
        assert.equal(hidden.music.state, 'suspended');
        await page.evaluate(() => {
          Object.defineProperty(document, 'hidden', { configurable: true, value: false });
          document.dispatchEvent(new Event('visibilitychange'));
        });
        await page.waitForTimeout(150);
        assert.ok((await snapshot(page)).time > before.time);
        assert.deepEqual(errors, []);
        return {
          previewAPIPause: true,
          mutePreserved: true,
          viewports: 4,
          visibilityPause: true,
          removedGameplayUIAbsent: true,
        };
      } finally {
        await context.close();
      }
    });
    await run('stored-ball-dom-click-flight-and-full-tray-swap', async () => {
      const { page, context, errors } = await makePage();
      try {
        await load(page, 'a-heart');
        const level = await page.evaluate(() => {
          __beatBloom.pause(true);
          const l = __beatBloom.getLevel();
          // Reorder existing, valid ammunition to expose storage without consuming the red/yellow
          // front rings. Every ball is created through its ordinary queue button; no state injection.
          l.queue.sort(
            (a, b) => Number(![1, 2].includes(a.color)) - Number(![1, 2].includes(b.color)),
          );
          __beatBloom.setLevel(l);
          return l;
        });
        assertAuthoredPower(level);
        for (let i = 0; i < 6; i++) {
          const s = await snapshot(page),
            front = s.queueBalls.find((q) => q.row === 0 && [1, 2].includes(q.color));
          assert.ok(front);
          const oldest =
            s.active === 3
              ? s.balls
                  .filter((b) => b.state === 'active')
                  .sort((a, b) => a.launchedAt - b.launchedAt)[0]
              : null;
          await page.locator(`.queue-ball:not(.future)[data-column="${front.column}"]`).click();
          const fired = await snapshot(page);
          assert.equal(fired.shots, i + 1);
          if (oldest)
            assert.equal(
              fired.balls.find((b) => b.id === oldest.id).state,
              'banking',
              'fourth and later queued shots bank the oldest active ball',
            );
          await page.evaluate(() => __beatBloom.step(0.7));
          assertRuntimePower(await snapshot(page), level);
        }
        const full = await snapshot(page);
        assert.equal(full.active, 3);
        assert.equal(full.tray, 3);
        assert.equal(full.remaining, 96);
        assert.equal(await page.locator('.tray-slot.occupied').count(), 3);
        const next = full.queueBalls.find((q) => q.row === 0);
        await page.locator(`.queue-ball:not(.future)[data-column="${next.column}"]`).click();
        const refused = await snapshot(page);
        assert.equal(refused.shots, 6);
        assert.equal(
          refused.queue,
          full.queue,
          'full tray must refuse new queued balls without consuming them',
        );
        const selected = full.balls.find((b) => b.state === 'stored' && b.slot === 1),
          oldest = full.balls
            .filter((b) => b.state === 'active')
            .sort((a, b) => a.launchedAt - b.launchedAt)[0];
        assert.ok(selected && oldest);
        // Run real animation frames between pointer-down and pointer-up. Replacing a stored
        // ball's child span every frame used to detach the actual pointer target and lose this click.
        await page.evaluate(() => __beatBloom.pause(false));
        await page.locator('.tray-slot[data-tray="1"] span').click({ delay: 150 });
        await page.evaluate(() => __beatBloom.pause(true));
        const incoming = await snapshot(page),
          moving = incoming.balls.find((b) => b.id === selected.id);
        assert.equal(
          incoming.shots,
          7,
          'one actual occupied-slot click must launch exactly once while rendering',
        );
        assert.equal(moving.state, 'incoming');
        assert.equal(moving.color, selected.color);
        assert.equal(moving.power, selected.power);
        assert.equal(moving.slot, -1);
        assert.equal(incoming.balls.find((b) => b.id === oldest.id).state, 'banking');
        assert.equal(incoming.active, 3);
        assert.equal(incoming.tray, 3);
        assert.equal(incoming.queue, full.queue);
        assert.equal(incoming.balls.length, 6);
        assert.deepEqual(moving.flightFrom, selected.position);
        assert.deepEqual(moving.flightTo, { x: 0, y: 0 });
        assertRuntimePower(incoming, level);
        await page.evaluate(() => __beatBloom.step(0.18));
        const halfway = (await snapshot(page)).balls.find((b) => b.id === selected.id);
        assert.equal(halfway.state, 'incoming');
        assert.ok(
          Math.hypot(halfway.position.x, halfway.position.y) <
            Math.hypot(selected.position.x, selected.position.y),
        );
        assert.ok(
          Math.hypot(halfway.position.x, halfway.position.y) > 0.05,
          'stored ball visibly traverses the arena instead of teleporting',
        );
        await page.screenshot({ path: resolve(out, 'stored-ball-incoming.png') });
        await page.evaluate(() => __beatBloom.step(0.55));
        const settled = await snapshot(page);
        assert.equal(settled.balls.find((b) => b.id === selected.id).state, 'active');
        assert.equal(settled.balls.find((b) => b.id === oldest.id).state, 'stored');
        assert.equal(settled.active, 3);
        assert.equal(settled.tray, 3);
        assertRuntimePower(settled, level);
        const launches = await page.evaluate(
          (id) => __beatBloom.events().filter((e) => e.type === 'launch' && e.ballId === id),
          selected.id,
        );
        assert.equal(launches.length, 2);
        assert.deepEqual(launches[1].position, { x: 0, y: 0 });
        assert.equal(await page.locator('.tray-slot.occupied').count(), 3);
        assert.deepEqual(errors, []);
        return {
          ordinaryQueueShots: 6,
          activeCapacity: 3,
          fullTray: 3,
          storedDOMClickWhileRendering: true,
          centerFlight: true,
          oldestEvicted: true,
          powerPreserved: true,
          fullTrayQueuedInputRefused: true,
        };
      } finally {
        await context.close();
      }
    });
    for (const profile of ['native', 'a-heart', 'a-flower'])
      await run(`full-public-playthrough-${profile}`, async () => {
        const { page, context, errors } = await makePage();
        try {
          await load(page, profile);
          await page.evaluate(() => {
            __beatBloom.pause(true);
            __beatBloom.restart();
          });
          await page.locator('.queue-ball:not(.future)[data-column="0"]').click();
          await page.waitForFunction(() => __beatBloom.snapshot().music.ready);
          const total = (await snapshot(page)).total;
          let last = total,
            lastAt = 0,
            next = 1;
          const captures = new Set();
          for (let i = 0; i < 960; i++) {
            const s = await snapshot(page);
            if (s.status !== 'playing') break;
            if (s.remaining !== last) {
              last = s.remaining;
              lastAt = s.time;
            }
            if (s.time >= next) {
              const wanted = s.rings.find((r) => r.eligible && r.colors.length)?.colors ?? [];
              if (s.active < 3 || (s.time - lastAt > 8 && s.tray < 3)) {
                const stored = s.balls.find(
                    (b) => b.state === 'stored' && wanted.includes(b.color),
                  ),
                  fronts = s.queueBalls.filter((q) => q.row === 0),
                  queued = fronts.find((q) => wanted.includes(q.color)) ?? fronts[0];
                if (stored) await page.locator(`[data-tray="${stored.slot}"]`).click();
                else if (queued)
                  await page
                    .locator(`.queue-ball:not(.future)[data-column="${queued.column}"]`)
                    .click();
                next = s.time + 1;
              }
            }
            await page.evaluate(() => __beatBloom.step(0.25));
            for (const milestone of [0.75, 0.5, 0.125].map((ratio) => Math.floor(total * ratio)))
              if (s.remaining <= milestone && !captures.has(milestone)) {
                captures.add(milestone);
                await page.screenshot({
                  path: resolve(out, `${profile}-remaining-${milestone}.png`),
                });
              }
          }
          const final = await snapshot(page);
          assert.equal(final.status, 'won', JSON.stringify(final));
          assert.equal(final.remaining, 0);
          const events = await page.evaluate(() => __beatBloom.events());
          assert.equal(events.filter((e) => e.type === 'break').length, total);
          assert.equal(
            new Set(events.filter((e) => e.type === 'break').map((e) => e.segmentId)).size,
            total,
          );
          assert.equal(events.filter((e) => e.type === 'win').length, 1);
          await page.evaluate(() => __beatBloom.step(4.2));
          assert.equal(await page.locator('.result').isVisible(), true);
          await page.screenshot({ path: resolve(out, `${profile}-completed.png`) });
          await page.locator('.result-restart').click();
          assert.equal((await snapshot(page)).remaining, total);
          assert.equal((await snapshot(page)).shots, 0);
          assert.deepEqual(errors, []);
          return {
            simulationSeconds: final.time,
            shots: final.shots,
            breaks: total,
            completionEvents: 1,
            restart: true,
          };
        } finally {
          await context.close();
        }
      });
  }
  if (!args.has('--visual-only') && !args.has('--production-only'))
    await run('studio-song-switch-preserves-edits-and-three-tab-navigation', async () => {
      const { page, context, errors } = await makePage({ width: 1440, height: 1000 });
      try {
        await page.goto(origin + '/');
        await page.waitForFunction(
          () =>
            document.querySelector('#game')?.contentWindow?.__beatBloom?.snapshot().ready &&
            document.querySelector('#level-json').value.length > 100,
        );
        assert.equal(await page.locator('#profile').getAttribute('aria-label'), 'Song');
        assert.deepEqual(
          await page
            .locator('#profile option')
            .evaluateAll((es) => es.map((el) => ({ value: el.value, label: el.textContent }))),
          [
            { value: 'native', label: 'Kiss Me More' },
            { value: 'a-heart', label: 'NO BATIDÃO' },
            { value: 'a-flower', label: 'Sunflower' },
          ],
        );
        const game = () =>
          page.evaluate(() => document.querySelector('#game').contentWindow.__beatBloom.getLevel());
        assertStudioDefault(await game());
        await page.locator('#shape').selectOption('triangle');
        await setControl(page, '#layers', 6);
        await setControl(page, '#ball-size', 95);
        await page.locator('#design-tab').click();
        await page.locator('#design-screen').selectOption('ending');
        await page.locator('#end-headline').fill('Keep my design');
        await page.locator('#end-headline').press('Tab');
        await page.locator('#gameplay-tab').click();
        const edited = await game();
        const songFields = new Set([
          'songId',
          'name',
          'bpm',
          'beatsPerBar',
          'loopBeats',
          'downbeatOffset',
          'sections',
          'stemLanes',
        ]);
        const mechanics = (l) =>
          Object.fromEntries(Object.entries(l).filter(([key]) => !songFields.has(key)));
        const songs = [];
        for (const [profile, songId, performers] of [
          ['a-heart', 'nobatidao', 2],
          ['a-flower', 'sunflower', 4],
          ['native', studioDefault.songId, 4],
        ]) {
          await page.locator('#profile').selectOption(profile);
          await page.waitForFunction(
            (song) =>
              document.querySelector('#game')?.contentWindow?.__beatBloom?.snapshot().ready &&
              document.querySelector('#game').contentWindow.__beatBloom.getLevel().songId ===
                song &&
              JSON.parse(document.querySelector('#level-json').value).songId === song,
            songId,
          );
          const actual = await game();
          assert.deepEqual(mechanics(actual), mechanics(edited));
          assertAuthoredPower(actual);
          assert.equal(await page.frameLocator('#game').locator('.band-item').count(), performers);
          songs.push({ profile, songId, performers, exactNonSongSettings: true });
        }
        await page.locator('#gameplay-tab').focus();
        await page.locator('#gameplay-tab').press('End');
        assert.equal(await page.locator('#export-tab').getAttribute('aria-selected'), 'true');
        assert.equal(await page.locator('#export-panel').isVisible(), true);
        assert.equal(await page.locator('#level-file-controls').isVisible(), false);
        await page.locator('#export-tab').press('Home');
        assert.equal(await page.locator('#gameplay-tab').getAttribute('aria-selected'), 'true');
        for (const [from, to] of [
          ['gameplay', 'design'],
          ['design', 'export'],
          ['export', 'gameplay'],
        ]) {
          await page.locator(`#${from}-tab`).press('ArrowRight');
          assert.equal(await page.locator(`#${to}-tab`).getAttribute('aria-selected'), 'true');
          assert.equal(await page.evaluate(() => document.activeElement.id), `${to}-tab`);
          assert.equal(await page.locator('[role=tab][tabindex="0"]').count(), 1);
        }
        await assertSimplifiedStudio(page);
        assert.deepEqual(errors, []);
        return {
          songs,
          keyboardThreeTabCycle: true,
          exportPanelVisibleOnlyWhenSelected: true,
          obsoleteControlsAbsent: true,
        };
      } finally {
        await context.close();
      }
    });
  if (!args.has('--visual-only') && !args.has('--production-only'))
    await run('studio-layer-counts-and-audio-controls', async () => {
      const { page, context, errors } = await makePage({ width: 1440, height: 1000 });
      try {
        await page.goto(origin + '/');
        await page.waitForFunction(
          () =>
            document.querySelector('#game')?.contentWindow?.__beatBloom?.snapshot().ready &&
            document.querySelector('#level-json').value.length > 100,
        );
        const game = () =>
          page.evaluate(() => document.querySelector('#game').contentWindow.__beatBloom.getLevel());
        const state = () =>
          page.evaluate(() => document.querySelector('#game').contentWindow.__beatBloom.snapshot());
        await page.locator('#pause').click();
        assert.equal((await state()).paused, true);
        const paused = (await state()).time;
        await page.waitForTimeout(150);
        assert.equal((await state()).time, paused);
        await page.locator('#sound').click();
        assert.equal((await state()).music.muted, true);
        await page.waitForFunction(
          () => document.querySelector('#sound').getAttribute('aria-label') === 'Unmute sound',
        );
        await page.locator('#restart').click();
        assert.equal((await state()).music.muted, true);
        assert.equal((await state()).paused, true);
        await page.locator('#sound').click();
        assert.equal((await state()).music.muted, false);
        await page.waitForFunction(
          () => document.querySelector('#sound').getAttribute('aria-label') === 'Mute sound',
        );
        assert.equal(await page.locator('#layers').getAttribute('min'), '1');
        assert.equal(await page.locator('#layers').getAttribute('max'), '24');
        const edited = [];
        for (const [total, visible] of [
          [1, 1],
          [24, 12],
        ]) {
          await setControl(page, '#layers', total);
          let level = await game();
          assert.equal(level.rings.length, total);
          assertAuthoredPower(level);
          assert.equal(
            await page.locator('#visible-layers').getAttribute('max'),
            String(Math.min(12, total)),
          );
          await setControl(page, '#visible-layers', visible);
          level = await game();
          const s = await state();
          assert.equal(level.arenaRingCapacity, visible);
          assert.equal(
            s.rings.filter((r) => r.visible).length,
            Math.min(total, level.maxRenderedRings, visible + level.previewRingCount),
          );
          assert.equal(s.total, level.rings.flat().filter((c) => c >= 0).length);
          assertAuthoredPower(level);
          assert.deepEqual(JSON.parse(await page.locator('#level-json').inputValue()), level);
          const event = page.waitForEvent('download');
          await page.locator('#save').click();
          const download = await event,
            path = resolve(out, `studio-${total}-layers.json`);
          await download.saveAs(path);
          assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), level);
          await setControl(page, '#layers', total === 1 ? 2 : 1);
          assert.notEqual((await game()).rings.length, total);
          await page.locator('#load-file').setInputFiles(path);
          await page.waitForFunction(
            (expected) =>
              JSON.stringify(
                document.querySelector('#game').contentWindow.__beatBloom.getLevel(),
              ) === JSON.stringify(expected),
            level,
          );
          assert.deepEqual(await game(), level);
          assert.equal(Number(await page.locator('#layers').inputValue()), total);
          assert.equal(Number(await page.locator('#visible-layers').inputValue()), visible);
          await page.screenshot({
            path: resolve(out, `studio-${total}-layers.png`),
            fullPage: true,
          });
          edited.push({
            totalLayers: total,
            arenaLayers: visible,
            renderedLayers: s.rings.filter((r) => r.visible).length,
            previewLayers: level.previewRingCount,
            segments: s.total,
            powerBalanced: true,
            downloadLoadRoundTrip: true,
          });
        }
        await setControl(page, '#visible-layers', 3);
        assert.equal((await game()).arenaRingCapacity, 3);
        const s = await state(),
          l = await game();
        assert.equal(
          s.rings.filter((r) => r.visible).length,
          Math.min(l.rings.length, l.maxRenderedRings, 3 + l.previewRingCount),
        );
        const rejected = await page.evaluate(() => {
          const a = document.querySelector('#game').contentWindow.__beatBloom,
            before = JSON.stringify(a.getLevel());
          return [0, 25, 1.5, NaN].map((n) => {
            let error = '';
            try {
              a.setLayerCount(n);
            } catch (e) {
              error = String(e);
            }
            return { error, retained: JSON.stringify(a.getLevel()) === before };
          });
        });
        for (const r of rejected) {
          assert.ok(r.error);
          assert.equal(r.retained, true);
        }
        assert.deepEqual(errors, []);
        return {
          studioPause: true,
          studioMute: true,
          muteAndPauseRetainedAfterRestart: true,
          layerCases: edited,
          customArenaLayers: 3,
          invalidLayerTransactions: rejected.length,
        };
      } finally {
        await context.close();
      }
    });
  if (!args.has('--visual-only') && !args.has('--production-only'))
    await run('studio-controls-save-load-without-video-or-delivery', async () => {
      const { page, context, errors, requests } = await makePage({ width: 1440, height: 1000 });
      try {
        await page.goto(origin + '/');
        await page.waitForFunction(
          () => document.querySelector('#game')?.contentWindow?.__beatBloom?.snapshot().ready,
        );
        const game = () =>
          page.evaluate(() => document.querySelector('#game').contentWindow.__beatBloom.getLevel());
        await page.waitForFunction(() => document.querySelector('#level-json').value.length > 100);
        await page.locator('#shape').selectOption('flower');
        assert.equal((await game()).shape, 'flower');
        await setControl(page, '#thickness', 12);
        assert.ok(Math.abs((await game()).lineThickness - 12 / 49) < 1e-10);
        await setControl(page, '#petals', 7);
        assert.equal((await game()).flowerPetals, 7);
        if (
          (await page.locator('#advanced-pattern').count()) &&
          !(await page.locator('#advanced-pattern').evaluate((el) => el.open))
        )
          await page.locator('#advanced-pattern > summary').click();
        await page.locator('[aria-label="First color"]').fill('#e000bc');
        await page.locator('[aria-label="First color"]').dispatchEvent('change');
        assert.equal((await game()).palette[0], 0xe000bc);
        const expected = await game(),
          downloadEvent = page.waitForEvent('download');
        await page.locator('#save').click();
        const download = await downloadEvent;
        const saved = resolve(out, 'studio-saved-level.json');
        await download.saveAs(saved);
        assert.deepEqual(JSON.parse(await readFile(saved, 'utf8')), expected);
        await page.locator('#shape').selectOption('square');
        assert.equal((await game()).shape, 'square');
        await page.locator('#load-file').setInputFiles(saved);
        await page.waitForFunction(
          (expected) =>
            JSON.stringify(document.querySelector('#game').contentWindow.__beatBloom.getLevel()) ===
            JSON.stringify(expected),
          expected,
        );
        assert.deepEqual(await game(), expected);
        await page.locator('summary').filter({ hasText: 'Edit rings and queue' }).click();
        await page.locator('#level-json').fill('{"schemaVersion":1}');
        await page.locator('#apply-json').click();
        assert.ok((await page.locator('#editor-message').textContent()).includes('not changed'));
        assert.deepEqual(await game(), expected);
        await assertSimplifiedStudio(page);
        await page.screenshot({ path: resolve(out, 'studio-editor-desktop.png'), fullPage: true });
        assert.deepEqual(errors, []);
        assert.deepEqual(requests.filter(isReferenceRequest), []);
        const removedRoutes = [];
        for (const route of [
          '/reference-video.mp4',
          '/reference/frame-times.json',
          '/reference/timeline-0.jpg',
        ]) {
          const response = await context.request.get(origin + route);
          assert.equal(
            response.status(),
            404,
            `${route} must no longer serve source video or extracted frames`,
          );
          removedRoutes.push({ route, status: response.status() });
        }
        return {
          shape: true,
          thickness: true,
          petals: true,
          palette: true,
          downloadImportRoundTrip: true,
          invalidJSONRetainsLevel: true,
          removedComparisonAndDelivery: true,
          automaticVideoRequests: 0,
          removedRoutes,
        };
      } finally {
        await context.close();
      }
    });
  if (!args.has('--visual-only') && !args.has('--production-only'))
    for (const profile of ['native', 'a-flower'])
      await run(`studio-open-current-level-reload-and-tab-isolation-${profile}`, async () => {
        const { page, context, errors } = await makePage({ width: 1440, height: 1000 }),
          requests = [];
        context.on('request', (request) => requests.push(request.url()));
        context.on('page', (child) => {
          child.on('pageerror', (error) => errors.push(error.message));
          child.on('console', (entry) => {
            if (entry.type() === 'error') errors.push(entry.text());
          });
        });
        try {
          await page.goto(origin + '/');
          await page.waitForFunction(
            () =>
              document.querySelector('#game')?.contentWindow?.__beatBloom?.snapshot().ready &&
              document.querySelector('#level-json').value.length > 100,
          );
          if (profile !== 'native') {
            await page.locator('#profile').selectOption(profile);
            await page.waitForFunction(
              () =>
                document.querySelector('#game')?.contentWindow?.__beatBloom?.getLevel().songId ===
                  'sunflower' &&
                JSON.parse(document.querySelector('#level-json').value).songId === 'sunflower',
            );
          }
          await page.locator('#pause').click();
          const game = () =>
            page.evaluate(() =>
              document.querySelector('#game').contentWindow.__beatBloom.getLevel(),
            );
          await page.locator('#shape').selectOption(profile === 'native' ? 'flower' : 'heart');
          await setControl(page, '#layers', profile === 'native' ? 7 : 5);
          await setControl(page, '#visible-layers', 3);
          await setControl(page, '#thickness', 12);
          await setControl(page, '#spacing', 24);
          await setControl(page, '#roundness', 0.35);
          if (profile === 'native') await setControl(page, '#petals', 7);
          if (
            (await page.locator('#advanced-pattern').count()) &&
            !(await page.locator('#advanced-pattern').evaluate((el) => el.open))
          )
            await page.locator('#advanced-pattern > summary').click();
          await page.locator('[aria-label="First color"]').fill('#e000bc');
          await page.locator('[aria-label="First color"]').dispatchEvent('change');
          const firstLevel = await game();
          assertAuthoredPower(firstLevel);
          const open = async () => {
            const event = context.waitForEvent('page');
            await page.locator('#fullscreen').click();
            const child = await event;
            await child.setViewportSize({ width: 576, height: 1280 });
            await child.waitForFunction(() => window.__beatBloom?.snapshot().ready, undefined, {
              timeout: 30000,
            });
            await child.evaluate(() => __beatBloom.pause(true));
            return child;
          };
          const first = await open(),
            firstURL = new URL(first.url()),
            firstKey = firstURL.searchParams.get('studioLevel');
          assert.equal(firstURL.pathname, `/dist/preview/${profile}.html`);
          assert.match(firstKey, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
          assert.deepEqual(
            await first.evaluate(() => __beatBloom.getLevel()),
            firstLevel,
            'Open playable must use every current authored field, not the original profile',
          );
          assert.equal(await first.evaluate(() => window.opener === null), true);
          assert.equal((await snapshot(first)).shape, firstLevel.shape);
          await pixelProof(first, `opened-${profile}-current-level.png`);
          await first.reload();
          await first.waitForFunction(() => window.__beatBloom?.snapshot().ready);
          await first.evaluate(() => __beatBloom.pause(true));
          assert.deepEqual(
            await first.evaluate(() => __beatBloom.getLevel()),
            firstLevel,
            'reload keeps the original opened snapshot',
          );
          await page.locator('#shape').selectOption(profile === 'native' ? 'ring' : 'square');
          await setControl(page, '#layers', 9);
          await setControl(page, '#thickness', 10);
          if (
            (await page.locator('#advanced-pattern').count()) &&
            !(await page.locator('#advanced-pattern').evaluate((el) => el.open))
          )
            await page.locator('#advanced-pattern > summary').click();
          await page.locator('[aria-label="First color"]').fill('#00d5ee');
          await page.locator('[aria-label="First color"]').dispatchEvent('change');
          const secondLevel = await game();
          assertAuthoredPower(secondLevel);
          assert.notDeepEqual(secondLevel, firstLevel);
          const second = await open(),
            secondKey = new URL(second.url()).searchParams.get('studioLevel');
          assert.ok(secondKey && secondKey !== firstKey, 'every open creates a separate snapshot');
          assert.deepEqual(await second.evaluate(() => __beatBloom.getLevel()), secondLevel);
          assert.deepEqual(
            await first.evaluate(() => __beatBloom.getLevel()),
            firstLevel,
            'later studio edits do not change an existing opened tab',
          );
          await first.evaluate(() => {
            const level = __beatBloom.getLevel();
            __beatBloom.setOptions({
              shape: 'triangle',
              palette: [0xffffff, ...level.palette.slice(1)],
            });
          });
          assert.equal((await first.evaluate(() => __beatBloom.getLevel())).shape, 'triangle');
          assert.deepEqual(await second.evaluate(() => __beatBloom.getLevel()), secondLevel);
          assert.deepEqual(
            await game(),
            secondLevel,
            'changes within one preview are isolated from the editor',
          );
          await first.reload();
          await first.waitForFunction(() => window.__beatBloom?.snapshot().ready);
          await first.evaluate(() => __beatBloom.pause(true));
          assert.deepEqual(
            await first.evaluate(() => __beatBloom.getLevel()),
            firstLevel,
            'runtime edits cannot overwrite the saved handoff snapshot',
          );
          await second.reload();
          await second.waitForFunction(() => window.__beatBloom?.snapshot().ready);
          await second.evaluate(() => __beatBloom.pause(true));
          assert.deepEqual(await second.evaluate(() => __beatBloom.getLevel()), secondLevel);
          const shots = (await snapshot(first)).shots;
          await first.locator('.queue-ball:not(.future)[data-column="0"]').click();
          assert.equal((await snapshot(first)).shots, shots + 1);
          assert.equal((await snapshot(second)).shots, 0);
          assert.equal(
            await page.evaluate(
              () => document.querySelector('#game').contentWindow.__beatBloom.snapshot().shots,
            ),
            0,
          );
          await writeFile(
            resolve(out, `open-${profile}-snapshots.json`),
            JSON.stringify(
              {
                profile,
                firstURL: firstURL.href,
                secondURL: second.url(),
                firstLevel,
                secondLevel,
              },
              null,
              2,
            ) + '\n',
          );
          await assertSimplifiedStudio(page);
          assert.deepEqual(requests.filter(isReferenceRequest), []);
          assert.deepEqual(errors, []);
          return {
            profile,
            song: firstLevel.songId,
            firstShape: firstLevel.shape,
            firstLayers: firstLevel.rings.length,
            secondShape: secondLevel.shape,
            secondLayers: secondLevel.rings.length,
            exactFullLevelHandoff: true,
            independentSnapshotIDs: true,
            popupReloadPersists: true,
            tabEditsIsolated: true,
            openerAbsent: true,
            ordinaryQueueClick: true,
            videoRequests: 0,
          };
        } finally {
          await context.close();
        }
      });
  if (!args.has('--visual-only') && !args.has('--production-only'))
    await run('studio-snapshot-invalid-links-fail-without-default-game', async () => {
      const { page, context, errors, requests } = await makePage();
      try {
        await load(page);
        const valid = await page.evaluate(() => __beatBloom.getLevel()),
          id = '11111111-2222-4333-8444-555555555555',
          key = `beatbloom:studio-preview:${id}`;
        const cases = [
            { name: 'missing', raw: null, expected: 'unavailable in this browser' },
            { name: 'malformed-json', raw: '{broken', expected: 'preview is invalid' },
            {
              name: 'invalid-nested-level',
              raw: JSON.stringify({
                version: 1,
                profile: 'native',
                level: { ...valid, motion: null },
              }),
              expected: 'studio level is invalid',
            },
            {
              name: 'mismatched-profile',
              raw: JSON.stringify({ version: 1, profile: 'b-flower', level: valid }),
              expected: 'does not match this song profile',
            },
            {
              name: 'mismatched-audio',
              raw: JSON.stringify({
                version: 1,
                profile: 'native',
                level: { ...valid, songId: 'sunflower' },
              }),
              expected: 'does not match this playable',
            },
            {
              name: 'oversized',
              raw: ' '.repeat(256 * 1024 + 1),
              expected: 'preview is too large',
            },
            {
              name: 'malformed-id',
              raw: null,
              token: 'not-a-uuid',
              expected: 'Invalid studio preview link',
            },
          ],
          results = [];
        for (const test of cases) {
          await page.evaluate(
            ({ key, raw }) => {
              if (raw === null) localStorage.removeItem(key);
              else localStorage.setItem(key, raw);
            },
            { key, raw: test.raw },
          );
          errors.length = 0;
          await page.goto(`${origin}/dist/preview/native.html?studioLevel=${test.token ?? id}`);
          await page.waitForFunction(() =>
            document.querySelector('.loading')?.textContent.includes('Unable to load:'),
          );
          const message = await page.locator('.loading').textContent();
          assert.ok(message.includes(test.expected), `${test.name}: ${message}`);
          assert.equal(await page.locator('.loading').isVisible(), true);
          const before = await snapshot(page);
          assert.equal(before.ready, false);
          assert.equal(before.time, 0);
          assert.equal(await page.locator('.canvas canvas,.queue-ball').count(), 0);
          assert.equal(await page.evaluate(() => __beatBloom.fireQueue(0)), false);
          await page.waitForTimeout(120);
          assert.equal(
            (await snapshot(page)).time,
            0,
            'an invalid snapshot must not silently start the default level',
          );
          assert.equal(errors.length, 1, `${test.name}: ${JSON.stringify(errors)}`);
          assert.ok(
            errors[0].includes(test.expected),
            'only the expected startup validation error may be logged',
          );
          results.push({
            name: test.name,
            message,
            ready: false,
            defaultGameStarted: false,
            expectedConsoleErrors: 1,
          });
        }
        await page.screenshot({ path: resolve(out, 'invalid-studio-snapshot.png') });
        assert.deepEqual(requests.filter(isReferenceRequest), []);
        return { rejectedSnapshots: results, videoRequests: 0 };
      } finally {
        await context.close();
      }
    });
  if (args.has('--production') || args.has('--production-only')) {
    await run('production-artifact-integrity', async () => {
      const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
      assert.equal(manifest.version, '2.0.0');
      const exports = manifest.generated.filter((f) => f.network !== 'preview');
      assert.equal(exports.length, 12);
      for (const f of exports) {
        const html = await readFile('dist/' + f.html),
          zipBytes = await readFile('dist/' + f.zip);
        assert.equal(html.length, f.htmlBytes);
        assert.equal(zipBytes.length, f.zipBytes);
        assert.equal(createHash('sha256').update(html).digest('hex'), f.sha256);
        assert.equal(createHash('sha256').update(zipBytes).digest('hex'), f.zipSha256);
        assert.ok(html.length < f.limitBytes, `${f.html}: ${html.length} exceeds ${f.limitBytes}`);
        const zip = unzipSync(zipBytes);
        assert.deepEqual(Object.keys(zip), ['index.html']);
        assert.deepEqual(Buffer.from(zip['index.html']), html);
        for (const forbidden of ['Organ.png', '__beatBloom', 'beatbloom:studio-preview:'])
          assert.equal(
            html.includes(Buffer.from(forbidden)),
            false,
            `${f.html} contains ${forbidden}`,
          );
      }
      return {
        exports: exports.length,
        hashesVerified: true,
        previewToolsStripped: true,
        maxBytes: Math.max(...exports.map((f) => f.htmlBytes)),
      };
    });
    for (const network of ['unity', 'applovin', 'meta'])
      for (const profile of ['a-heart', 'a-flower', 'b-heart', 'b-flower'])
        await run(`bridge-${network}-${profile}`, async () => {
          const { page, context, errors, requests } = await makePage();
          try {
            await page.route('**/mraid.js', (route) =>
              route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }),
            );
            await page.addInitScript(
              ({ network }) => {
                const h = (window.__host = { exits: [], contexts: [] });
                const Audio = window.AudioContext;
                window.AudioContext = class extends Audio {
                  constructor(...args) {
                    super(...args);
                    h.contexts.push(this);
                  }
                };
                if (network === 'meta')
                  window.FbPlayableAd = { onCTAClick: () => h.exits.push('meta') };
                else {
                  const listeners = {};
                  let ready = false,
                    view = false;
                  window.mraid = {
                    getState: () => (ready ? 'default' : 'loading'),
                    isViewable: () => view,
                    open: (url) => h.exits.push(url),
                    addEventListener: (n, f) => (listeners[n] ??= []).push(f),
                    removeEventListener: () => {},
                  };
                  h.ready = () => {
                    ready = true;
                    (listeners.ready ?? []).forEach((f) => f());
                  };
                  h.view = (v) => {
                    view = v;
                    (listeners.viewableChange ?? []).forEach((f) => f(v));
                  };
                }
              },
              { network },
            );
            await page.goto(`${origin}/dist/${network}/${profile}.html`);
            if (network !== 'meta') {
              assert.equal(await page.locator('.canvas canvas').count(), 0);
              await page.evaluate(() => __host.ready());
            }
            await page.locator('.loading').waitFor({ state: 'hidden', timeout: 20000 });
            assert.equal(await page.evaluate(() => typeof window.__beatBloom), 'undefined');
            await assertSimplifiedUI(page);
            if (network !== 'meta') {
              await page.locator('.queue-ball:not(.future)[data-column="0"]').click();
              assert.equal(
                await page.evaluate(() => __host.contexts.length),
                0,
                'host-hidden gameplay must not unlock audio',
              );
              await page.evaluate(() => {
                __host.ready();
                __host.view(true);
              });
            }
            await page.locator('.queue-ball:not(.future)[data-column="0"]').click();
            await page.waitForFunction(() => __host.contexts[0]?.state === 'running');
            assert.equal(await page.evaluate(() => __host.exits.length), 0);
            if (network !== 'meta') {
              await page.evaluate(() => __host.view(false));
              await page.waitForFunction(() => __host.contexts[0].state === 'suspended');
              await page.evaluate(() => __host.view(true));
              await page.waitForFunction(() => __host.contexts[0].state === 'running');
            }
            // Isolated network bridge check: expose the existing result button only. This does not
            // certify that gameplay reached a win; real full-game completion is tested in preview above.
            await page.locator('.result').evaluate((el) => {
              el.hidden = false;
            });
            if (profile.startsWith('a-'))
              assert.equal(await page.locator('.free-to-play').textContent(), 'FREE TO PLAY');
            else
              assert.ok((await page.locator('.result h2').textContent()).includes('Match colors.'));
            await page.locator('.continue').dblclick({ delay: 60 });
            const exits = await page.evaluate(() => __host.exits);
            assert.equal(exits.length, 1);
            assert.equal(
              exits[0],
              network === 'meta'
                ? 'meta'
                : 'https://play.google.com/store/apps/details?id=io.ludaxis.beatbloom',
            );
            assert.deepEqual(errors, []);
            assert.deepEqual(
              requests.filter((u) => !u.startsWith(origin + '/dist/') && !u.endsWith('/mraid.js')),
              [],
            );
            return {
              localHostMock: true,
              explicitCTA: true,
              exitDebounced: true,
              viewabilityAudioPause: network !== 'meta',
              productionDebugAbsent: true,
              externalGameAssets: 0,
              notNetworkCertification: true,
            };
          } finally {
            await context.close();
          }
        });
  }
} catch {
  process.exitCode = 1;
} finally {
  await browser.close();
  const reportName = args.has('--studio-only')
    ? 'studio-results.json'
    : args.has('--visual-only')
      ? 'visual-results.json'
      : args.has('--production-only')
        ? 'production-results.json'
        : 'browser-results.json';
  await writeFile(resolve(out, reportName), JSON.stringify(report, null, 2) + '\n');
}
