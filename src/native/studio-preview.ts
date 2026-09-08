import { validateNativeLevel } from './model';
import { normalizePlayableQueue } from './queue';
import type { NativeLevel } from './types';

// Used only by local previews. Production exports embed their level directly.
export function loadStudioPreview(profile: string, fallback: NativeLevel): NativeLevel {
  const id = new URLSearchParams(location.search).get('studioLevel');
  if (id === null) return fallback;
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))
    throw Error('Invalid studio preview link. Open your level again from the studio.');
  const raw = localStorage.getItem(`beatbloom:studio-preview:${id}`);
  if (!raw)
    throw Error(
      'This saved studio preview is unavailable in this browser. Open your level again from the studio.',
    );
  if (new TextEncoder().encode(raw).length > 256 * 1024)
    throw Error('The saved studio preview is too large.');
  let saved;
  try {
    saved = JSON.parse(raw);
  } catch {
    throw Error('The saved studio preview is invalid. Open your level again from the studio.');
  }
  if (saved?.version !== 1 || saved.profile !== profile)
    throw Error('The saved studio preview does not match this song profile.');
  const errors = validateNativeLevel(saved.level, { queueBalance: false });
  if (errors.length)
    throw Error('The saved studio level is invalid: ' + errors.slice(0, 3).join(' '));
  const level = saved.level as NativeLevel;
  if (level.songId !== fallback.songId)
    throw Error('The saved studio level does not match this playable’s audio.');
  if (level.stemLanes.some((lane) => lane.stem > fallback.stemLanes.length))
    throw Error('The saved studio level contains unsupported instrument layers.');
  if (level.queueColumns !== 3 || level.activeCapacity !== 3 || level.trayCapacity !== 3)
    throw Error('The saved studio level requires unsupported queue or tray slots.');
  return normalizePlayableQueue(level);
}
