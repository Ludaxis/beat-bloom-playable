import catalog from './data/song-catalog.json';
import type { NativeLevel, NativeSection, NativeStemLane } from './types';

export interface SongStem {
  index: number;
  label: string;
  performer: string;
  earnable: boolean;
  gainDb: number;
  source: string;
  fallbackSource?: string;
  performerSource?: string;
  performerKind?: 'sprite-sheet' | 'image';
}
export interface SongDefinition {
  id: string;
  title: string;
  artist?: string;
  bpm: number;
  beatsPerBar: number;
  downbeatOffset: number;
  loopBeats: number;
  loopStartSeconds: number;
  loopEndSeconds: number;
  programGainDb: number;
  exclusiveStages?: boolean;
  balanceLayers?: boolean;
  cumulativeMixGainDb?: number[];
  sections?: NativeSection[];
  harmony?: number[][];
  stems: SongStem[];
}
export const SONG_CATALOG = catalog as SongDefinition[];
const songs = new Map(SONG_CATALOG.map((song) => [song.id, song]));
const earnable = new Map(
  SONG_CATALOG.map((song) => [song.id, song.stems.filter((stem) => stem.earnable)]),
);

export function getSong(id: string): SongDefinition {
  const song = songs.get(id);
  if (!song) throw new Error(`Unknown song: ${id}`);
  return song;
}
export function getEarnableStems(id: string): SongStem[] {
  getSong(id);
  return earnable.get(id)!;
}
export const songAssetURL = (source: string) =>
  /^(?:[a-z]+:|\/)/i.test(source) ? source : `/${source}`;
export function getSongAssetURLs(id: string): Record<string, string> {
  const assets: Record<string, string> = {};
  for (const stem of getSong(id).stems) {
    assets[`stem${stem.index}`] = songAssetURL(stem.source);
    if (stem.fallbackSource)
      assets[`stem${stem.index}Fallback`] = songAssetURL(stem.fallbackSource);
    if (stem.earnable)
      assets[`${stem.performer}Animation`] = songAssetURL(
        stem.performerSource ?? `assets/native/${stem.performer}-animation.webp`,
      );
  }
  return assets;
}
/** Stable raw stem identities; authored color choices remain in the level snapshot. */
export function defaultSongLanes(songId: string, paletteCount: number): NativeStemLane[] {
  if (!Number.isInteger(paletteCount) || paletteCount < 1 || paletteCount > 12)
    throw new Error('Choose one to twelve colors.');
  const stems = getEarnableStems(songId);
  return stems.map((stem, index) => ({
    stem: stem.index,
    colors: Array.from({ length: paletteCount }, (_, color) => color)
      .filter((color) => color % stems.length === index)
      .concat(index >= paletteCount ? [index % paletteCount] : []),
    requiredBreaks: 1,
  }));
}
export function validateSongBindings(level: Pick<NativeLevel, 'songId' | 'stemLanes'>): string[] {
  const song = songs.get(level.songId);
  if (!song) return [`Unknown song: ${level.songId}`];
  const seen = new Set<number>();
  const errors: string[] = [];
  for (const lane of level.stemLanes) {
    if (!song.stems.some((stem) => stem.index === lane.stem && stem.earnable))
      errors.push(`Stem ${lane.stem} is not an earnable part of this song.`);
    if (seen.has(lane.stem)) errors.push(`Stem ${lane.stem} is assigned more than once.`);
    seen.add(lane.stem);
  }
  return errors;
}

/** Match the imported mix's layer-count curve, with its energy-balanced fallback. */
export function songStemGain(song: SongDefinition, stemIndex: number, active: number[]): number {
  const curve = song.cumulativeMixGainDb;
  let compensation = 1;
  if (curve?.length === song.stems.length && active.length > 0) {
    compensation = 10 ** (curve[active.length - 1] / 20);
  } else if (song.balanceLayers) {
    const bed = song.stems.find((stem) => !stem.earnable);
    const bedPower = bed ? 10 ** (bed.gainDb / 10) : 1;
    const totalPower = active.reduce(
      (sum, index) => sum + 10 ** (song.stems[index].gainDb / 10),
      0,
    );
    if (totalPower > bedPower) compensation = Math.sqrt(bedPower / totalPower);
  }
  return compensation * 10 ** (((song.stems[stemIndex]?.gainDb ?? 0) + song.programGainDb) / 20);
}
