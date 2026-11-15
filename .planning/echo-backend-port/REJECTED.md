# Rejected: do not port

Each entry says what Echo does (behaviour only), why Allegra will not do it, and what to do instead.

## R-1 YouTube InnerTube stream extraction: signature cipher, PoToken, BotGuard WebView

- Echo: `innertube/*`, `app/src/main/kotlin/com/music/echo/utils/InnerTubeXResolver.kt`, `BotDetectionMitigator.kt`,
  `Fix403.kt` (client spoofing across YouTube client profiles, a WebView running Google's attestation script to mint
  proof-of-origin tokens, signature deciphering, and per-client exclusion after refusals).
- Why not: it circumvents YouTube's technical access controls and violates YouTube's Terms of Service; it breaks every time
  Google changes the player; and `apps/mobile/CLAUDE.md` already forbids it ("Never add stream-URL extraction, client
  spoofing or PoToken code there - audio always comes from the catalog providers").
- Instead: keep YouTube Music metadata-only on the phone. The useful idea (remember a refusal for a while) is reused in
  P2-2 without any YouTube code. The useful logging idea (correlation id, redaction) is P2-1.

## R-2 Spotify via the `sp_dc` web cookie, TOTP-generated tokens and persisted GraphQL hashes

- Echo: `app/src/main/kotlin/com/music/echo/spotify/SpotifyAuth.kt`, `SpotifyHashProvider.kt` (the user's browser cookie,
  a time-based secret to mint web-player tokens, and scraped persisted-query hashes for Spotify's private GraphQL API).
- Why not: it uses a private API with a session cookie, which breaches Spotify's Developer Terms and puts a full-account
  credential in the app's hands; it breaks when hashes rotate.
- Instead: Allegra already has the official Spotify Web API OAuth flow with PKCE, encrypted tokens and daily transfer
  (`apps/api/src/routes/spotify.ts`, `apps/api/src/db/spotifyStore.ts`, `convex/spotify.ts`). Keep it.

## R-3 Echo's "Flow neuroengine"

- Echo: `app/src/main/kotlin/com/music/echo/api/FlowNeuroengineApi.kt` (31 lines) is only a Retrofit interface and DTOs
  for `POST /v1/brain/analyze` on a server that is not part of the repository; there is no model or logic to study.
- Why not: nothing to port, and an unknown third-party endpoint would receive listening events; shipping a control that
  does nothing also violates `CLAUDE.md` ("Don't ship a control that does nothing and present it as a feature").
- Instead: Allegra's recommendations, radio and LightFM work (`apps/api/src/services/recommendations.ts`,
  `packages/shared/radio.ts`, `apps/api/src/services/lightfm.ts`).

## R-4 Shazam signature + private endpoint for song recognition

- Echo: `shazamkit/.../Shazam.kt` posts a locally generated signature to `amp.shazam.com/discovery/v5/...`.
- Why not: undocumented private API, reverse-engineered signature format, no licence to use it.
- Instead: see OPTIONAL-FEASIBILITY.md O-11 (licensed recognition APIs, owner decision).

## R-5 SimpMusic lyrics on the server

- Echo/phone: `simpmusic/.../SimpMusicLyrics.kt`; Allegra phone `apps/mobile/src/services/lyrics/providers.ts:259-295`.
- Why not on the server: keyed by YouTube video id (the API has none), labelled "Educational and non-commercial"
  (https://lyrics.simpmusic.org/, accessed 2026-11-13), and Cloudflare-challenged from a non-residential connection on
  2026-11-13.
- Instead: the phone keeps it. No change.

## R-6 Fixed-size chunked range requests (Echo `ChunkingDataSource`'s chunking half)

- Echo splits each stream into fixed 1-5 MB range requests to avoid YouTube throttling.
- Why not: Allegra's CDNs (Saavn/Gaana) do not throttle long ranges that way; chunking multiplies requests and interacts
  badly with the cache. The resume half of that idea is kept (P1-1 `ResumingDataSource`).

## R-7 Echo's scrobble threshold `min(50% of duration, 50 s)`

- Echo: `app/src/main/kotlin/com/music/echo/utils/ScrobbleManager.kt:13-15,116-121`.
- Why not: Last.fm's published rule is "longer than 30 s and played for half its duration or 4 minutes, whichever is earlier"
  (https://www.last.fm/api/scrobbling, accessed 2026-11-13). P1-3 follows Last.fm.

## R-8 Client-side Last.fm signing (secret in the app)

- Echo signs Last.fm calls on the device with an app secret (`utils/lastfm/LastFM.kt`).
- Why not: hard rule 2 (no secrets in clients); an extracted secret lets anyone impersonate the app.
- Instead: P1-3 signs on the server.

## R-9 Server-paid LLM translation, DeepL/Mistral server keys

- Echo offers OpenRouter, Mistral and DeepL services with the user's key on the device
  (`lyrics/src/main/kotlin/echo/music/iad1tya/api/*`).
- Why not as server-paid: Allegra is free with no payments; a shared key is an open cost and a new data processor.
- Instead: P2-3 forwards the listener's own key (same model as the DJ).

## R-10 Silent quality step-down or cross-provider fallback under one stream URL

- Draft P2-7 proposed a 320 -> 160 kbps step-down and alternate-source fallback inside `/api/stream/:id`.
- Why not: a different rendition has a different byte length; Chrome pins a URL's length and fails on a mismatch
  (`HasCompatibleLengths`, resource_multi_buffer_data_provider.cc), and Vercel instances would disagree on which rendition a
  URL means. Another provider's file may be another recording.
- Instead: P2-2 slice 3, an explicit `?quality=low` URL, only if evidence asks for it.

## R-11 Renovate alongside Dependabot

- Echo uses Renovate (`Echo-Music/renovate.json`).
- Why not: one bot is enough; Dependabot needs no app install and updates SHA-pinned Actions (P1-4).
