import { unitySource } from './unity-source.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const TUTORIAL_ASSET_FILES = Object.freeze({
  tutorialHand: 'assets/native/tutorial-hand.webp',
  tutorialHandTap: 'assets/native/tutorial-hand-tap.webp',
  tutorialTip: 'assets/native/tutorial-tip.webp',
});
const sources = {
  idle: {
    path: 'Assets/UI/Common/Assets/Icons-Common/Icon-Hand-Idle.png',
    guid: '44a76ed82e3324610b419ca36d67d465',
  },
  tap: {
    path: 'Assets/UI/Common/Assets/Icons-Common/Icon-Hand-Tap.png',
    guid: '978da294fbc354c3f82fc8f938bb18e7',
  },
  tip: {
    path: 'Assets/UI/Common/Assets/Backgrounds/Bg-Bubble 04.png',
    guid: '610e0fed88e774032a9278c31b1cc795',
  },
};
let prepared;
/** Original game art, without trimming: both native fingertip positions stay aligned. */
export function prepareTutorialAssets(refresh = false) {
  return (prepared ??= refresh ? prepare() : usePrepared());
}
async function usePrepared() {
  // Shipping builds consume reviewed, checked-in media and never reach into Unity.
  await Promise.all(
    Object.values(TUTORIAL_ASSET_FILES).map((path) => readFile(resolve(root, path))),
  );
  return { ...TUTORIAL_ASSET_FILES };
}
async function prepare() {
  const repo = unitySource();
  const handPrefab = await readFile(
    resolve(repo, 'Assets/UI/Common/Prefabs/Element-Hand.prefab'),
    'utf8',
  );
  const tipPrefab = await readFile(
    resolve(repo, 'Assets/UI/Common/Prefabs/Element-TutorialTip.prefab'),
    'utf8',
  );
  const animation = await readFile(
    resolve(repo, 'Assets/UI/Common/Animations/Hand/Tap-Animate L.anim'),
    'utf8',
  );
  for (const [key, source] of Object.entries(sources)) {
    const meta = await readFile(resolve(repo, source.path + '.meta'), 'utf8');
    if (!meta.includes(`guid: ${source.guid}`))
      throw Error(
        `Tutorial ${key} source GUID changed; review the native prefab before repacking.`,
      );
    if (
      !(key === 'tip' ? tipPrefab : key === 'idle' ? handPrefab : animation).includes(
        `guid: ${source.guid}`,
      )
    )
      throw Error(`Tutorial ${key} art is not the prefab/animation's referenced sprite.`);
  }
  const idle = await readFile(resolve(repo, sources.idle.path)),
    tap = await readFile(resolve(repo, sources.tap.path));
  const idleSize = await sharp(idle).metadata(),
    tapSize = await sharp(tap).metadata();
  if (
    idleSize.width !== 256 ||
    idleSize.height !== 256 ||
    tapSize.width !== 256 ||
    tapSize.height !== 256
  )
    throw Error(
      'Tutorial hand frame dimensions changed; update the anchor/atlas contract explicitly.',
    );
  await mkdir(resolve(root, 'assets/native'), { recursive: true });
  const hand = await sharp(idle).webp({ quality: 84, alphaQuality: 100, effort: 6 }).toBuffer();
  const handTap = await sharp(tap).webp({ quality: 84, alphaQuality: 100, effort: 6 }).toBuffer();
  // Bake the native sliced bubble at 2× its 500×58 logical strip size. A single texture avoids
  // browser border-image interpolation seams between the nine slices at fractional game scales.
  const tipSource = await readFile(resolve(repo, sources.tip.path));
  const [left, center, right] = await Promise.all([
    sharp(tipSource)
      .extract({ left: 0, top: 0, width: 128, height: 256 })
      .resize(58, 116, { fit: 'fill' })
      .png()
      .toBuffer(),
    sharp(tipSource)
      .extract({ left: 127, top: 0, width: 2, height: 256 })
      .resize(884, 116, { fit: 'fill' })
      .png()
      .toBuffer(),
    sharp(tipSource)
      .extract({ left: 128, top: 0, width: 128, height: 256 })
      .resize(58, 116, { fit: 'fill' })
      .png()
      .toBuffer(),
  ]);
  const tip = await sharp({
    create: { width: 1000, height: 116, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      { input: left, left: 0, top: 0 },
      { input: center, left: 58, top: 0 },
      { input: right, left: 942, top: 0 },
    ])
    .webp({ quality: 82, alphaQuality: 100, effort: 6 })
    .toBuffer();
  await writeFile(resolve(root, TUTORIAL_ASSET_FILES.tutorialHand), hand);
  await writeFile(resolve(root, TUTORIAL_ASSET_FILES.tutorialHandTap), handTap);
  await writeFile(resolve(root, TUTORIAL_ASSET_FILES.tutorialTip), tip);
  const provenance = {
    version: 1,
    sourceArt: await Promise.all(
      Object.entries(sources).map(async ([key, value]) => ({
        key,
        ...value,
        sha256: createHash('sha256')
          .update(await readFile(resolve(repo, value.path)))
          .digest('hex'),
      })),
    ),
    hand: {
      frames: ['idle', 'tap'],
      sourceFramePixels: 256,
      outputFramePixels: 256,
      nativePrefabPixels: 280,
      fingertip: [57 / 280, 64 / 280],
      nativeLoopSeconds: 0.68333334,
      nativeTapAtSeconds: 0.5,
      nativeScale: [1.1, 1],
      operation:
        'Untrimmed original PNGs encoded at original 256px as quality 84 WebP with 100% alpha quality; no redraw or recoloring.',
    },
    tip: {
      outputPixels: [1000, 116],
      operation:
        'Original Bg-Bubble04 native sliced strip baked at 2× logical size from its left cap, center column and right cap; quality 82 WebP with 100% alpha quality. Single texture prevents browser slice seams; no redraw/recoloring.',
    },
    outputs: Object.fromEntries(
      Object.entries(TUTORIAL_ASSET_FILES).map(([key, path]) => [
        key,
        {
          path,
          bytes:
            key === 'tutorialHand'
              ? hand.length
              : key === 'tutorialHandTap'
                ? handTap.length
                : tip.length,
        },
      ]),
    ),
  };
  await writeFile(
    resolve(root, 'assets/native/tutorial-provenance.json'),
    JSON.stringify(provenance, null, 2) + '\n',
  );
  return { ...TUTORIAL_ASSET_FILES };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(await prepareTutorialAssets(true));
