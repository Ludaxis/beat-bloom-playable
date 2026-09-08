# Beat Bloom web gameplay

The playable runtime lives in `src/native/`; the Studio lives in `review/`. The default is the authored Heart puzzle in `src/native/data/studio-default.json`. Native game data remains the reference for song stems, instruments and patterns.

Open the local Studio at **http://127.0.0.1:4178/**. **Gameplay**, **Design** and **Export** share a persistent preview. **Open playable** opens the applied level; **Share** creates a portable snapshot link. **Design → Preview finish animation** previews the logo reveal and ending without advancing the puzzle.

## Run and verify

```sh
npm install
npm run build
npm run dev
npm run typecheck
npm test
npm run test:export
npm run qa -- --production
npm run qa:export
npm run qa:patterns
npm run qa:endcard

# All checks, with a fresh isolated server:
npm run verify
```

The server binds to localhost. Video comparison, video streaming and extracted reference frames have been removed from the studio and source tree. The original user-supplied recording in Downloads is untouched. Numeric physics and audio calibration remain part of the gameplay. Web frame stepping advances physics and visuals, not the live audio clock.

## Author levels

**Center space radius** moves the innermost line outward, enlarging the empty area for moving balls. All ring paths and collision boundaries use the same `innerRadius`. The board scales to fit the screen as it grows; ring contents, colors and queue stay intact. The control spans 0.5–10 world units and shows the equivalent radius at the base 49 pixels/unit. Changing it restarts the puzzle and reruns the bounded solve check. Save, Load, Open playable and network exports preserve the chosen radius.

**Tutorial**, inside **Advanced pattern**, enables contextual coaching and chooses the text position. **Follow the action** puts queue hints above the instruments and stored-ball hints above the slots. The existing game's `Element-Hand` idle/tap sprites and `Element-TutorialTip` strip are embedded in every playable; provenance is in `assets/native/tutorial-provenance.json`. One short instruction accompanies a hand whose fingertip follows a currently useful, legal target. The hand dismisses on input and returns after five seconds of visible gameplay without input when a useful move exists. It prioritizes the innermost remaining colors, accounts for balls already working, and can teach sending a stored ball back or swapping when the center is full. It does not solve the board or guarantee an optimal move. Intro, launches, featured instruments, pause, hidden placements and end cards suppress coaching; replay resets it. Reduced-motion mode keeps the hand still. Tutorial settings are optional level metadata, default to enabled/automatic positioning, and are preserved by saves and exports.

