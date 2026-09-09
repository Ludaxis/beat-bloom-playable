# Beat Bloom Playable

Create, play, and export Beat Bloom ads from a browser-based studio. Choose a song, shape the puzzle, design the ending, and download a playable for Unity Ads, AppLovin, or Meta.

This repository contains **only the web playable and its authoring tools**. The Unity game is maintained separately. Prepared artwork, audio, and level data are included, so everyday development does not need Unity.

## Start the studio

Use Node.js 24 LTS and npm. From this folder:

```sh
npm ci
npm run build
npm run dev
```

Open [localhost:4178](http://127.0.0.1:4178). Build once before starting the studio; rebuild after changing runtime code. The development server also handles playable downloads.

The default opening puzzle is the supplied 16-ring heart level (`beat-bloom-heart-level (1).json`), stored in `src/native/data/studio-default.json`. Fresh Studio sessions and the default standalone preview use this same definition.

## Create a playable

1. **Gameplay:** select a song, then adjust the shape, colors, ring count, spacing, line thickness, and ball controls. Advanced pattern settings include the 20 imported ring templates.
2. **Play:** try the puzzle in the live preview. Save level JSON to keep an editable copy. Load it to resume later.
3. **Design:** customize the ending, upload a logo or icon, adjust text and button sizes, and choose whether to show Replay.
4. **Export:** select the ad network and file format, review the install destination, then download the current playable.

**Open playable** opens the current authored level. **Share** saves an immutable copy and creates a short link. Anyone with the link can play it; later edits do not change the shared copy. A localhost link works only on your computer.

**Shuffle balls**, in Advanced pattern, mixes positions within each three-ball row. Studio applies the new order only after verifying a winning route; Cancel keeps the current queue. For a two-segment heart with two colors, set Segment speed and Shift per ring to zero to split it into left and right color halves.

Each queued ball has three power. The queue rounds up the number of balls needed per color without changing the pattern. A solve-check result of **Verified win** confirms a successful input sequence; an unfinished check does not prove the level is impossible.

## Export and install actions

Exports include their assets and use the selected network's install bridge. Install actions occur only after a player taps the CTA.

| Network | Install integration |
| --- | --- |
| Unity Ads | MRAID adapter with the configured app destination |
| AppLovin | MRAID adapter with the configured app destination |
| Meta | `FbPlayableAd.onCTAClick()`; destination managed in the campaign |

Keep store links editable in Export. The current listings are unpublished. Configure campaign tracking in the network dashboard and validate the final file in that network's tools before launch. A successful local build is not network approval.

`npm run build` creates preview pages and network packages in `dist/`, with a size manifest. Generated deliveries are not committed.

## Development and checks

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local studio and export service |
| `npm run build` | Build previews and all network packages |
| `npm run typecheck` | Check TypeScript |
| `npm test` | Run gameplay, audio, geometry, and effect regressions |
| `npm run test:export` | Check package assembly and export validation |
| `npm run format` | Format source and tests |
| `npm run verify` | Run the complete build, test, and browser workflow |

Browser checks use Google Chrome through Playwright. Install Chrome locally, or provision it with `npx playwright install chrome`, before running `npm run verify`. Required test inputs live in `test/fixtures/` and must be committed; `qa/` contains disposable output only. Before pushing, run the CI commands from a clean checkout on the Node version in `.nvmrc` so ignored local files cannot hide missing inputs.

Verification starts its own server; results are written to the ignored `qa/native/latest/` folder.

The runtime uses TypeScript, PixiJS, WebGL, and Web Audio. It shares one gameplay implementation across Studio previews and ad exports. Effects use bounded geometry and particle counts; playback pauses when hidden and supports reduced motion. Test representative mobile devices as well as desktop browsers before release.

## Project layout

```text
assets/             Prepared artwork, fonts, audio, and asset provenance
src/native/         Gameplay, rendering, audio, effects, and level data
src/network.ts      Ad-host lifecycle and install bridge
review/             Studio UI, design tools, sharing, and ring templates
scripts/            Development server, builds, exports, and QA tools
test/               Automated regression tests
docs/               Historical implementation notes
```

See [MAINTENANCE.md](MAINTENANCE.md) for architecture and performance guidance. [Implementation history](docs/IMPLEMENTATION_HISTORY.md) records earlier development decisions and may describe superseded behavior. Third-party notices are in [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).

## Refresh assets from Unity

This is optional. Normal development uses the checked-in assets and data. Source-import commands require a separate Unity checkout:

```sh
export BEAT_BLOOM_UNITY_PROJECT=/absolute/path/to/beat-bloom
npm run templates
npm run export:levels -- 6
```

`npm run assets` and `npm run assets:native` rebuild prepared media from that checkout and the included source artwork; their media tools also require FFmpeg. After changing audio, run `npm run assets:audio` and commit `assets/encoded-audio/`. Normal builds and exports use these checksum-verified variants and do not require FFmpeg. Review generated asset changes before committing. Source audits run when this environment variable is set; otherwise standalone verification explicitly skips the Unity audit and still tests the packaged templates.

## Hosting

Open [Beat Bloom Studio](https://beatbloomstudio.ludaxis.io) to edit, design, share and export playables. The subdomain opens the Studio; shared links at `/play/<id>` open the saved playable.

Vercel runs `npm run build`, publishes `dist` and serves the custom export function. Cloudflare routes the Studio subdomain to Vercel. The main Ludaxis website remains a separate deployment.

See [Hosting](docs/HOSTING.md) for routes, export behavior and verification. Studio uses the Ludaxis design system; the game retains Beat Bloom's visuals.

## Ownership

Beat Bloom branding, artwork, audio, and game content are not granted an open-source license by this repository. Use them only with the appropriate permissions. Preserve third-party notices when distributing builds.
