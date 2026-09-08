# Maintaining the playable

The shipped game has one implementation: `src/native/`. Avoid adding alternate gameplay paths for Studio or individual networks; previews and exports must use the same model and renderer.

| Responsibility | Location |
| --- | --- |
| Fixed-step simulation, collisions, queue and progress | `src/native/model.ts` |
| Contours shared by rendering and collisions | `src/native/geometry.ts` |
| Pixi rendering, reusable meshes and bounded effects | `src/native/render.ts`, `vfx.ts`, `shatter.ts` |
| Audio clock, stems, beat-aligned cues and context lifecycle | `src/native/audio.ts` |
| Runtime input, DOM presentation and host lifecycle | `src/native/main.ts` |
| Level defaults, normalization and validated edits | `config.ts`, `creative.ts`, `queue.ts`, `level-editor.ts` |
| MRAID/Meta readiness, visibility and explicit install action | `src/network.ts` |
| Studio authoring, ending design, sharing | `review/` |
| Offline HTML/ZIP assembly, size tiers and input validation | `scripts/native-package.mjs` |

Keep gameplay time separate from the audio DSP clock. Pause both when the host or page is hidden; never advance a hidden ad to catch up on return. Retain gesture-based audio activation and silent-play support. Cosmetic effects must not change collision state or consume queue power.

Use direct model fields for per-frame presentation. Full snapshots are for authoring/debugging boundaries. Reuse mesh backing storage and bounded scratch buffers; avoid rebuilding text, queue markup or graphics assets when their content has not changed. Keep the existing resolution cap and reduced-motion behavior. Add tuning to the relevant configuration rather than scattering constants through draw calls.

`npm run format` maintains readable source. `npm run verify` checks formatting, types, model/audio regressions, export service validation, all delivery builds and browser flows against a fresh isolated server. It always includes production host tests and clears single-case QA filters. Results go to `qa/native/latest/`; generated captures and downloads are ignored by Git.

Keep production output free of preview APIs and external assets, apart from the network-provided bridge. Check every network's file limit after any artwork, font or audio change. Studio export rejects oversized output rather than silently reducing the authored puzzle. Hosted shares store immutable snapshots in private Vercel Blob storage, bounded to 256 KiB. Keep legacy hash links readable and never expose the storage token to browser code.

Before release, test on physical lower-end Android and iOS devices and in each network's validator/SDK. Desktop CPU throttling is useful regression evidence, but does not reproduce mobile GPU performance, thermal limits or audio output latency. The hosted adapter in `api/export.js` uses the same package builder as the local export server; keep its streamed response and same-origin validation intact. See `docs/HOSTING.md`.

Guidance reviewed for this cleanup (8 September 2026): [PixiJS performance tips](https://pixijs.com/8.x/guides/concepts/performance-tips), [Web Audio best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices), [Page Visibility](https://developer.mozilla.org/en-US/blog/using-the-page-visibility-api/), and [Unity playable configuration](https://docs.unity.com/grow/acquire/creatives/playable/configure).
