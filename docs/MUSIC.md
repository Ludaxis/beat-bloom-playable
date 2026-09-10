# Songs and color assignments

Beat Bloom Studio has 72 song arrangements: the three original Beat Bloom songs and all 69 entries from the Drop Sort library. Some titles have several arrangements with different recordings, instruments, or mix settings. They remain separate choices; identical media files share one checked-in asset.

## In Studio

Choose a song in **Gameplay**, then open **Palette** in Advanced pattern. Each color has its own instrument choices. A color can bring in several instruments, and an instrument can listen to several colors. **Listen** previews one part without changing the level. Uncheck every color for an instrument to leave it silent. **Reset assignments** restores that song's suggested mapping without changing the colors.

Changing songs preserves the puzzle, shape, queue, and design. Studio remembers each song's assignments in this browser. Level JSON, Open playable, Share, and Export include the active song and mapping. Existing share links and the three original song IDs remain supported.

An assigned instrument earns progress from its chosen colors, using the existing half-per-color unlock rule. Each assigned color must reach its own target; excess progress from one color cannot replace another. Original backing tracks remain backing tracks. The supplied five-part arrangements have five earnable instruments, including their first part; none is silently converted into background music.

## Loading and delivery

The song picker loads metadata, not the whole audio library. A hosted preview requests only its selected song after a player gesture. All selected parts share one playback clock; locked instruments run silently until unlocked so they stay aligned. Listening to a part requests that part on demand and stops when the song changes or the page is hidden.

Offline exports contain only the selected arrangement and its performers. Prepared audio variants are checked in. Ordinary builds, hosted exports, and CI do not require FFmpeg or the Drop Sort/Unity source projects. Exports enforce each network's size limit rather than silently shortening music or changing the level. The smallest network tier uses more compressed audio than the hosted preview.

## Source of truth

- `src/native/data/song-catalog.json`: song IDs, labels, timing, gains, earnable parts, and asset references.
- `src/native/music.ts`: runtime song lookup, default bindings, and song-aware validation.
- `review/music.js`: picker, assignment rows, auditions, and bounded local drafts.
- `src/native/audio.ts`: gesture activation, shared loop timing, gain staging, and lifecycle.
- `scripts/import-song-library.mjs`: repeatable Drop Sort import and provenance.
- `scripts/prepare-song-audio.mjs`: explicit preparation of audio delivery variants.
- `content/music/`: import manifest and source traceability.

A level stores the selected `songId` and `stemLanes`. Stem indexes identify real source parts, starting at zero. Only parts marked `earnable` may have a lane. Omit a lane to disable that instrument; never fabricate an empty lane or reuse another song's stem count. The snapshot envelope remains version 1, and legacy profile names still resolve.

Palette edits preserve assignments for surviving color indexes. Removing the only assigned color leaves that instrument unassigned. Adding colors distributes them among existing assignments; it does not re-enable a deliberately silent setup.

## Verification and review limits

`npm run verify` includes the music authoring browser suite. Tests cover registry completeness, media identity, stem-zero progression, unknown/invalid mappings, many-to-many assignments, song switching, drafts, JSON, previews, selected-only exports, and audio lifecycle. Keep new fixture inputs under `test/fixtures/`.

Source labels, timing, mix gains, and arrangement distinctions come from the audited Drop Sort import. Checksums and numerical audio analysis establish file identity and technical consistency; they do not prove timbre or subjective musical quality. Imported beat timing has not received a new listening review. Physical Android/iOS and in-app-browser listening remain release review work; desktop automation does not certify those devices.

To refresh from a Drop Sort checkout, run `npm run assets:music` when the source is the sibling `drop-sort-playables` folder. For another location, run `node scripts/import-song-library.mjs /absolute/path/to/drop-sort-playables` followed by `node scripts/prepare-song-audio.mjs`. This explicit preparation step needs FFmpeg and runs a bounded conversion queue. Metadata-only refreshes use `node scripts/import-song-library.mjs --metadata-only`. Commit the registry, provenance, performers, and prepared audio together. Prepared media is deduplicated by content hash, while arrangement-specific gain and loop settings remain distinct.
