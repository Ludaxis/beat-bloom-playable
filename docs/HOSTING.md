# Studio hosting

The Studio runs at https://beatbloomstudio.ludaxis.io. The root opens the editor; `/play#…` opens a shared playable snapshot. Sharing uses the current site's origin, so staging links stay on staging and production links use the Ludaxis subdomain.

## Deployment

Vercel project: `beat-bloom-playable`, team `joyixir-games`. Build with `npm run build`; publish `dist`. `vercel.json` defines Studio, shared-viewer and legacy preview routes. The Cloudflare DNS record is a DNS-only CNAME: `beatbloomstudio` → `cname.vercel-dns.com`, as recommended by Vercel for this domain. Vercel provisions HTTPS. The main ludaxis.io website is a separate project.

The build copies Studio files and its worker into `dist/review`, with approved icon/logo previews in `dist/assets`. Gameplay HTML includes its own assets. `.vercelignore` excludes dependencies, local captures and generated deliveries from CLI uploads.

## Custom exports

`api/export.js` adapts the existing package builder to Vercel's Node runtime. Requests must be same-origin JSON and at most 256 KiB. Package validation and ad-network size checks are shared with the local server. Responses stream in bounded chunks so valid HTML packages over 4.5 MB can download. The function needs the source, prepared assets, esbuild and the runtime's dependencies; its explicit include list is in `vercel.json`.

Exports do not need FFmpeg or write files. A busy instance rejects overlapping builds with a retry message. This guard is per instance, not a global rate limit. For a high-traffic public launch, configure rate limits in Vercel's firewall.

## Sharing

Share links contain a compressed level snapshot in the URL fragment, including uploaded ending artwork. No database or account is required. A recipient starts a fresh game with that snapshot; later Studio edits do not change the link. Large uploaded images make longer URLs. The viewer also supports the previous `/review/shared.html` links.

## Verification

Run `npm run verify` before pushing. Hosted-adapter tests cover origin checks, body limits, invalid requests and complete streamed responses. Check the deployed Studio, a shared edited level in a fresh browser session, and one export per network. Local tests do not replace validation in an ad network.


## Short share links

`POST /api/share` validates the same level contract as exports and saves the full snapshot in the dedicated private `beat-bloom-shares` Vercel Blob store. `BLOB_READ_WRITE_TOKEN` is server-only and is connected to production and preview. Never commit it or include it in static builds.

`/play/<id>` loads the snapshot through `GET /api/share?id=<id>`. IDs are 128-bit keyed content hashes; identical settings reuse one immutable object. There is no expiry or overwrite operation. Anyone holding a link can play its snapshot. Links survive deployments; do not delete the store or its objects during cleanup. Token rotation leaves existing links readable but may generate a different ID for later shares.

The Vercel firewall limits share creation to 30 requests per minute per IP. Reads are unaffected. The API also bounds request bodies to 256 KiB and validates the origin, profile, song and gameplay settings. Old `/play#…` and `/review/shared.html#…` links remain supported. Local Studio continues using self-contained links without cloud credentials.


## Link previews

Studio and shared viewers include Open Graph and large-image card metadata in their initial HTML. They use the approved 1200 × 630 game banner in `review/brand/beat-bloom-share-20260908.jpg` (134 KB). This is website-only artwork and is not embedded in ad exports. Shared pages deliberately omit a fixed `og:url`: each requested level URL stays distinct rather than being canonicalized to Studio. Hash links share `/play` metadata because URL fragments are not sent to servers. Chat apps may retain cached previews for previously posted links.

## Intro flows

Design → Intro has a Show intro checkbox and Footer / Logo layouts. Intro variants pause the puzzle until Play, then count eight accepted queue/tray moves before showing the install screen. Empty slots, locked slots and the start tap do not count. Install remains an explicit CTA action through the selected network bridge. Replay resets the intro and move count. The optional validated `adFlow` level field travels with JSON saves, shares and exports; old levels remain unlimited. Intro and Ending have independent text, artwork, colors and sizes. The Intro checkbox preserves its saved design when disabled. Banner controls sit inside Intro and have their own visibility switch. Legacy intro artwork is copied once from the ending, then edited independently.

Logo intros animate the Play button and rotate the background without advancing the puzzle. Reduced motion keeps both still. Play starts the music; short trials reveal a matching stem on the first break, with a fourth-move fallback. That stem enters on the next beat, and music continues behind the install screen. Standard levels retain their usual unlock timing.
