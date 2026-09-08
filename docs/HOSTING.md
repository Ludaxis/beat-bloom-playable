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
