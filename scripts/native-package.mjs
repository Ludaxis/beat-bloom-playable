import { encodedAudio } from './audio-variants.mjs';
import { build, transform } from 'esbuild';
import { readFile, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';
import sharp from 'sharp';
import { checkArtwork } from './check-artwork.mjs';
import { prepareTutorialAssets, TUTORIAL_ASSET_FILES } from './tutorial-assets.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const EXPORT_NETWORKS = Object.freeze(['unity', 'applovin', 'meta']);
export const EXPORT_PROFILES = Object.freeze([
  'native',
  'a-heart',
  'a-flower',
  'b-heart',
  'b-flower',
]);
export const MAX_EXPORT_BODY_BYTES = 256 * 1024;
export const NETWORK_LIMIT_BYTES = Object.freeze({
  preview: 5_000_000,
  unity: 5_000_000,
  applovin: 5_000_000,
  meta: 2_000_000,
});
const ORIGINAL = Object.freeze({
  id: 'original',
  animationWidth: null,
  imageQuality: null,
  audioKbps: null,
  audioSampleRate: null,
});
// Preserve every stem's full duration and common sample clock. Lower tiers reduce encoding
// quality only; no missing instruments, truncated music, or remote asset fallbacks.
const META_TIERS = [
  { id: 'meta-32k', animationWidth: 768, imageQuality: 76, audioKbps: 32, audioSampleRate: 32000 },
  // MP3 at 32 kHz has a 32 kbps minimum; 22.05 kHz permits true 24/16 kbps MPEG-2.
  { id: 'meta-24k', animationWidth: 768, imageQuality: 76, audioKbps: 24, audioSampleRate: 22050 },
  {
    id: 'meta-24k-small',
    animationWidth: 640,
    imageQuality: 72,
    audioKbps: 24,
    audioSampleRate: 22050,
  },
  {
    id: 'meta-16k-small',
    animationWidth: 512,
    imageQuality: 68,
    audioKbps: 16,
    audioSampleRate: 22050,
  },
];
const COMMON_IMAGES = ['lock', 'clef', 'logo', 'icon'];
const EFFECTS = [
  'launch_pluck',
  'bounce_mute',
  'shot_waste',
  'result_lose',
  'bell-61',
  'bell-67',
  'bell-73',
  'bell-79',
  'kick',
  'snare',
];
const SONGS = Object.freeze({
  kissmemore: {
    instruments: ['ukulele', 'violin', 'piano', 'drum'],
    stems: 5,
    prefix: 'assets/native/kissmemore',
  },
  nobatidao: { instruments: ['piano', 'trumpet'], stems: 3, prefix: 'assets/nobatidao' },
  sunflower: {
    instruments: ['ukulele', 'violin', 'xylophone', 'drum'],
    stems: 5,
    prefix: 'assets/sunflower',
  },
});
const assetCache = new Map();
let validatorPromise;

export class NativePackageError extends Error {
  constructor(code, message, status = 400, details) {
    super(message);
    this.name = 'NativePackageError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
export const songForProfile = (profile) =>
  profile === 'native' ? 'kissmemore' : profile.endsWith('flower') ? 'sunflower' : 'nobatidao';

async function nativeContract() {
  // Import the exact runtime validator and creative defaults, not independent schema/profile copies.
  validatorPromise ??= build({
    stdin: {
      contents:
        "export {validateNativeLevel} from './src/native/model.ts'; export {getPlayableLevel,conceptForProfile} from './src/native/creative.ts'; export {DEFAULT_STORE_URLS} from './src/network-settings.ts';",
      resolveDir: root,
      sourcefile: 'native-export-validator.ts',
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'silent',
  })
    .then(
      (result) =>
        import(
          `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
        ),
    )
    .then((module) => ({
      validateNativeLevel: module.validateNativeLevel,
      getPlayableLevel: module.getPlayableLevel,
      conceptForProfile: module.conceptForProfile,
      storeURLs: module.DEFAULT_STORE_URLS,
    }));
  return validatorPromise;
}

function validateStoreURLs(value) {
  if (!isObject(value) || Object.keys(value).some((key) => !['ios', 'android'].includes(key)))
    throw new NativePackageError(
      'INVALID_STORE_URLS',
      'storeURLs must contain ios and android store links.',
    );
  const result = {};
  for (const platform of ['ios', 'android']) {
    const input = value[platform];
    if (typeof input !== 'string' || input.length > 2048)
      throw new NativePackageError(
        'INVALID_STORE_URLS',
        `${platform} must be a valid HTTPS store URL.`,
      );
    let url;
    try {
      url = new URL(input);
    } catch {
      throw new NativePackageError(
        'INVALID_STORE_URLS',
        `${platform} must be a valid HTTPS store URL.`,
      );
    }
    const common =
      url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash;
    const store =
      platform === 'ios'
        ? url.hostname === 'apps.apple.com' &&
          /^\/(?:[a-z]{2}\/)?app\/(?:[^/]+\/)?id\d+\/?$/i.test(url.pathname)
        : url.hostname === 'play.google.com' &&
          url.pathname === '/store/apps/details' &&
          /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/.test(url.searchParams.get('id') || '');
    if (!common || !store)
      throw new NativePackageError(
        'INVALID_STORE_URLS',
        `${platform} must link directly to its official HTTPS app-store listing.`,
      );
    result[platform] = url.href;
  }
  return result;
}

export async function validatePackageOptions(input, { allowPreview = false } = {}) {
  if (!isObject(input))
    throw new NativePackageError('INVALID_REQUEST', 'Export options must be a JSON object.');
  if (
    Object.keys(input).some(
      (key) => !['network', 'profile', 'level', 'storeURLs', 'format'].includes(key),
    )
  )
    throw new NativePackageError('INVALID_REQUEST', 'Export options contain an unsupported field.');
  if (![...EXPORT_NETWORKS, ...(allowPreview ? ['preview'] : [])].includes(input.network))
    throw new NativePackageError('INVALID_NETWORK', 'Choose Unity Ads, AppLovin, or Meta.');
  if (!EXPORT_PROFILES.includes(input.profile))
    throw new NativePackageError(
      'INVALID_PROFILE',
      'Choose one of the five available creative profiles.',
    );
  if (input.format !== undefined && !['html', 'zip'].includes(input.format))
    throw new NativePackageError('INVALID_FORMAT', 'Export format must be html or zip.');
  let serialized;
  try {
    serialized = JSON.stringify(input);
  } catch {
    throw new NativePackageError('INVALID_REQUEST', 'Export options must be JSON serializable.');
  }
  if (Buffer.byteLength(serialized) > MAX_EXPORT_BODY_BYTES)
    throw new NativePackageError('BODY_TOO_LARGE', 'Export options exceed 256 KiB.', 413);
  const songId = songForProfile(input.profile);
  let level = null;
  if (input.level !== undefined) {
    const contract = await nativeContract();
    const errors = contract.validateNativeLevel(input.level, { queueBalance: false });
    if (errors.length) throw new NativePackageError('INVALID_LEVEL', errors.join(' '), 422, errors);
    if (input.level.songId !== songId)
      throw new NativePackageError(
        'PROFILE_SONG_MISMATCH',
        `This profile embeds ${songId}; the level must use the same song.`,
        422,
      );
    if (
      input.level.queueColumns !== 3 ||
      input.level.activeCapacity !== 3 ||
      input.level.trayCapacity !== 3
    )
      throw new NativePackageError(
        'UNSUPPORTED_LAYOUT',
        'This playable supports three queue columns, three active balls, and three storage slots.',
        422,
      );
    if (input.level.stemLanes.some((lane) => lane.stem >= SONGS[songId].stems))
      throw new NativePackageError(
        'INVALID_STEM_LANE',
        'The level references an instrument stem absent from this song.',
        422,
      );
    level = contract.getPlayableLevel(input.profile, input.level);
  }
  // Meta's exit API takes no URL: campaign settings own the destination. Unused
  // link fields from older studio clients must not block a Meta export.
  return {
    network: input.network,
    profile: input.profile,
    format: input.format || 'html',
    songId,
    level,
    storeURLs:
      input.network === 'meta' || input.storeURLs === undefined
        ? null
        : validateStoreURLs(input.storeURLs),
  };
}

async function packAsset(relativePath, mime, tier) {
  // All file paths originate in the fixed asset manifest above, never in request fields.
  const path = resolve(root, relativePath),
    info = await stat(path);
  const key = `${relativePath}:${info.size}:${info.mtimeMs}:${tier.id}`;
  if (!assetCache.has(key)) {
    const promise = (async () => {
      let buffer;
      if (tier.id !== 'original' && relativePath.endsWith('.webp')) {
        const image = sharp(path),
          meta = await image.metadata();
        const imageLimit =
          relativePath === 'assets/logo.webp'
            ? 512
            : relativePath === 'assets/icon.webp'
              ? 256
              : 192;
        const width = relativePath.includes('-animation')
          ? Math.min(meta.width, tier.animationWidth)
          : Math.min(meta.width, imageLimit);
        buffer = await image
          .resize({ width })
          .webp({ quality: tier.imageQuality, alphaQuality: 90 })
          .toBuffer();
      } else if (tier.id !== 'original' && relativePath.endsWith('.mp3')) {
        buffer = await encodedAudio(relativePath, tier);
      } else buffer = await readFile(path);
      return `data:${mime};base64,${buffer.toString('base64')}`;
    })();
    if (assetCache.size > 320) assetCache.clear();
    assetCache.set(key, promise);
    promise.catch(() => assetCache.delete(key));
  }
  return assetCache.get(key);
}

const safeJSON = (value) =>
  JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

/** In-memory, self-contained package. No delivery-directory writes or user-controlled paths. */
export async function createNativePackage(input, { allowPreview = false } = {}) {
  const options = await validatePackageOptions(input, { allowPreview });
  await prepareTutorialAssets();
  await checkArtwork(root);
  const { network, profile, songId, level, storeURLs } = options,
    song = SONGS[songId],
    limitBytes = NETWORK_LIMIT_BYTES[network];
  const contract = await nativeContract();
  // Metadata describes the exact playable, including defaults. A null runtime override lets
  // the shared creative module supply those defaults without duplicating another JS literal.
  const effectiveLevel = contract.getPlayableLevel(profile, level),
    concept = contract.conceptForProfile(profile);
  const styles = await Promise.all(
    ['styles.css', 'tutorial-view.css'].map((file) =>
      readFile(resolve(root, 'src/native', file), 'utf8'),
    ),
  );
  const css = (
    await transform(
      styles
        .join('\n')
        .replace('__FONT__', await packAsset('assets/lilita.ttf', 'font/ttf', ORIGINAL)),
      { loader: 'css', minify: true },
    )
  ).code;
  const notices = (await readFile(resolve(root, 'THIRD_PARTY_NOTICES.txt'), 'utf8')).replace(
    /--/g,
    '—',
  );
  let lastBytes;
  for (const compression of network === 'meta' ? META_TIERS : [ORIGINAL]) {
    const assets = {};
    // Preserve the native hand's proportions and the strip's slice coordinates in every tier.
    for (const [key, path] of Object.entries(TUTORIAL_ASSET_FILES))
      assets[key] = await packAsset(path, 'image/webp', ORIGINAL);
    for (const name of COMMON_IMAGES)
      assets[name] = await packAsset(
        name === 'logo' || name === 'icon' ? `assets/${name}.webp` : `assets/native/${name}.webp`,
        'image/webp',
        compression,
      );
    for (const instrument of song.instruments)
      assets[`${instrument}Animation`] = await packAsset(
        `assets/native/${instrument}-animation.webp`,
        'image/webp',
        compression,
      );
    for (let i = 0; i < song.stems; i++)
      assets[`stem${i}`] = await packAsset(`${song.prefix}-${i}.mp3`, 'audio/mpeg', compression);
    for (const name of EFFECTS)
      assets[name] = await packAsset(`assets/native/${name}.mp3`, 'audio/mpeg', compression);
    const result = await build({
      entryPoints: [resolve(root, 'src/native/main.ts')],
      bundle: true,
      write: false,
      minify: true,
      target: ['es2020'],
      format: 'iife',
      legalComments: 'none',
      logLevel: 'silent',
      define: {
        __ASSETS__: JSON.stringify(assets),
        __PROFILE__: JSON.stringify(profile),
        __NETWORK__: JSON.stringify(network),
        __PREVIEW__: String(network === 'preview'),
        __LEVEL_OVERRIDE__: JSON.stringify(level),
        __STORE_URLS__: JSON.stringify(storeURLs),
      },
    });
    const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
    const host =
      network === 'unity' || network === 'applovin' ? '<script src="mraid.js"></script>' : '';
    const metadata = {
      version: 1,
      network,
      profile,
      concept,
      songId,
      level: effectiveLevel,
      storeURLs,
      effectiveStoreURLs: network === 'meta' ? null : storeURLs || contract.storeURLs,
      destinationMode: network === 'meta' ? 'campaign' : 'store-links',
      compression,
    };
    const html = `<!doctype html><!-- ${notices} --><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="ad.size" content="width=576,height=1280"><title>Beat Bloom</title><style>${css}</style>${host}</head><body><script id="beatbloom-export" type="application/json">${safeJSON(metadata)}</script><script>${js}</script></body></html>`;
    const htmlBytes = Buffer.byteLength(html);
    lastBytes = htmlBytes;
    if (htmlBytes >= limitBytes) continue;
    const zip = zipSync({ 'index.html': strToU8(html) }, { level: 9 });
    return {
      html,
      zip,
      htmlBytes,
      zipBytes: zip.length,
      limitBytes,
      withinLimit: true,
      sha256: sha256(html),
      zipSha256: sha256(zip),
      metadata,
      network,
      profile,
      format: options.format,
      filename: `beat-bloom-${network}-${profile}${level ? `-${level.shape}-${level.rings.length}layers` : ''}.${options.format}`,
    };
  }
  throw new NativePackageError(
    'PACKAGE_TOO_LARGE',
    `The ${network} package is ${lastBytes.toLocaleString('en-US')} bytes after available compression; its HTML must stay below ${limitBytes.toLocaleString('en-US')} bytes.`,
    422,
    { htmlBytes: lastBytes, limitBytes },
  );
}
