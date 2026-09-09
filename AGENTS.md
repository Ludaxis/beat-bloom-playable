# Working on Beat Bloom Playable

This is the standalone web playable, not the Unity project. Read README.md and MAINTENANCE.md before making changes.

- Keep one gameplay implementation in `src/native/` for Studio and every network export.
- Preserve authored level settings when refreshing Studio or changing creative assets.
- Put effect tuning in `vfx.ts`, runtime tuning in the existing configuration, and authored options in validated level data.
- Keep effects bounded and cosmetic. Preserve reduced-motion support, gesture-based audio, host visibility handling, and explicit-tap install actions.
- Never use the rejected orange organ/keyboard artwork, including as a piano substitute.
- Build and test with the checked-in assets. Unity imports are optional and require `BEAT_BLOOM_UNITY_PROJECT`; never assume a parent-folder layout.
- Run the relevant tests and type check after changes. Before delivery, run `npm run verify`; it builds all network outputs and runs the browser suites.
- Do not commit dependencies, exports, local QA captures, credentials, or environment files. Keep package-lock.json and required source assets tracked.
- Do not claim mobile-device performance or ad-network approval from desktop checks alone.

- Before pushing, run the workflow checks from a clean checkout of the exact staged files using the Node version in `.nvmrc`. Required regression inputs belong in tracked `test/fixtures/`, never ignored `qa/`. Confirm the GitHub Actions result after pushing.
