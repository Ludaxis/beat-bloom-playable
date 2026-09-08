import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { encodedAudio } from './audio-variants.mjs';

test('every prepared audio tier matches its source and committed checksum without a media tool', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('../assets/encoded-audio/manifest.json', import.meta.url)),
  );
  assert.ok(Object.keys(manifest.files).length > 10);
  for (const [source, entry] of Object.entries(manifest.files)) {
    for (const [key, variant] of Object.entries(entry.variants)) {
      const [audioSampleRate, audioKbps] = key.split('-').map(Number);
      const bytes = await encodedAudio(source, { audioSampleRate, audioKbps });
      assert.equal(bytes.length, variant.bytes);
      assert.ok(bytes.length > 100);
    }
  }
});

test('unknown audio tiers fail with an actionable preparation message', async () => {
  await assert.rejects(
    encodedAudio('assets/nobatidao-0.mp3', { audioSampleRate: 123, audioKbps: 1 }),
    /Run npm run assets:audio/,
  );
});
