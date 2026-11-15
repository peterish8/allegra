# Optional items: feasibility notes only

Short notes, not implementation plans. Each ends with a recommendation. Verified 2026-11-13 against
`fix/web-auth-dialog-focus` @ 8a084c07.

## O-11 Song recognition (Shazam-style)

- Echo's approach: an on-device signature generator plus a POST to an undocumented Shazam endpoint
  (`Echo-Music/shazamkit/src/main/kotlin/com/music/shazamkit/Shazam.kt`, `amp.shazam.com/discovery/v5/...`;
  `Echo-Music/app/src/main/kotlin/com/music/echo/recognition/ShazamSignatureGenerator.kt`). That is a reverse-engineered
  private API: rejected (REJECTED.md R-4).
- Legitimate options, all UNVERIFIED for current pricing and terms:
  - AcoustID + Chromaprint: free for non-commercial use with an application key; built to identify whole files, weak for a
    few seconds of microphone audio in a noisy room. Chromaprint is LGPL-2.1 (native library, APK size cost).
  - Paid recognition APIs (ACRCloud, AudD): designed for microphone clips; a server key would be the owner's cost in a free product.
- Allegra-specific blockers: needs microphone permission flows on both apps, a privacy-policy change (audio leaves the
  device), and an owner-paid key.
- Recommendation: not now. Revisit only if the owner accepts a paid recognition API; plan it then as a server proxy so the key
  stays server-side (hard rule 2).

## O-12 Canvas / animated artwork

- The phone already has motion canvases: Echo Canvas manifest, then Apple Music, then Tidal (listener's token), then
  ArchiveTune artist video (`apps/mobile/src/services/canvas/` - `CanvasService.ts`, `providers.ts`, `appleWebToken.ts`;
  rules in `apps/mobile/CLAUDE.md`, "Canvas follows Echo's player order").
- The website has none. `docs/api-contract.md:253-256` lists `GET /api/canvas` as a "historical proposal".
- The `animatedArtwork.ts` question: the file exists only under `.planning/recovery/replayed/apps/api/src/providers/` (and a
  stray copy in `.claude/worktrees/agent-a063ba2a5d74ad04b/...`). It is not in `apps/api/src`. `CLAUDE.md` still uses
  `src/providers/animatedArtwork.test.ts` as its "single test file" example, which no longer exists. Recommended fix (one
  line, separate `docs:` commit): point that example at `src/lib/streamResolver.test.ts`. Also consider deleting the stale
  worktree folder (see the worktree junction gotchas in the owner's notes before removing anything under `.claude/worktrees`).
- A server-side port of the phone's Apple path would mean the API scraping Apple's web-player token
  (`appleWebToken.ts`); doing that from Vercel is a ToS and blocking risk.
- Recommendation: web canvas only through providers that need no scraped token (the Echo Canvas manifest), as a separate
  plan after P1-P2. Fix the `CLAUDE.md` example now.

## O-13 LuvLink "buffer barrier"

- Already built. `convex/schema.ts` has `luvLinkReady` (per room, track epoch and member) and `luvLinkBarriers`;
  `convex/luvLink.ts:81-108` (`finishBarrier`) releases a pending barrier; `docs/luvlink-contract.md:28` documents a
  "durable four-second readiness barrier" released by `reportReady` or a scheduled deadline.
- Recommendation: nothing to port. If listeners report drift, tune the four-second deadline with evidence, not code from Echo.

## O-14 Discord Rich Presence on the Windows app (new idea from the Echo skim)

- Echo signs into Discord's gateway (`Echo-Music/app/src/main/kotlin/com/music/echo/discord/GatewayClient.kt`,
  `DiscordOAuthRepository.kt`). Allegra's desktop shell (`apps/desktop`, Rust + WebView2) could instead use Discord's local
  RPC/IPC "Rich Presence" with an Allegra Discord application id, fed by the page bridge (`apps/desktop/src/bridge.js`).
- Needs: a Discord application (owner), an opt-in setting, desktop version bump (`apps/desktop/Cargo.toml`).
- Recommendation: optional, after P1. Never use a user token or the gateway as a user (self-bot rules).

## O-15 Crossfade and silence skipping (Echo `playback/crossfade/*`, `audio/SilenceDetectorAudioProcessor.kt`)

- Client audio features, not backend. On Android they would be Media3 audio processors inside the single native owner.
- Recommendation: out of scope for this port; plan with the mobile player team if wanted.

## Where SimpMusic ended up

Dropped from the server port (P2-5 and REJECTED.md R-5): it is keyed by YouTube video id, which the API never has, it
describes itself as educational and non-commercial, and it answered this machine with a Cloudflare challenge. The phone
keeps its on-device SimpMusic provider unchanged (`apps/mobile/src/services/lyrics/providers.ts:259-295`).

## ListenBrainz

Folded into P1-3 as optional slice 6 (same queue, second sink).

## Other Echo areas skimmed, no item added

| Echo area | Why no item |
| --- | --- |
| `utils/SyncUtils.kt` | YouTube Music account sync; Allegra has no YouTube login (and must not, `apps/mobile/CLAUDE.md` ytmusic rule) |
| `playback/DownloadUtil.kt`, `ExoDownloadService.kt` | Media3 download manager; Allegra downloads already run in WorkManager |
| `ai/*` (AI playlist generator/modifier) | Allegra's DJ already does this with BYOK |
| `lyrics/LyricsUtils.kt`, `betterlyrics/TTMLParser.kt` | Allegra already parses TTML and word timing (`apps/api/src/providers/betterlyrics.ts`, `packages/shared/wordSync.ts`) |
| `lrclib`, `kugou`, `youlyplus` clients | Already present in both the API and the phone |
| `LyricsHelper` "fetch faster" race | The phone cascade already asks all providers at once and answers in priority order; the API asks aggregators in parallel |
| `innertube` network config | YouTube-specific (rejected stack) |
| `listentogether/*` | The phone already speaks this protocol; LuvLink is Allegra's own |
