import { readFile, writeFile, mkdir, copyFile, cp } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';
import { createNativePackage, EXPORT_PROFILES } from './native-package.mjs';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  dist = resolve(root, 'dist');
const previewOnly = process.argv.slice(2).includes('--preview');
const generated = [],
  allZip = {};
await mkdir(dist, { recursive: true });
await build({
  entryPoints: [resolve(root, 'src/native/pattern-worker.ts')],
  outfile: resolve(root, 'review/pattern-worker.js'),
  bundle: true,
  minify: true,
  platform: 'browser',
  target: 'es2020',
});
// Publish the Studio and its self-contained shared-link viewer beside the playables.
await cp(resolve(root, 'review'), resolve(dist, 'review'), { recursive: true });
// Hosted previews share prepared URL assets; offline exports still embed selected-song assets only.
await cp(resolve(root, 'assets'), resolve(dist, 'assets'), { recursive: true });
for (const network of previewOnly ? ['preview'] : ['preview', 'unity', 'applovin', 'meta']) {
  await mkdir(resolve(dist, network), { recursive: true });
  for (const profile of network === 'preview'
    ? EXPORT_PROFILES
    : EXPORT_PROFILES.filter((p) => p !== 'native')) {
    const result = await createNativePackage(
      { network, profile },
      { allowPreview: true, hosted: network === 'preview' },
    );
    await writeFile(resolve(dist, network, `${profile}.html`), result.html);
    await writeFile(resolve(dist, network, `${profile}.zip`), result.zip);
    const { htmlBytes, zipBytes, limitBytes, withinLimit, sha256, zipSha256 } = result;
    generated.push({
      network,
      profile,
      html: `${network}/${profile}.html`,
      zip: `${network}/${profile}.zip`,
      htmlBytes,
      zipBytes,
      limitBytes,
      withinLimit,
      sha256,
      zipSha256,
      compression: result.metadata.compression,
    });
    if (network !== 'preview') allZip[`${network}/${profile}/index.html`] = strToU8(result.html);
  }
}
const manifest = JSON.stringify(
  {
    version: '2.0.0',
    defaultLevel: 'src/native/data/studio-default.json',
    status: 'local build; host approval requires network validation',
    generated,
  },
  null,
  2,
);
await writeFile(resolve(dist, previewOnly ? 'preview-manifest.json' : 'manifest.json'), manifest);
await writeFile(
  resolve(dist, 'QA.md'),
  '# Beat Bloom playable QA\n\nRun npm run verify for current checks. Browser results are written to qa/native/latest. Package sizes and SHA-256 hashes are in manifest.json. Local checks do not replace live ad-network validation.\n',
);
if (!previewOnly) {
  allZip['manifest.json'] = strToU8(manifest);
  allZip['README.md'] = new Uint8Array(await readFile(resolve(root, 'README.md')));
  allZip['THIRD_PARTY_NOTICES.txt'] = new Uint8Array(
    await readFile(resolve(root, 'THIRD_PARTY_NOTICES.txt')),
  );
  await writeFile(resolve(dist, 'beat-bloom-delivery.zip'), zipSync(allZip, { level: 9 }));
}
console.table(
  generated.map((x) => ({
    network: x.network,
    profile: x.profile,
    htmlKB: Math.round(x.htmlBytes / 1000),
    zipKB: Math.round(x.zipBytes / 1000),
    compression: x.compression.id,
    withinLimit: x.withinLimit,
  })),
);
