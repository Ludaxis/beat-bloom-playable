import { cloneLevel, DEFAULT_NATIVE_LEVEL } from './config';
import studioDefault from './data/studio-default.json';
import charts from '../../assets/native/charts.json';
import type { NativeLevel } from './types';
import { normalizePlayableQueue } from './queue';

export const END_CARD = {
  revealDelaySeconds: 4,
  installLabel: 'Install Now',
  replayLabel: 'Replay',
  successHeadline: 'You made the music!',
  taglineHeadline: 'Match colors.\nBuild the beat.',
  failureHeadline: 'Try another order',
};

export const conceptForProfile = (profile: string) =>
  profile.startsWith('b-') ? 'Tagline0Logo' : 'Footer0FreeToPlay';

/** One profile definition shared by the studio runtime and exported package metadata. */
export function getPlayableLevel(profile: string, override?: NativeLevel | null): NativeLevel {
  if (override) return normalizePlayableQueue(override);
  const level = cloneLevel(
    profile === 'native' ? (studioDefault as NativeLevel) : DEFAULT_NATIVE_LEVEL,
  );
  if (profile !== 'native') {
    level.shape = profile.endsWith('flower') ? 'flower' : 'heart';
    level.name = level.shape === 'flower' ? 'Sunflower' : 'NO BATIDÃO';
    level.songId = level.shape === 'flower' ? 'sunflower' : 'nobatidao';
    const chart = charts[level.songId as keyof typeof charts];
    level.bpm = chart.bpm;
    level.loopBeats = chart.loopBeats;
    level.downbeatOffset = chart.downbeatOffset;
    level.sections = chart.sections;
    if (level.songId === 'nobatidao')
      level.stemLanes = [
        { stem: 1, colors: [0, 1], requiredBreaks: 20 },
        { stem: 2, colors: [2, 3], requiredBreaks: 30 },
      ];
  }
  return normalizePlayableQueue(level);
}
