import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Unity is optional: packaged assets and level data support standalone development. */
export function unitySource(required = true) {
  const configured = process.env.BEAT_BLOOM_UNITY_PROJECT;
  if (configured && existsSync(resolve(configured, 'Assets'))) return resolve(configured);
  if (!required && !configured) return null;
  throw new Error(
    'Set BEAT_BLOOM_UNITY_PROJECT to the Unity project folder containing Assets. Normal build and development use the checked-in playable assets.',
  );
}
