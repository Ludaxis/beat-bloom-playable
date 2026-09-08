# Beat Bloom playable QA — 7 September 2026

Local production handoff: **19/19 browser cases, 13/13 model tests, 27/27 Unity artwork tests passed**. TypeScript type checking passed. Production dependency audit reported zero known vulnerabilities at the time of checking.

Browser: 152.0.7977.77. The network checks use injected host mocks. They are not live SDK acceptance tests.

| Creative | Browser completion | Choices | Audible layers |
|---|---:|---:|---:|
| a-heart | 14.68 s | 6 | 3 |
| a-flower | 23.97 s | 8 | 5 |
| b-heart | 23.68 s | 6 | 3 |
| b-flower | 28.15 s | 8 | 5 |

Completion times come from the recorded test choices. Different timing and colour orders can change the outcome and duration.

The 12 production files range from 1,405,675 to 1,859,486 bytes. Each is below the strictest 2,000,000-byte budget used here for Meta. ZIP integrity, root index.html, no external gameplay assets, gesture audio, mute persistence, earned musical layers, replay, focus containment, explicit/debounced exits, MRAID readiness/viewability, document visibility and orientation continuity passed. Viewports: 320×568, 390×844, 768×1024 and 844×390. Screenshots of opening, progress, end cards, responsive layouts and the studio are in artifacts/.

The decoded full stem mixes peak at −5.9 dBFS (NO BATIDÃO) and −1.5 dBFS (Sunflower), before the runtime limiter and excluding impact SFX. Stem durations share the authored 22.153846 s and 21.333333 s loop lengths. This signal analysis does not replace device listening. See artifacts/audio-analysis.json.

The rejected orange organ PNG and metadata are deleted; its VFX prefab child is removed. No serialized reference to its GUID remains. The current piano and trumpet images were rendered from their own current Unity prefabs. The repository prohibition, Unity test and playable build guard protect this decision.

**Native-game suite remains unresolved:** the broader Ludaxis.Core.Tests run returned 574 passes and 58 failures out of 632. These cover ads/IAP, shop UI, economy, progression and runtime configuration outside the edited artwork paths. Missing AMAGDK types explain only a subset. No isolated baseline run was performed. Raw results are in artifacts/unity-core-tests.json. The Console was clear before that run; the later Console contained a test-generated LoadingManager “test failed hold” error. No compiler errors were observed.

**Before launch:** actual Unity/AppLovin/Meta uploader acceptance; iOS/Android device listening, performance, safe areas/SDK close controls, lifecycle and store return; verification of the configured store destinations; confirmation of paid-media rights for the exact recordings. No ads were uploaded, published or funded by this task.

Raw browser evidence: artifacts/qa-results.json. Unity artwork evidence: artifacts/unity-artwork-tests.json. File hashes: dist/manifest.json. Reproduction commands and source details: README.md.
