import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createReviewServer } from './serve.mjs';
import { createNativePackage } from './native-package.mjs';
import { getPlayableLevel } from '../src/native/creative.ts';
const server = createReviewServer();
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const studioURL = `http://127.0.0.1:${server.address().port}/review/`,
  surface = '.phone',
  prefix = 'bb',
  ending = '.result';
async function buildFixture(concept) {
  const level = getPlayableLevel('native');
  level.adFlow = {
    intro: 'footer',
    tagline: 'A little match. A little music.',
    enabled: true,
    design: { concept, bannerEnabled: true },
  };
  return (await createNativePackage({ profile: 'native', network: 'meta', level })).html;
}
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const sizes = [
  [320, 568],
  [390, 844],
  [768, 1024],
  [390, 390],
  [844, 390],
  [568, 320],
];
const reports = [];
await mkdir('qa/responsive', { recursive: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  });
  await page.goto(studioURL);
  await page.locator('#preview-screen').waitFor({ state: 'attached' });
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    for (const id of ['phone', 'tall', 'tablet', 'square', 'landscape']) {
      await page.locator('#preview-screen').selectOption(id);
      await page.waitForFunction((selector) => {
        const el = document.querySelector(selector),
          rect = el.getBoundingClientRect();
        return Math.abs(rect.width / rect.height - Number(el.dataset.ratio)) < 0.002;
      }, surface);
      const rect = await page.locator(surface).boundingBox();
      assert(rect.width > 100 && rect.height > 100, 'Preview remains visible');
      assert(
        rect.x >= -1 && rect.x + rect.width <= viewport.width + 1,
        'Preview fits editor width',
      );
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Rotate preview', exact: true }).click();
  await page.waitForFunction(
    (selector) => Number(document.querySelector(selector).dataset.ratio) < 1,
    surface,
  );
  await page.reload();
  await page.locator('#preview-screen').waitFor({ state: 'attached' });
  assert.equal(
    await page
      .getByRole('button', { name: 'Rotate preview', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  await page.locator('#preview-screen').selectOption('landscape');
  await page.screenshot({ path: 'qa/responsive/studio-landscape.png' });
  await page.close();
  for (const concept of ['classic', 'spotlight', 'invitation']) {
    const html = await buildFixture(concept);
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: 'reduce',
    });
    const ad = await context.newPage(),
      requests = [],
      errors = [];
    ad.on('pageerror', (error) => errors.push(error.message));
    await ad.addInitScript(() => {
      window.FbPlayableAd = { onCTAClick() {} };
    });
    await ad.route('**/*', (route) => {
      if (route.request().url() === 'https://responsive.test/')
        return route.fulfill({ body: html, contentType: 'text/html' });
      requests.push(route.request().url());
      return route.abort();
    });
    await ad.goto('https://responsive.test/');
    await ad.locator(`.${prefix}-intro-play`).waitFor({ state: 'visible', timeout: 60000 });
    await ad.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images).map((image) => image.decode().catch(() => {})));
    });
    for (const [width, height] of sizes) {
      await ad.setViewportSize({ width, height });
      await ad.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      const layout = await ad.evaluate((prefix) => {
        const box = (selector) => {
          const r = document.querySelector(selector).getBoundingClientRect();
          return {
            left: r.left,
            top: r.top,
            right: r.right,
            bottom: r.bottom,
            width: r.width,
            height: r.height,
          };
        };
        return {
          wide: document.querySelector(`.${prefix}-intro`).dataset.layout === 'wide',
          root: box(`.${prefix}-intro`),
          logo: box(`.${prefix}-intro-logo`),
          tagline: box(`.${prefix}-intro-tagline`),
          headline: box(`.${prefix}-intro-headline`),
          button: box(`.${prefix}-intro-play`),
          banner: box(`.${prefix}-intro-install-bar`),
          install: box(`.${prefix}-intro-install`),
        };
      }, prefix);
      const label = `${concept} ${width}×${height}`;
      for (const [name, box] of Object.entries(layout).filter(([name]) => name !== 'wide')) {
        assert(
          box.left >= -1 && box.top >= -1 && box.right <= width + 1 && box.bottom <= height + 1,
          `${label}: ${name} stays inside viewport`,
        );
      }
      assert(
        Math.abs(layout.root.width - width) < 1 && Math.abs(layout.root.height - height) < 1,
        `${label}: intro fills host`,
      );
      assert(Math.abs(layout.banner.width - width) < 1, `${label}: banner spans host`);
      assert(
        layout.button.height >= 43.9 && layout.install.height >= 43.9,
        `${label}: touch target height`,
      );
      assert(layout.button.bottom <= layout.banner.top + 1, `${label}: Play clears banner`);
      assert(layout.headline.bottom <= layout.button.top + 1, `${label}: headline clears Play`);
      if (!layout.wide)
        assert(
          layout.tagline.bottom <= layout.headline.top + 1,
          `${label}: tagline clears headline`,
        );
      reports.push({ label, layout });
      if (width === 844 || (width === 390 && height === 390))
        await ad.screenshot({ path: `qa/responsive/${concept}-${width}x${height}.png` });
    }
    // Isolated layout check of the real exported ending, independent of puzzle completion.
    // Existing flow suites exercise reaching this screen through actual gameplay.
    await ad.evaluate((prefix) => {
      document.querySelector(`.${prefix}-intro`).hidden = true;
      document
        .querySelectorAll('.ds-endcard-host,.ds-design-result,.result')
        .forEach((el) => (el.hidden = false));
    }, prefix);
    for (const [width, height] of sizes) {
      await ad.setViewportSize({ width, height });
      await ad.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      const layout = await ad.locator(ending).evaluate((root) => {
        const rect = (el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        };
        return [root, ...root.querySelectorAll('.result-logo,.result-icon,h1,h2,.continue')]
          .filter((el) => getComputedStyle(el).display !== 'none')
          .map(rect);
      });
      for (const box of layout)
        assert(
          box.left >= -1 && box.top >= -1 && box.right <= width + 1 && box.bottom <= height + 1,
          `${concept} ${width}×${height}: ending fits viewport ${JSON.stringify(box)}`,
        );
      if (width === 844)
        await ad.screenshot({ path: `qa/responsive/ending-${concept}-landscape.png` });
    }
    assert.deepEqual(requests, [], 'Export uses embedded assets only');
    assert.deepEqual(errors, [], 'No browser errors');
    await context.close();
  }
  await writeFile('qa/responsive/report.json', JSON.stringify(reports, null, 2));
  console.log(
    'PASS responsive previews, saved rotation, 18 offline intro/banner layouts and 18 exported ending layouts.',
  );
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
