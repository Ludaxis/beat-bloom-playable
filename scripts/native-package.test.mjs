import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { once } from 'node:events';
import { request } from 'node:http';
import { createHash } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import {
  createNativePackage,
  validatePackageOptions,
  MAX_EXPORT_BODY_BYTES,
} from './native-package.mjs';
import { createReviewServer } from './serve.mjs';

const level = JSON.parse(
  await readFile(new URL('../src/native/data/level-6.json', import.meta.url), 'utf8'),
);
const studioDefault = JSON.parse(
  await readFile(new URL('../src/native/data/studio-default.json', import.meta.url), 'utf8'),
);
const stores = {
  ios: 'https://apps.apple.com/app/id123456789',
  android: 'https://play.google.com/store/apps/details?id=io.test.beatbloom',
};
const basic = { network: 'unity', profile: 'native' };
const clone = (value) => JSON.parse(JSON.stringify(value));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const code = (expected) => (error) => error.code === expected;
function assertFixedQueue(actual, source) {
  const { queue, queuePolicy, stemLanes, stemUnlockPolicy, ballScale, ballSpeed, ...rest } = actual;
  const {
    queue: oldQueue,
    queuePolicy: oldPolicy,
    stemLanes: oldLanes,
    stemUnlockPolicy: oldUnlock,
    ballScale: oldBallScale,
    ballSpeed: oldBallSpeed,
    ...before
  } = source;
  assert.equal(ballScale, oldBallScale ?? 0.85);
  assert.equal(ballSpeed, oldBallSpeed ?? 1.0);
  assert.equal(stemUnlockPolicy, 'half-per-color');
  assert.deepEqual(
    stemLanes,
    oldLanes.map((lane) => ({
      ...lane,
      requiredBreaks: Math.max(
        1,
        [...new Set(lane.colors)].reduce(
          (sum, color) =>
            sum + Math.ceil(source.rings.flat().filter((c) => c === color).length / 2),
          0,
        ),
      ),
    })),
  );
  assert.deepEqual(
    rest,
    before,
    'normalizing queue preserves the complete authored field and tuning',
  );
  assert.equal(queuePolicy, 'fixed-three');
  assert.ok(queue.every((ball) => ball.power === 3 && ball.mystery === false));
  source.palette.forEach((_, color) =>
    assert.equal(
      queue.filter((ball) => ball.color === color).length,
      Math.ceil(source.rings.flat().filter((c) => c === color).length / 3),
    ),
  );
}

