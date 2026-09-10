import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const origin = process.env.BEAT_BLOOM_QA_ORIGIN || 'http://127.0.0.1:4178',
  output = resolve(process.env.BEAT_BLOOM_QA_OUTPUT || 'qa/native/music');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true }),
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  }),
  page = await context.newPage(),
  errors = [],
  audioRequests = [],
  report = { cases: [], browser: browser.version() };
page.on('pageerror', (error) => errors.push(error.message));
context.on('request', (request) => {
  const path = new URL(request.url()).pathname;
  if (/\.(m4a|ogg|wav|mp3|aac)$/i.test(path)) audioRequests.push(path);
});
const getLevel = () =>
  page.evaluate(() => document.querySelector('#game').contentWindow.__beatBloom.getLevel());
const ready = async (song) =>
  page.waitForFunction(
    (id) => {
      const api = document.querySelector('#game')?.contentWindow?.__beatBloom;
      const data = document.querySelector('#level-json').value;
      return (
        api?.snapshot().ready &&
        api.getLevel().songId === id &&
        data &&
        JSON.parse(data).songId === id
      );
    },
    song,
    { timeout: 60000 },
  );
const nonSong = (level) => {
  const { songId, bpm, beatsPerBar, loopBeats, downbeatOffset, sections, stemLanes, ...rest } =
    level;
  const result = structuredClone(rest);
  if (result.referenceCalibration) delete result.referenceCalibration.audioSourceOffsetSeconds;
  return result;
};
try {
  await page.goto(origin + '/');
  await ready('kissmemore');
  const catalog = await page.evaluate(async () =>
    (await fetch('/assets/music/catalog.json')).json(),
  );
  await page.waitForFunction(
    (count) => document.querySelector('#profile').options.length === count,
    catalog.length,
  );
  assert.equal(
    catalog.length,
    72,
    'Every Drop Sort entry and all three legacy songs are available.',
  );
  const imported = catalog.find(
    (song) =>
      !['kissmemore', 'nobatidao', 'sunflower'].includes(song.id) &&
      song.stems.length === 5 &&
      song.stems.every((stem) => stem.earnable),
  );
  assert.ok(imported);
  await page.waitForLoadState('networkidle');
  assert.deepEqual(audioRequests, [], 'Opening Studio and the song catalog downloads no audio.');
  await page.evaluate(() => {
    const current = document.querySelector('#game').contentWindow.__beatBloom;
    current.setOptions({ name: 'My authored midnight mix' });
  });
  await page.locator('#advanced-pattern > summary').click();
  await page.locator('[aria-label="First color"]').fill('#ca35bd');
  await page.locator('[aria-label="First color"]').dispatchEvent('change');
  const authored = await getLevel();
  await page.locator('#profile').selectOption(imported.id);
  await ready(imported.id);
  await page.waitForLoadState('networkidle');
  assert.deepEqual(
    audioRequests,
    [],
    'Changing songs and colors before a listening or gameplay gesture downloads no audio.',
  );
  const selected = await getLevel();
  assert.deepEqual(nonSong(selected), nonSong(authored));
  assert.equal(selected.name, 'My authored midnight mix');
  assert.equal(selected.referenceCalibration?.audioSourceOffsetSeconds, undefined);
  assert.equal(
    await page.locator('[data-listen-stem]').count(),
    imported.stems.filter((stem) => stem.earnable).length,
  );
  assert.equal(
    await page.locator('#stem-assignments input[type=checkbox]').count(),
    selected.palette.length * 5,
  );
  // Raw source zero must be authorable, and deliberate omissions must remain silent.
  for (const checkbox of await page.locator('#stem-assignments input[data-stem="0"]').all())
    if (await checkbox.isChecked()) await checkbox.uncheck();
  assert.ok(!(await getLevel()).stemLanes.some((lane) => lane.stem === 0));
  await page.locator('#stem-assignments input[data-stem="0"][data-color="1"]').check();
  const bound = await getLevel();
  assert.deepEqual(bound.stemLanes.find((lane) => lane.stem === 0).colors, [1]);
  assert.equal(bound.palette[0], 0xca35bd);
  report.cases.push(
    'All 72 songs; raw zero stem assignment; omitted lane; preserved authored palette and puzzle.',
  );

  const beforeAudition = await getLevel(),
    auditionStart = audioRequests.length;
  await page.locator('[data-listen-stem="0"]').click();
  await page.waitForFunction(
    () => {
      const state = document.querySelector('#game').contentWindow.__beatBloom.getAuditionState();
      return state.stem === 0 && !state.loading && !state.error;
    },
    null,
    { timeout: 60000 },
  );
  assert.deepEqual(await getLevel(), beforeAudition);
  const auditionRequests = audioRequests.slice(auditionStart),
    stemZeroSources = [imported.stems[0].source, imported.stems[0].fallbackSource]
      .filter(Boolean)
      .map((source) => new URL(source, origin + '/').pathname);
  assert.ok(auditionRequests.length > 0, 'Listen fetches the requested part.');
  assert.ok(
    auditionRequests.every((path) => stemZeroSources.includes(path)),
    'Audition loads only the selected stem source.',
  );
  assert.equal(await page.locator('[data-listen-stem="0"]').getAttribute('aria-pressed'), 'true');
  await page.locator('[data-listen-stem="0"]').click();
  await page.waitForFunction(
    () =>
      document.querySelector('#game').contentWindow.__beatBloom.getAuditionState().stem === null,
  );
  report.cases.push(
    'Source audition uses a gesture, stops explicitly, and does not alter the level.',
  );

  const gameplayStart = audioRequests.length;
  await page.locator('#pause').click();
  const gameFrame = page.frameLocator('#game');
  if (await gameFrame.locator('.intro-start').isVisible())
    await gameFrame.locator('.intro-start').click();
  else await gameFrame.locator('.queue-ball:not([disabled])').first().click();
  await page.waitForFunction(
    () => document.querySelector('#game').contentWindow.__beatBloom.snapshot().music.ready,
    null,
    { timeout: 60000 },
  );
  const gameplayRequests = audioRequests.slice(gameplayStart),
    selectedSources = imported.stems
      .flatMap((stem) => [stem.source, stem.fallbackSource])
      .filter(Boolean)
      .map((source) => new URL(source, origin + '/').pathname);
  assert.ok(
    gameplayRequests.filter((path) => selectedSources.includes(path)).length >=
      imported.stems.length,
    'A gameplay gesture loads the selected song parts.',
  );
  report.audioRequests = {
    beforeGesture: 0,
    audition: auditionRequests,
    gameplay: gameplayRequests,
    expectedSongSources: selectedSources,
  };
  assert.ok(
    gameplayRequests.every(
      (path) =>
        selectedSources.includes(path) ||
        /^\/assets\/native\/(launch_pluck|bounce_mute|shot_waste|result_lose|bell-61|bell-67|bell-73|bell-79|kick|snare)\.mp3$/.test(
          path,
        ),
    ),
    'Gameplay loads only selected song stems and the ten shared gameplay cues.',
  );
  report.audioRequests = {
    beforeGesture: 0,
    audition: auditionRequests,
    gameplay: gameplayRequests,
  };
  report.cases.push(
    'No startup or picker audio downloads; audition fetches one selected source; gameplay fetches only the chosen song.',
  );

  await page.locator('#profile').selectOption('a-heart');
  await ready('nobatidao');
  await page.locator('#profile').selectOption(imported.id);
  await ready(imported.id);
  assert.deepEqual((await getLevel()).stemLanes, bound.stemLanes);
  await page.waitForFunction(() => !!localStorage.getItem('beatbloom:studio-draft:v1'));
  await page.reload();
  await ready(imported.id);
  assert.equal(await page.locator('#profile').inputValue(), imported.id);
  assert.deepEqual(await getLevel(), bound);
  report.cases.push(
    'Assignments return after song switches; a fresh page restores exact song, puzzle and assignments.',
  );

  const invalid = { ...authored, palette: [] };
  await page.locator('#load-file').setInputFiles({
    name: 'invalid-level.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(invalid)),
  });
  await page.waitForFunction(() =>
    document.querySelector('#editor-message').textContent.startsWith('Level was not changed:'),
  );
  assert.deepEqual(await getLevel(), bound);
  report.cases.push(
    'Malformed cross-song JSON leaves the current preview and authored data intact.',
  );

  // Loading JSON from another known song should route audio before applying all authored data.
  await page.locator('#load-file').setInputFiles({
    name: 'legacy-level.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(authored)),
  });
  await ready('kissmemore');
  assert.deepEqual(await getLevel(), authored);
  await page.locator('#load-file').setInputFiles({
    name: 'assigned-level.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(bound)),
  });
  await ready(imported.id);
  assert.deepEqual(await getLevel(), bound);
  report.cases.push(
    'Cross-song JSON loads select the exact audio and preserve authored assignments.',
  );

  const opened = context.waitForEvent('page');
  await page.locator('#fullscreen').click();
  const popup = await opened;
  await popup.waitForFunction(() => window.__beatBloom?.snapshot().ready, null, { timeout: 60000 });
  assert.deepEqual(await popup.evaluate(() => window.__beatBloom.getLevel()), bound);
  await popup.reload();
  await popup.waitForFunction(() => window.__beatBloom?.snapshot().ready, null, { timeout: 60000 });
  assert.deepEqual(await popup.evaluate(() => window.__beatBloom.getLevel()), bound);
  await popup.close();
  report.cases.push(
    'Open playable and reload retain the selected source song and exact assignments.',
  );

  await page.locator('#share-playable').click();
  await page.locator('#share-dialog').waitFor({ state: 'visible' });
  const shareURL = await page.locator('#share-link').inputValue(),
    shared = await context.newPage();
  await shared.goto(shareURL);
  await shared.waitForFunction(
    () => document.querySelector('#playable')?.contentWindow?.__beatBloom?.snapshot().ready,
    null,
    { timeout: 60000 },
  );
  assert.deepEqual(
    await shared.evaluate(() =>
      document.querySelector('#playable').contentWindow.__beatBloom.getLevel(),
    ),
    bound,
  );
  await shared.close();
  await page.locator('#share-close').click();
  report.cases.push(
    'Share opens an immutable copy with exact selected song and color-to-stem assignments.',
  );

  await page.locator('#export-tab').click();
  await page.locator('#export-network').selectOption('unity');
  const exportedResponse = page.waitForResponse(
    (response) => response.url().endsWith('/api/export') && response.request().method() === 'POST',
    { timeout: 120000 },
  );
  const downloading = page.waitForEvent('download', { timeout: 120000 });
  await page.locator('#export-playable').click();
  const response = await exportedResponse;
  if (!response.ok()) throw Error('Selected-song export failed: ' + (await response.text()));
  const download = await downloading,
    exportPath = resolve(output, 'assigned-song-unity.html');
  await download.saveAs(exportPath);
  assert.equal(await download.failure(), null);
  const html = await readFile(exportPath, 'utf8'),
    metadataMatch = html.match(
      /<script[^>]*id=["']beatbloom-export["'][^>]*>([\s\S]*?)<\/script>/i,
    );
  assert.ok(metadataMatch, 'The export contains reviewable level metadata.');
  const metadata = JSON.parse(metadataMatch[1]);
  assert.deepEqual(metadata.level, bound);
  assert.equal(metadata.profile, 'native');
  assert.ok(Buffer.byteLength(html) <= 5000000);

  report.cases.push(
    'Real Unity HTML export preserves exact selected song, palette and assignments within its size limit.',
  );
  await page.locator('#gameplay-tab').click();

  await page.locator('#advanced-pattern > summary').click();
  await page.locator('#reset-stems').click();
  assert.deepEqual(nonSong(await getLevel()), nonSong(bound));
  assert.notDeepEqual((await getLevel()).stemLanes, bound.stemLanes);
  await page
    .locator('#stem-assignments')
    .screenshot({ path: resolve(output, 'palette-stems.png') });
  await page.screenshot({ path: resolve(output, 'studio-music.png') });
  assert.deepEqual(errors, []);
  report.cases.push(
    'Reset restores assignments only; compact palette remains accessible by native labeled controls.',
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await page.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {});
  report.error = error.stack;
  throw error;
} finally {
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  await context.close();
  await browser.close();
}