The coaching uses brief, contextual instructions near the relevant controls, following [Apple's onboarding guidance](https://developer.apple.com/design/human-interface-guidelines/onboarding) and [Microsoft's guidance for scannable content](https://learn.microsoft.com/en-us/style-guide/scannable-content/). Copy uses one plain action per prompt, such as “Tap to send it back.” Timing and recommendation policy live in `src/native/tutorial.ts`; authored sprite anchors, sizes and tap timing live in `src/native/tutorial-view.ts`.

**Advanced pattern** contains 20 templates from the current game's first 20 menu levels. Select a template and **Apply pattern** to copy its exact ring arrays, effective palette and ring count while keeping the selected song, shape, line thickness, spacing and motion. Mixed segment counts are preserved. **Undo pattern** restores the previous level. Run `npm run templates` to refresh templates from the saved Unity sources; `node scripts/export-ring-templates.mjs --check` verifies their provenance without writing.

The pattern sliders generate a uniform repeating design: **Palette colors** (1–12), **Segments per ring** (1–24), **Colors per ring**, and a continuous **Shift per ring**. Related bounds keep every palette color in use. For example, 4 colors / 12 segments / 4 colors per ring / 0° shift creates aligned color bands; a 5° shift creates a gentle spiral. Shift slides colors along each outline, including mixed-segment templates, and leaves ring contents and ball power unchanged. The slider uses 0.1° increments; the Fine offset field accepts smaller decimals. Saved offsets drive both rendering and collisions. One color per ring makes solid color rings. Ordinary swatch edits recolor the existing design; the structural sliders create a new pattern and rebuild the queue from the inside outward with exactly 3 starting power per ball. Each color carries its unused power across rings; its total ball count is the whole-level piece count divided by 3, rounded up. Three rings with three segments and three colors produce three balls in one row. Four such rings produce six balls in two rows. Patterns are unchanged; once a color is fully cleared, its remaining balls retire so surplus power cannot fill the tray. The diagram shows each ring unwrapped, center first.

**Shape speed** controls outline rotation; **Segment speed** controls color movement along the outline. They are independent and either can stop at zero. Structural and motion edits automatically run a bounded solve check in a worker. **Verified win** means recorded ordinary queue/tray inputs cleared every piece in the actual web model. An unfinished check means **not verified**, not impossible; sufficient queue power alone does not prove a win. The checker never changes the live game or adds ammunition. Pattern tools, templates and the solve worker are studio-only; ad exports embed only the resulting level and gameplay.

**Equal color spans** snaps the segment count to a multiple of the colors per ring (within 1–24), so every color occupies the same share of the outline. A hexagon with three colors and zero shift gives each color two corners. Turn it off to author any exact segment count. Applying a source template retains its authored segmentation. Rounded corners retain the contour’s detail even with only one, two or three segments; drawing and moving-ball collisions use the same sampled paths.

**Ring depth**, inside **Advanced pattern**, controls the outward fade. **Color fade per ring** progressively reduces color opacity from the center outward (default 8% per ring). **Outer shadow strength** sets the neutral outlines beyond the white wall (default 20%); **Shadow fade per ring** makes each farther outline fainter (default 30%). Only remaining puzzle rings create outer shadows, including future rings beyond the old preview limit. Their contours and gaps follow the actual level. As rings move inward, shadows smoothly give way to color; the white wall stays crisp. Zero color fade keeps colored rings equally bright, and zero shadow strength hides outer shadows. These visual settings are stored in optional `ringAppearance`, preserved by Save, Load, Open playable and every network export, and do not change collisions, queue power or solve results.

Use the studio controls to change the contour, palette, line thickness, spacing and roundness. **Flower petals** changes the number of rounded lobes (3–9) on the Flower outline. For other shapes, the studio explains why this control is unavailable. Select Flower in the Shape menu to use petals, preserving the song and puzzle. **Total colored layers** changes puzzle length (1–24 layers), rebalancing queue power per color. **Visible layers** controls how many colored rings appear at once (up to 12). Edits restart the puzzle. **Save level** downloads its JSON; **Load level** validates and restores it. “Edit rings and queue” exposes the full definition, including ring color indexes, ball power, progression lanes and musical motion. Mystery balls and their introduction are removed from every web profile. Legacy JSON remains loadable: its queue is regenerated as the minimum number of 3-power balls per color, with mystery flags removed. A valid minimal 3-power queue retains its ordering. Applying JSON ring edits also refreshes the queue automatically, while preserving the authored shape, ring pieces and tuning. The archived raw Unity level export is unchanged.

Invalid imports retain the previous playable level. Queued balls always start with 3 power. The web queue contains exactly `ceil(pieceCount / 3)` balls per color, counting all rings and excluding gaps; it never adds a ball for an unused palette color. The model's `fixed-three` policy validates this rounded budget, and retiring completed colors discards at most two unused power per color. Raw archived native data retains its original exact-power validation. The web definition is an export for this explicitly requested standalone implementation; it does not replace Unity's `LevelData`, `LevelLoader` or persistence.

`node scripts/export-native-level.mjs 6` exports the exact native level, and `41` exports the native Sunflower level. Linked/duet data is rejected rather than silently converted. The raw Level 6 source contains 12 authored rings, 96 segments and 31 authored balls. The web profile preserves those rings and uses 34 balls with 3 power, three queue columns, three active slots and three reserve slots. Two additional reserve positions remain locked. At Reza’s request on 8 September, the web game omits the level label, settings and booster buttons. Sound, pause and restart remain available in the surrounding studio. Clicking a stored ball launches it through the center; with three active balls it swaps with the oldest active ball, including when the tray is full.

## Implementation

- **TypeScript + PixiJS 8 / WebGL** for the renderer, procedural field/background effects and continuous ribbon trails.
- A fixed-step gravity/contact simulation ported from the current gameplay rules and tuning. Moving ring paths are shared by collision and rendering. Native ball-to-ball contacts are disabled. This is a custom solver, not the Unity/Box2D binary.
- The existing Spine 4.2 instrument animations are baked into 48-frame transparent sprite sheets. The browser runtime uses these authored poses. No replacement instrument illustrations are generated.
- **Web Audio** plays the existing song stems and recorded launch, bounce, bell and drum samples. Source chart tempo, gain, downbeat and harmony data drive playback; song time follows the simulation's initial elapsed time when browser audio unlocks on a gesture. Break notes are scheduled forward on whole beats; earned instruments enter on a bar boundary.
- Effects include impact flashes, sparks, a three-note collection fan and flight, instrument fill/stage reveal, spent-ball petals and electric ring clears. Completion uses the approved Figma wordmark, followed by a responsive **Install Now** end card. Preview Install confirms the action without leaving or restarting; **Replay** starts the same level again.
- Camera feedback is a small, smooth translation lasting 180 ms (0.5 px on a break, capped at 1.1 px at the 576 px base width). It has no rotation or ordinary bounce shake. Hits cannot stack or extend it, and reduced-motion preferences disable it.
- Import validation, browser lifecycle handling and the ad exit adapter stay separate from the game model. The playable needs no backend or tracking endpoint. The local studio server also builds downloads; it is not shipped in ads.

The raw native level export preserves source values. Video-specific calibration is identified separately in configuration and QA evidence. A source value is not automatically proof of a visual match to a recording made at another time.

## Source fidelity and QA

The team includes a gameplay engineer, technical artist and independent QA lead, coordinated by the product lead. Evidence lives in `qa/native/`:

- `acceptance.md`: video timeline, measured HUD coordinates, source references and independent acceptance gates.
- `browser-results.json`: browser input, full-level completion, edit/load/save, audio lifecycle, resize and packaging checks.
- `reference-yellow-trajectory.json`: measured first-shot positions; corresponding web evidence records actual residual differences.
- Reference and web screenshots, including comparison captures and model/source tests.

A passing playthrough does **not** certify frame-by-frame fidelity. The renderer and gameplay have been rebuilt against the source, but exact whole-video parity is still a separate acceptance gate. Remaining differences must stay visible in the QA report. In particular, custom physics, gesture-gated browser audio, compressed delivery media, the reduced Web Audio voice palette and the web completion/store flow prevent an unqualified “identical to Unity” claim. Physical iOS/Android and live ad-network acceptance have not been performed.

No Unity gameplay script, level asset or core skeleton was changed for this port. The rejected orange organ remains removed and prohibited by `AGENTS.md` and the artwork checks.

## Ad delivery

The **Export playable** panel replaces Play & inspect beside the game. On smaller screens it moves below the preview. Choose **Ad network → Single HTML → Download playable**. The download includes the currently applied level: song, shape, layer counts, thickness, palette, queue and progression. This works for the native reference and all four creative profiles. Raw JSON edits must be applied before export. A ZIP containing only `index.html` is also available. For Unity Ads and AppLovin, extract it and upload the HTML; the Studio explains this when ZIP is selected. Single HTML is the default upload format for all three networks.

Expand **App links · advanced** only to change the base iOS/Android store listings for Unity Ads or AppLovin. Unity requires direct store links in the creative. AppLovin uses `mraid.open(url)` and supports custom product pages through creative-set targeting; select the app and operating system in its campaign settings. Public AppLovin docs do not specify a URL-free callback or an arbitrary campaign-URL override API, so the exporter retains valid base store links. Keep tracking/MMP settings in the ad platform.

Meta hides the store-link fields and exports with `destinationMode: "campaign"`; `FbPlayableAd.onCTAClick()` hands the action to Ads Manager. Even a legacy request containing unused or invalid store overrides cannot block a Meta export; those fields are omitted from effective destination metadata.

Reza confirmed on 8 September 2026 that the app listings are still unpublished. The configured URLs are retained as prerelease destinations. Local QA can verify the SDK call and the correct URL, but successful installation requires the listings to become available. Export happens on this computer and does not upload to an ad account.

The four creative profiles share the rebuilt gameplay and the approved Figma icon/wordmark:

| Profile | Concept | Song | Shape |
|---|---|---|---|
| a-heart | Footer0FreeToPlay | NO BATIDÃO | Heart |
| a-flower | Footer0FreeToPlay | Sunflower | Flower |
| b-heart | Tagline0Logo | NO BATIDÃO | Heart |
| b-flower | Tagline0Logo | Sunflower | Flower |

A uses a brand-led completion with a **FREE TO PLAY** footer. B leads with **Match colors. Build the beat.** and the approved wordmark. Both include the app icon, **Install Now**, and a separate **Replay** action. The end card adapts independently of the portrait game, retaining touch-sized buttons in landscape. These are implementations of the written brief's two concepts, not a claim of pixel-identical Figma layouts. They use the Level 6 puzzle supply with changed geometry and the respective real song charts; they are adaptation profiles, not claims that those exact boards are shipping native levels.

`dist/manifest.json` records all generated bytes, caps and SHA-256 hashes. Each network ZIP contains a root `index.html`; `dist/beat-bloom-delivery.zip` groups the twelve candidates. Unity Ads and AppLovin use MRAID readiness/viewability and explicit store actions. Meta uses `FbPlayableAd.onCTAClick()`. Gameplay taps never open the store. Production exports omit the preview debug API.

The shared builder embeds assets, checks the final HTML against a strict 5 MB budget for Unity/AppLovin and 2 MB for Meta, and records the exact level and compression settings in inert metadata. Unity/AppLovin keep the full preview animation resolution and higher audio bitrate. Meta selects smaller animation frames and lower mono audio bitrates as needed, preserving full song-stem duration. Exports that cannot fit are rejected with a size error. Those compression choices need listening and device review before paid distribution.

Official requirements and platform integration documentation were reviewed on **8 September 2026**: [Unity playable specifications](https://docs.unity.com/vi-vn/grow/acquire/creatives/playable/specifications), [AppLovin creative specifications](https://support.applovin.com/en/growth/promoting-your-apps/welcome-to-applovin/creative-specs-and-guidelines), [AppLovin custom product-page settings](https://support.applovin.com/en/growth/promoting-your-apps/welcome-to-applovin/how-to-create-creative-sets), and [PlayCanvas’s official Meta integration](https://developer.playcanvas.com/user-manual/editor/publishing/playable-ads/fb-playable-ads/). Meta’s own linked help pages returned a login wall in this session; that access limitation is recorded in the export-panel research notes. Actual placement approval still requires the network’s validator.

## Asset and shader provenance

The launch branding was corrected at Reza's direction on **8 September 2026**. The exact [logo/wordmark node 6:2443](https://www.figma.com/board/2phyEEt4ZlbRBtBVZaIzMB/NCBB---Beat-Bloom?node-id=6-2443) and [cat app-icon node 5:1449](https://www.figma.com/board/2phyEEt4ZlbRBtBVZaIzMB/NCBB---Beat-Bloom?node-id=5-1449) were inspected and exported using FigJam's **PNG → Transparent → Selection only** controls. Original exports are in `assets/source/brand/`. `scripts/prepare-assets.mjs` removes only fully transparent export margins and prepares the delivery WebPs; `assets/provenance.json` records Figma URLs and source hashes. The previous Unity neon-letter wordmark and heart icon are no longer the playable branding, including the completion animation and studio header.

`assets/native/provenance.json` identifies the approved original artwork/audio. `assets/native/animations.json` records animation names, bounds and native source files. `assets/native/charts.json` records chart sources. `scripts/prepare-native-assets.mjs` and `scripts/bake-native-instruments.mjs` regenerate these assets.

The technical artist used the existing Beat Bloom shaders and observed footage for effect design. The new electric-front implementation is original procedural code. The repository's older electric shader explicitly includes noncommercial third-party terms, so that code was not copied into this paid-ad runtime. Shadertoy links are provenance/inspiration, not blanket permission to copy shaders. The direct Shadertoy reference could not be fetched in this session.

The instrument baking tool uses the [official Spine Pixi runtime](https://esotericsoftware.com/spine-pixi), matched to the existing 4.2 exports. It is a build-time tool, not bundled into the ad. See `THIRD_PARTY_NOTICES.txt` for runtime/font notices and the installed Spine package for its license.

## Ending design in Studio

The sticky header keeps Gameplay, Design, Export, and Open playable available. Desktop uses an independently scrolling left editor and a persistent preview fitted to the remaining viewport; mobile uses normal page scrolling. Export shares the left editor rather than a third column or overlay. Design previews the actual runtime ending with the approved logo and icon. Edit the headline, CTA text, CTA/background colors, and logo/icon sizes; Reset ending design restores the concept defaults. Opening Design pauses the current play session without restarting it; returning resumes its previous pause state. Replay deliberately restarts gameplay. Changes are saved in optional `NativeLevel.endCard` metadata and travel with Save/Load, Open playable, and all network exports. Network install behavior stays attached to the CTA. Real failure endings retain the retry headline.

Design also accepts PNG/JPG/WebP logo and icon uploads up to 10 MB, normalized to embedded WebP at at most 768 px and approximately 80 KB each. Uploads apply to the ending artwork; Reset ending design restores approved originals. Headline (18–64 px) and CTA (16–40 px) sizes are optional level metadata, preserving older saved levels. Custom artwork is embedded in exported HTML and counts toward network size limits.

CTA button width (140–360 px), minimum height (44–100 px), and Show Replay are editable in Design. Width is capped to available space, and text can grow the button beyond its minimum height. Missing settings retain the original responsive layout and visible Replay. These fields persist in `endCard` with the other design settings.

Line-clear audio uses the BGM AudioContext clock and downbeat offset. Every audible clear receives a cue; bursts beyond four voices are carried onto following beats instead of dropped. Early clears during initial decoding are retained. Bells keep harmonic voicing and drum lanes retain their percussion route. Launch and bounce feedback remains immediate; muted playback is silent. Very dense bursts can therefore have an audible tail on later beats.

## Share links

Share beside Open playable copies a portable snapshot URL. `/review/shared.html` decodes a size-bounded compressed URL fragment and opens the matching preview with that level in the recipient's browser. Song, puzzle, uploaded ending artwork and design settings travel in the link; later edits do not modify previously shared snapshots. No database or publishing action is required to generate links. Uploaded images make links longer, and messaging apps may truncate very long links.

For Vercel deployment, serve `review/`, `assets/`, and `dist/preview/` at their existing paths over HTTPS and route `/` to `review/index.html`. Generate links from the deployed origin; localhost links are local only. This static share flow is ready for hosting, but deployment and adapting the local `/api/export` build service to Vercel are separate remaining steps. No deployment was performed.

Instrument progress and unlock targets are recalculated from half of each assigned color’s pieces across the full field, rounded up. For lanes with several colors, each color contributes only up to its own half-target, so over-clearing one cannot substitute for another. The matching audio stem enters at the existing musical boundary after earning its unlock. `stemUnlockPolicy: half-per-color` and recalculated thresholds travel with exported levels.

Center ball size is adjustable from 60–110%, default85%, with collision radius and trail/body rendering following the setting. Queue and tray controls retain their original sizes; flights interpolate between these sizes. New and legacy playable imports default to 1.00 ball speed, scaling flight time, gravity and speed limits coherently while retaining restitution1 and the fixed120Hz solver. Values persist in `ballScale` and `ballSpeed`.

The selected ending logo also appears in the pre-ending reveal. It grows from zero over650ms, then lifts96 logical pixels over1.1s. Both logos have a subtle double pulse (maximum2.5%) driven by the BGM audio phase; silent Design previews use the selected song tempo. Design → Preview finish animation plays the four-second transition without advancing the puzzle. Reduced-motion preference removes scale/movement.

Line breaks emit up to seven short fragments sampled from the actual contour and stroke width. Visual-only ballistic fall and rotation use absolute model time, with a0.48–0.78second fade and84-fragment cap. They reuse the existing Graphics particle layer, require no textures or collision bodies, and are disabled for reduced motion.

Studio’s default Kiss Me More puzzle is the user-supplied `beat-bloom-heart-level.json`, copied unchanged to `src/native/data/studio-default.json`. Its heart geometry,10rings, palette and pattern are preserved. Current playable normalization supplies fixed-power balls, half-color instrument targets, and default ball size/speed when absent. Unity source levels remain separate.

Ball speed is adjustable beside Center ball size from0.80–1.25× in0.01steps. The default is1.00× (about7.4% below the previous1.08×). The authored `ballSpeed` travels with saves, shared previews and exports; zoom compensation remains automatic.