async function fixtureServer(packageBuilder) {
  const server = createReviewServer(packageBuilder ? { packageBuilder } : undefined);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    server,
    origin,
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
async function post(origin, body, extra = {}) {
  return fetch(`${origin}/api/export`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', ...extra },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
function stubPackage(input) {
  const html = '<html>Offline playable fixture</html>',
    zip = new Uint8Array([80, 75, 3, 4]);
  return {
    html,
    zip,
    htmlBytes: Buffer.byteLength(html),
    zipBytes: zip.length,
    limitBytes: 5_000_000,
    sha256: hash(html),
    zipSha256: hash(zip),
    network: input.network,
    profile: input.profile,
    metadata: { compression: { id: 'test' } },
    filename: `beat-bloom-${input.network}-${input.profile}.${input.format || 'html'}`,
  };
}

test('export options reject enums, path/shell fields, unsupported formats, and missing values', async () => {
  for (const [input, errorCode] of [
    [null, 'INVALID_REQUEST'],
    [[], 'INVALID_REQUEST'],
    [{}, 'INVALID_NETWORK'],
    [{ ...basic, network: '../../meta' }, 'INVALID_NETWORK'],
    [{ ...basic, profile: '$(touch /tmp/pwned)' }, 'INVALID_PROFILE'],
    [{ ...basic, format: '../zip' }, 'INVALID_FORMAT'],
    [{ ...basic, path: '/tmp/export.html' }, 'INVALID_REQUEST'],
    [{ ...basic, network: 'preview' }, 'INVALID_NETWORK'],
  ])
    await assert.rejects(validatePackageOptions(input), code(errorCode));
  assert.equal((await validatePackageOptions(basic)).format, 'html');
});

test('export calls the runtime level validator and enforces playable song/layout/stem limits', async () => {
  for (const mutate of [
    (l) => {
      l.sections = [null];
    },
    (l) => {
      l.motion.flipEaseBeats = null;
    },
    (l) => {
      l.stemLanes = [null];
    },
    (l) => {
      l.queue[0].power = 0;
    },
    (l) => {
      l.palette = [-1];
    },
    (l) => {
      l.ringAppearance = { colorFade: 0.1, shadowOpacity: 2, shadowFade: 0.3 };
    },
    (l) => {
      l.ringAppearance = null;
    },
  ]) {
    const invalid = clone(level);
    mutate(invalid);
    await assert.rejects(
      validatePackageOptions({ ...basic, level: invalid }),
      code('INVALID_LEVEL'),
    );
  }
  await assert.rejects(validatePackageOptions({ ...basic, level: null }), code('INVALID_LEVEL'));
  assert.equal(
    (await validatePackageOptions({ ...basic, profile: 'a-heart', level })).songId,
    level.songId,
  );
  await assert.rejects(
    validatePackageOptions({ ...basic, level: { ...level, songId: '../untrusted' } }),
    code('INVALID_SONG'),
  );
  await assert.rejects(
    validatePackageOptions({ ...basic, level: { ...level, queueColumns: 4 } }),
    code('UNSUPPORTED_LAYOUT'),
  );
  await assert.rejects(
    validatePackageOptions({
      ...basic,
      level: { ...level, stemLanes: [{ stem: 12, colors: [0], requiredBreaks: 1 }] },
    }),
    code('INVALID_STEM_LANE'),
  );
  assertFixedQueue((await validatePackageOptions({ ...basic, level })).level, level);
});

test('legacy imports rebuild minimum power-three queues without changing the field or input', async () => {
  const legacy = clone(level);
  legacy.queue.forEach((ball, index) => {
    ball.mystery = index % 2 === 0;
  });
  const before = clone(legacy),
    options = await validatePackageOptions({ ...basic, level: legacy });
  assert.deepEqual(legacy, before, 'normalizing web exports must preserve authored input');
  assertFixedQueue(options.level, before);
  assert.deepEqual(
    (await validatePackageOptions({ ...basic, level: options.level })).level,
    options.level,
    'normalization is stable',
  );
});

test('manual ring edits rebuild the exported queue from the entire field', async () => {
  const edited = {
    ...clone(level),
    rings: [
      [0, 1, 2],
      [0, 1, 2],
      [0, 1, 2],
    ],
    arenaRingCapacity: 3,
    maxRenderedRings: 3,
    previewRingCount: 0,
  };
  const result = (await validatePackageOptions({ ...basic, level: edited })).level;
  assertFixedQueue(result, edited);
  assert.deepEqual(
    result.queue,
    [0, 1, 2].map((color) => ({ color, power: 3, mystery: false })),
  );
  const reordered = { ...clone(result), queue: [...result.queue].reverse() };
  assert.deepEqual(
    (await validatePackageOptions({ ...basic, level: reordered })).level,
    reordered,
    'valid three-power ordering survives export',
  );
});

test('store links are HTTPS canonical listing URLs with no alternate host, credentials, or injection', async () => {
  assert.deepEqual(
    (await validatePackageOptions({ ...basic, storeURLs: stores })).storeURLs,
    stores,
  );
  for (const bad of [
    'javascript:alert(1)',
    'http://apps.apple.com/app/id123',
    'https://apps.apple.com.attacker.test/app/id123',
    'https://user:pass@apps.apple.com/app/id123',
    'https://apps.apple.com:444/app/id123',
    'https://apps.apple.com/app/id123#x',
    'https://apps.apple.com/',
  ]) {
    await assert.rejects(
      validatePackageOptions({ ...basic, storeURLs: { ...stores, ios: bad } }),
      code('INVALID_STORE_URLS'),
    );
  }
  for (const bad of [
    'https://play.google.com/',
    'https://play.google.com/store/apps/details?id=',
    'https://play.google.com.evil.test/store/apps/details?id=io.test.app',
  ]) {
    await assert.rejects(
      validatePackageOptions({ ...basic, storeURLs: { ...stores, android: bad } }),
      code('INVALID_STORE_URLS'),
    );
  }
});

test('Meta ignores unused store overrides because its campaign owns the install destination', async () => {
  for (const storeURLs of [
    undefined,
    stores,
    { ios: '', android: '' },
    { ios: 'javascript:alert(1)', android: 'https://tracking.example.invalid' },
  ]) {
    assert.equal(
      (await validatePackageOptions({ network: 'meta', profile: 'native', storeURLs })).storeURLs,
      null,
    );
  }
});

test('HTTP rejects invalid imports and foreign/missing origins before invoking the builder', async () => {
  let builds = 0;
  const fixture = await fixtureServer((input) => {
    builds++;
    return stubPackage(input);
  });
  try {
    for (const [body, headers, status, errorCode] of [
      ['{', {}, 400, 'INVALID_JSON'],
      ['null', {}, 400, 'INVALID_REQUEST'],
      [{ ...basic, network: '../../tmp' }, {}, 400, 'INVALID_NETWORK'],
      [{ ...basic, level: { ...level, sections: [null] } }, {}, 422, 'INVALID_LEVEL'],
      [
        { ...basic, storeURLs: { ...stores, android: 'file:///tmp/secret' } },
        {},
        400,
        'INVALID_STORE_URLS',
      ],
      [basic, { origin: 'https://foreign.test' }, 403, 'INVALID_ORIGIN'],
      [basic, { origin: 'null' }, 403, 'INVALID_ORIGIN'],
      [basic, { 'sec-fetch-site': 'cross-site' }, 403, 'INVALID_ORIGIN'],
      [basic, { 'content-type': 'text/plain' }, 415, 'INVALID_CONTENT_TYPE'],
      [basic, { 'content-encoding': 'gzip' }, 415, 'INVALID_CONTENT_ENCODING'],
    ]) {
      const response = await post(fixture.origin, body, headers);
      assert.equal(response.status, status);
      assert.equal((await response.json()).code, errorCode);
    }
    const missing = await fetch(`${fixture.origin}/api/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(basic),
    });
    assert.equal(missing.status, 403);
    await missing.arrayBuffer();
    const get = await fetch(`${fixture.origin}/api/export`);
    assert.equal(get.status, 405);
    assert.equal(get.headers.get('allow'), 'POST');
    await get.arrayBuffer();
    assert.equal(builds, 0);
  } finally {
    await fixture.close();
  }
});

test('HTTP enforces the 256 KiB limit for declared and chunked request bodies', async () => {
  let builds = 0;
  const fixture = await fixtureServer((input) => {
    builds++;
    return stubPackage(input);
  });
  try {
    const tooBig = await post(fixture.origin, ' '.repeat(MAX_EXPORT_BODY_BYTES + 1));
    assert.equal(tooBig.status, 413);
    assert.equal((await tooBig.json()).code, 'BODY_TOO_LARGE');
    const chunked = await new Promise((resolve, reject) => {
      const req = request(
        `${fixture.origin}/api/export`,
        {
          method: 'POST',
          headers: {
            origin: fixture.origin,
            'content-type': 'application/json',
            'transfer-encoding': 'chunked',
          },
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
        },
      );
      req.on('error', reject);
      req.write(' '.repeat(160_000));
      req.end(' '.repeat(160_000));
    });
    assert.equal(chunked.status, 413);
    assert.equal(chunked.body.code, 'BODY_TOO_LARGE');
    assert.equal(builds, 0);
  } finally {
    await fixture.close();
  }
});

test('HTTP allows only one heavy build and recovers after completion/failure', async () => {
  let release, started;
  const entered = new Promise((resolve) => (started = resolve));
  let calls = 0;
  const fixture = await fixtureServer(async (input) => {
    calls++;
    if (calls === 1) {
      started();
      await new Promise((resolve) => (release = resolve));
    }
    if (calls === 3) throw Error('Deliberate test build failure');
    return stubPackage(input);
  });
  try {
    const pending = post(fixture.origin, basic);
    await entered;
    const busy = await post(fixture.origin, basic);
    assert.equal(busy.status, 429);
    assert.equal((await busy.json()).code, 'EXPORT_BUSY');
    assert.equal(calls, 1);
    release();
    const first = await pending;
    assert.equal(first.status, 200);
    const expected = stubPackage(basic);
    assert.equal(first.headers.get('x-playable-html-bytes'), String(expected.htmlBytes));
    assert.equal(first.headers.get('x-playable-limit-bytes'), String(expected.limitBytes));
    assert.equal(first.headers.get('x-playable-sha256'), expected.sha256);
    assert.equal(first.headers.get('x-playable-zip-sha256'), expected.zipSha256);
    assert.equal(first.headers.get('x-playable-compression'), 'test');
    await first.arrayBuffer();
    const next = await post(fixture.origin, { ...basic, format: 'zip' });
    assert.equal(next.status, 200);
    assert.equal(next.headers.get('content-type'), 'application/zip');
    assert.match(next.headers.get('content-disposition'), /\.zip"$/);
    await next.arrayBuffer();
    const fail = await post(fixture.origin, basic);
    assert.equal(fail.status, 500);
    assert.equal((await fail.json()).code, 'EXPORT_FAILED');
    const recovered = await post(fixture.origin, basic);
    assert.equal(recovered.status, 200);
    await recovered.arrayBuffer();
  } finally {
    release?.();
    await fixture.close();
  }
});

test('real native and Sunflower Meta packages fit, preserve edited settings, and contain one-file ZIPs', async () => {
  const manifest = new URL('../dist/manifest.json', import.meta.url),
    before = await stat(manifest).catch(() => null);
  const edited = clone(level);
  edited.shape = 'flower';
  edited.flowerPetals = 7;
  edited.lineThickness = 0.2;
  edited.palette[0] = 0xff22aa;
  edited.ringAppearance = { colorFade: 0.125, shadowOpacity: 0.34, shadowFade: 0.46 };
  edited.innerRadius = 4.35;
  edited.tutorial = { enabled: true, placement: 'slots' };
  edited.endCard = {
    headline: 'Make music.\nPlay your way.',
    ctaLabel: 'Play Now',
    ctaColor: 0x8844ee,
    backgroundColor: 0x130c22,
    logoWidth: 250,
    iconSize: 120,
  };
  edited.name = 'Export </script><script>globalThis.__injected=1</script>';
  const original = clone(edited);
  const result = await createNativePackage({
    network: 'meta',
    profile: 'native',
    level: edited,
    storeURLs: stores,
  });
  assert.deepEqual(edited, original);
  assert.ok(result.htmlBytes < 2_000_000);
  assert.equal(result.htmlBytes, Buffer.byteLength(result.html));
  assert.equal(result.sha256, hash(result.html));
  assert.equal(result.zipSha256, hash(result.zip));
  assert.match(result.filename, /-flower-12layers\.html$/);
  const content = /id="beatbloom-export" type="application\/json">([\s\S]*?)<\/script>/.exec(
    result.html,
  )?.[1];
  assert.ok(content);
  const metadata = JSON.parse(content);
  assertFixedQueue(metadata.level, edited);
  assert.equal(metadata.effectiveStoreURLs, null);
  assert.equal(metadata.storeURLs, null);
  assert.equal(metadata.destinationMode, 'campaign');
  assert.equal(metadata.concept, 'Footer0FreeToPlay');
  assert.equal(result.html.includes('</script><script>globalThis.__injected'), false);
  assert.equal(result.html.includes('__beatBloom'), false);
  assert.equal(result.html.includes('src="mraid.js"'), false);
  assert.equal(result.html.includes('mysteryTitle'), false, 'mystery artwork must not be packaged');
  const zip = unzipSync(result.zip);
  assert.deepEqual(Object.keys(zip), ['index.html']);
  assert.equal(strFromU8(zip['index.html']), result.html);
  const nativeDefault = await createNativePackage({ network: 'meta', profile: 'native' });
  assert.ok(nativeDefault.htmlBytes < 2_000_000);
  assert.equal(nativeDefault.metadata.level.songId, studioDefault.songId);
  assertFixedQueue(nativeDefault.metadata.level, studioDefault);
  assert.equal(
    nativeDefault.metadata.level.queue.length,
    studioDefault.palette.reduce(
      (sum, _, color) =>
        sum + Math.ceil(studioDefault.rings.flat().filter((c) => c === color).length / 3),
      0,
    ),
  );
  assert.ok(nativeDefault.metadata.level.queue.every((ball) => ball.mystery === false));
  assert.deepEqual(
    nativeDefault.metadata.level.referenceCalibration,
    studioDefault.referenceCalibration,
  );
  assert.ok(nativeDefault.metadata.level.queue.every((ball) => ball.power === 3));
  const sunflower = await createNativePackage({ network: 'meta', profile: 'b-flower' });
  assert.ok(sunflower.htmlBytes < 2_000_000);
  assert.equal(sunflower.metadata.songId, 'sunflower');
  assert.equal(sunflower.metadata.concept, 'Tagline0Logo');
  assert.equal(sunflower.metadata.level.shape, 'flower');
  assert.equal(sunflower.metadata.level.songId, 'sunflower');
  assert.ok(sunflower.metadata.level.queue.every((ball) => ball.mystery === false));
  const unity = await createNativePackage({
    network: 'unity',
    profile: 'native',
    level: edited,
    storeURLs: stores,
    format: 'zip',
  });
  assert.ok(unity.htmlBytes < 5_000_000);
  assert.equal(
    (unity.html.match(/<script src="[^"]+"/g) || []).join(),
    '\u003cscript src="mraid.js"',
  );
  const after = await stat(manifest).catch(() => null);
  assert.equal(before?.mtimeMs, after?.mtimeMs, 'API packaging must not rewrite standard dist');
  console.log(
    JSON.stringify({
      nativeMeta: { htmlBytes: result.htmlBytes, compression: result.metadata.compression },
      nativeDefaultMeta: {
        htmlBytes: nativeDefault.htmlBytes,
        compression: nativeDefault.metadata.compression,
      },
      sunflowerMeta: {
        htmlBytes: sunflower.htmlBytes,
        compression: sunflower.metadata.compression,
      },
      nativeUnity: { htmlBytes: unity.htmlBytes },
    }),
  );
});
