# Backend, data, downloads, and YouTube + lyrics plan

Prepared 2026-10-04. Planning only; no product code, credentials, deployment, or provisioning changed. The owner reports lag across the app and requests three player layouts: video above synchronized lyrics; full lyrics; and the current upper lyric area with controls below.

## Recommendation

Keep the public API, provider normalization, authentication, account data, and cross-device protocol in TypeScript/Convex. They serve Android, web, and iOS and already have useful seams. Kotlin is valuable for Android jobs that must survive React going away, native media surfaces, playback clocks, and measured heavy local operations. Translating HTTP orchestration to Kotlin does not remove provider latency, a serial request waterfall, redundant queries, or a bad cache policy.

The Android player and queue are already Kotlin/Media3, and physical downloading already uses WorkManager. The strongest remaining native data opportunity is **durable download completion and reconciliation**, followed by optional native background radio fetching. A native library repository is a later measured option, not a prerequisite. Build YouTube + lyrics as a separate vertical slice under one playback authority, with an explicit provider contract proposal.

All performance implications below are source-backed hypotheses or structural limits. No physical-device profile, upstream production latency benchmark, or real YouTube playback was run by this investigator.

## Current repo evidence

| Area | Current implementation | Implication |
| --- | --- | --- |
| Android playback | `apps/mobile/CLAUDE.md:99` describes `QueueEngine`, `QueueMath`, `QueueSnapshot`, `PlaybackService`, and `PlayerBridge`; `StreamService.ts:59`/`:178` uses that queue and separately loads lyrics. | Do not propose a second queue/player as an optimization. Preserve ordered commands, queue tags, resume position, and native state reports. |
| Mobile lyric waterfall | `apps/mobile/src/services/lyrics/EchoLyricsCascade.ts:30` awaits providers in order; `providers.ts:127` races six LyricsPlus mirrors. `LyricaService.ts:57` waits for that cascade before trying its own strategies; `:115` races fetch against a 45-second timer without aborting the fetch. | More provider coverage can mean long waits and many simultaneous network requests. A fast typed language does not fix this schedule. Timed-out and superseded work needs cancellation. |
| Local lyric reuse | `EchoLyricsCascade.ts:18` keeps positive answers in a bounded, process-local six-hour cache; `StreamService.ts:176` tracks active calls only. | A cold launch or a repeated miss redoes work. Persist successful recording-specific answers; distinguish an authoritative miss from timeout/offline failure. |
| API lyric budget | `apps/api/src/services/lyrics.ts:23` sets 11 seconds; `:64`/`:85` keeps an in-flight promise whose cascade continues after `withinBudget` returns. `apps/api/src/lib/deadline.ts:5` explicitly does not cancel work. | The documented promise that a response-timeout lookup later fills its cache is not durable under the repo's freeze-after-response serverless rule. Cache completed results before returning or use a platform-supported bounded continuation deliberately. |
| API cache | `apps/api/src/createAppFromEnv.ts:11` always supplies `MemoryCacheStore`. `apps/api/src/lib/cache.ts:12` is a Map without a count/byte cap; `:36` defines `LayeredCacheStore` but production wiring does not use it. | Separate cold instances repeat provider fetches. Memory also retains untouched expired entries until read. Add a bounded L1 and a shared cache through the existing seam. |
| Catalog fanout | `apps/api/src/catalog/catalog.ts:168` calls each `getSong` with `Promise.all`. Search may wait for canonical-release enrichment (`:77`, `:121`). | Bound concurrency and deduplicate IDs before hydration. Separate optional enrichment from the fastest playable result; preserve correct enrichment cache keys. |
| Feed improvements already present | `apps/mobile/src/services/stream/feedCache.ts` persists a three-day feed; `homeFeed.ts:96` starts similar-artist searches alongside seed/radio work. `ytmusic/resolver.ts:114` already limits match concurrency. | These are existing improvements, not new work to claim. Measure and refine visible-shelf demand rather than duplicating them. |
| SQLite library | `apps/mobile/src/database/db.ts` already enables WAL/NORMAL and serializes writes. `queries.ts:43` returns song metadata with `lyrics: []`; `songsReconcile` preserves unchanged refs. | There is no all-song lyric hydration to remove from this path. Smaller projections, paged display, fewer focus refetches, and transactions are useful before replacing SQLite ownership. |
| Sync | `services/sync/LibrarySync.ts:57` batches 100 ops; `:302` preserves the recent-posted stage when taste fails; `:383` pulls revisions; `:411` applies changes one action at a time. `database/syncQueries.ts:50` already offers transaction support for helpers. | Preserve revisions, tombstones, retry stages, and account boundaries. Batch database application and store invalidation carefully; do not replace correctness with a faster full snapshot. |
| Android downloads | `android/app/src/main/java/com/lyricflow/app/workers/DownloadWorker.kt:29` writes assets and emits terminal events. `modules/DownloaderModule.kt:17` queues WorkManager but observes a process-local `ProgressBus`. `services/DownloadManager.ts:71` resolves a JS promise; `components/BackgroundDownloader.tsx:198` then adds the library row. | Work may finish when React's listener is gone. Asset persistence alone is not durable library finalization. A receipt plus startup/resume reconciliation is a real native reliability win; validate on device before declaring a current failure. |
| YouTube beta | `services/YouTubeSearchService.ts:7` accepts a client API key and returns the first search hit, without timeout/version validation. `BackgroundDownloader.tsx:212` invokes it after download. `Song.youtubeVideoId` and SQLite columns already exist. | Reuse stored IDs only as candidates. Move official search credentials to the server and validate version/embeddability. Search only when the listener opens video, rather than on every download. |
| Beta player is reachable | `navigation/RootNavigator.tsx:109` mounts `MiniPlayer`; its bar-mode beta at `components/MiniPlayer.tsx:1395` renders `YtMiniPlayer`. The wrapper directly pauses/resumes audio; `YtMiniPlayer.tsx:31` maintains separate iframe play state, JS-driven width/height animation, and no lyric timing adapter. | Replace/consolidate this path under the normal command funnel and clock rather than stacking another independent preview. Current `player/YouTubeBackdrop.tsx:19` is a color wash, not YouTube video playback. |
| Recording mismatch | `ytmusic/resolver.ts:63` can accept a duration difference up to 24 seconds; `:82` overwrites catalog duration with the YouTube metadata duration while audio stays catalog audio. | That matching threshold is not proof of equal video/audio timelines. Use the actual player's duration for transport and lyric alignment; retain catalog and video durations separately. |

`docs/architecture.md` names durable song relations and `ConvexRelationStore`, but the named `convex/songRelations.ts` and `apps/api/src/services/youtubeRelated.ts` are absent in this checkout. The plan does not treat those named implementations as available. The actual mobile recommendation path is `services/stream/recommend.ts` + `services/ytmusic/resolver.ts`.

## Ranked optimization slices

| Rank | Slice | Expected win | Kotlin? | Proof required |
| --- | --- | --- | --- | --- |
| 1 | Cancellation, single-flight, persistent lyric hits, total request deadline | Faster/reliable lyric readiness and fewer radio/network competitors | Start in TS; Kotlin is optional for background work | Request counts and first usable answer at cold/warm/miss/offline, rapid skips |
| 2 | Native download receipts + idempotent finalization | Correct completion after process death, fewer orphan/repeated downloads | Yes, extend existing Worker/module | Kill React/process mid-download, reopen, exactly one correct library row |
| 3 | Bounded shared provider cache and truthful timeout/miss outcomes | Lower cold-server delay and community-provider load | No; existing API/Convex seam | Two independent API instances reuse completed answer; TTL/outage tests |
| 4 | Demand-based catalog/feed hydration, bounded batches and smaller local reads | Less network/serialization work during all-screen navigation | TS/SQL first | Request/row counts for search, shelves, Library focus, sync/import |
| 5 | Native radio refill repository with queue-generation fencing | Gapless continuation while JS is asleep | Yes if screen-off radio is desired | JS-suspended background queue-low refill without wrong-queue insertion |
| 6 | Native local library repository | Larger-library data processing with one query bridge | Conditional, later | Trace proves query/result mapping is material after simpler fixes |
| Feature | Unified video + lyric host | Correct clock, fewer duplicated players, requested layouts | Native Media3 view for approved extractor route; official embed remains WebView | One audio authority, no source restart on layout-only change, measured lyric anchor |

This is not a prediction that server caching fixes frame drops. Track **waiting for content**, **JS/UI frame stalls**, **audio stalls**, and **battery/thermal load** separately.

## Slice D1: lyric fetching and version correctness

**Files:** `services/LyricaService.ts`, `services/lyrics/EchoLyricsCascade.ts`, `services/lyrics/providers.ts`, `services/net/fetchWithTimeout.ts`, `services/stream/StreamService.ts`, `services/lyricsScanWorker.ts`, `database/db.ts`; proposed `services/lyrics/lookupPolicy.ts` and `database/lyricsCacheQueries.ts` under `apps/mobile/src/`.

1. Add a shared query identity including canonical recording ref when known, title, credited artist, recording variant, duration bucket, lyric policy/schema version, and language. Preserve live/remix/alternate-cut markers. User-edited lyrics and offsets have priority over cached provider answers.
2. Create one single-flight lookup per identity. Playing-screen demand, downloader demand, scanner demand, and picker demand join it rather than re-fetching. Closing one consumer cancels only its subscription; the underlying request stops when no interested consumer remains. Skip/open/layout changes are fenced by media ID and generation.
3. Give a foreground lookup one total elapsed budget, with child request budgets and real AbortController cancellation through body decoding. Clear the Lyrica timer. Race a small set of useful sources or use a measured hedged fallback; cancel losing mirror requests. Do not simply fire every provider for every song. Retain deterministic word-synced/synced/plain ranking and the explicitly preferred strategy behavior.
   Then converge mobile lookups onto Allegra's own HTTP lyric repository once source coverage and word-timing parity are proven. The current hardcoded Render fallback and public provider mirror addresses are existing boundary debt, not a reason to copy the same provider stack into Kotlin. Optional native/background lyric work should call the app API. Add any missing supported backend providers through the existing configured provider seams before retiring the mobile cascade; do not silently reduce source coverage.
4. Persist successful lyrics and matching metadata in an additive SQLite cache table. Retain long negative TTL only for completed authoritative misses; use short cooldown/backoff for offline, rate-limit, or timeout. A timeout is not evidence that the recording has no lyrics.
5. Fetch the current song first. Optional prefetch is limited to the next native queue item when networking/Battery Saver allows, and stops when the queue tag changes. Lyrics picker fetches alternatives only on demand.
6. Keep actual playback duration authoritative. Never stretch lyric timestamps to a music-video duration silently. Separate plain/interpolated lyrics from real line/word timing in UI metadata.

**Acceptance:** no late lyrics painted onto another song; repeat miss does not create a provider storm; cached song works after app restart; all child requests stop at cancellation/deadline; words/translation/edited offsets stay correct. Compare provider calls and cold/warm time-to-first-usable lyrics using fakes first and live device evidence separately.

## Slice D2: finish Android downloads without React

**Files:** `android/app/src/main/java/com/lyricflow/app/workers/DownloadWorker.kt`, `modules/DownloaderModule.kt`, `workers/ProgressBus.kt`, `src/services/DownloadManager.ts`, `src/components/BackgroundDownloader.tsx`, `src/store/downloadQueueStore.ts`, `src/database/queries.ts`, `src/database/downloadQueueQueries.ts`, `src/services/bootPhases.ts`; proposed `workers/DownloadReceiptStore.kt` and `src/services/downloadReconcile.ts`.

1. Persist a compact job spec and completion receipt before/after work: job ID, source-qualified recording identity, chosen asset identity, final URIs, byte counts, content type, selected lyrics-file path, target playlist/order, and completion generation. Keep lyrics/media blobs in files or a table, not WorkManager `Data`; that transport has a finite serialized-payload limit. [WorkManager Data reference](https://developer.android.com/reference/androidx/work/Data)
2. Download into a temporary file; validate response/status/size and atomically rename. A stopped or failed request must not advertise a partial file as complete. Respect cancellation, connectivity constraints, bounded retry/backoff, SAF permission loss, and a maximum of two active downloads.
3. Native completion writes a durable receipt before emitting `ProgressBus`. Reattachment lists receipts and durable WorkManager terminal states. Events are an immediate notification path, not the source of truth.
4. Apply receipt finalization once in the existing JS-owned SQLite database in a transaction: song/lyrics, requested playlist membership, like migration, and job completion. An existing song's user edits/play statistics survive retries. Acknowledge the receipt only after the transaction commits. A crash between commit and acknowledgement must replay harmlessly.
5. Do not have Expo SQLite and a new Room instance independently migrate/write the same library database. Start with a native-owned receipt store or atomic manifest plus one existing library writer. Keep a single schema owner until a deliberate repository migration is justified.
6. Reconcile on startup idle phase and foreground return. Kotlin owns file work even if JS dies; lyrics fetching remains optional enrichment and cannot leave valid audio absent from the library forever. Refresh only impacted rows/playlist counts rather than all screens.

[Android recommends WorkManager for persistent tasks across restarts/reboots, with constraints and retry support.](https://developer.android.com/develop/background-work/background-tasks/persistent) It is not a realtime playback scheduler.

**Acceptance:** normal completion, React reload, process death, reboot, offline→online, duplicate enqueue, cancellation, expired asset link, and lost SAF permission. Confirm valid bytes + one library row + correct playlist/like state, not just a succeeded Worker or progress event. Keep iOS's existing fallback and receipt contract tests.

## Slice D3: shared cache and serverless deadlines

**Files:** `apps/api/src/lib/cache.ts`, `services/lyrics.ts`, `lib/deadline.ts`, `catalog/catalog.ts`, `createAppFromEnv.ts`, `services.ts`, `db/convexGateway.ts`, `db/convexGateway.test.ts`, `convex/schema.ts`; proposed `apps/api/src/db/convexCache.ts` + `convex/providerCache.ts` and focused tests.

1. Add count/byte-bounded local eviction. Wire a shared cache through `CacheStore` using the **existing selected Convex deployment** only when configured. Without it, keep bounded memory behavior. No new Redis/database provider is needed for this proposal.
2. Cache public catalog/lyric/artwork metadata, never personalized/account responses under a global key, and never token-bearing/signed provider media URLs in public rows. Include source, version, page/limit, language, synced-only, enrichment policy, and recording variant where relevant.
3. Return value plus absolute expiry internally or retain TTL metadata so L1 cannot warm for 300 seconds past L2 expiry. Choose a shorter TTL for transient failure, long TTL for immutable positives, and contract-defined miss TTLs. Negative entries are not successful payloads.
4. New Convex cache functions use validators, the existing server-secret gate, keyed index reads, size caps, bounded collection/cleanup, and TTL checked against a caller-supplied time. Do not read wall clock inside a reactive query. Keep cache data separate from auth `users`, listener profiles, and playback state. [Convex query guidance](https://docs.convex.dev/functions/query-functions)
5. Rewrite lyric deadline scheduling so work needed for the current response is bounded and its completed result is committed before returning. If a bounded post-response continuation is retained, use Vercel's documented lifecycle API deliberately and acknowledge that it is not a durable job; never rely on a plain orphan promise or timer. [Vercel function lifecycle configuration](https://vercel.com/docs/functions/configuring-functions/advanced-configuration)
6. Propose a retryable deadline outcome in `docs/api-contract.md` before changing status behavior. Keep genuine exhausted lookup as the existing no-lyrics response. Do not write a 24-hour authoritative miss merely because a provider timed out.
7. Deduplicate and limit batch hydration with a small concurrency pool; preserve input order and partial-success behavior. Keep `Range`, `206`, `416`, `Content-Range`, and `Accept-Ranges` unchanged for streams. Re-resolve expired audio after 403/404 through `StreamResolver` as today.

**Acceptance:** two separate service instances share a fresh positive/miss; TTL expiry never serves an over-lived L1 answer; cache outage falls back safely; aborted/slow sources do not retain unbounded work; mixed-source batch IDs retain identity; Range and seek remain functional.

## Slice D4: local data and sync before a Kotlin repository

**Files:** `src/database/queries.ts`, `database/syncQueries.ts`, `services/sync/LibrarySync.ts`, `store/songsStore.ts`, `store/songsReconcile.ts`, actual Library/list/search consumers; `apps/api/src/catalog/catalog.ts`, `convex/library.ts`, `apps/api/src/db/convexLibrary.ts`.

Measure 100/1,000/10,000 metadata rows and large playlists. Library metadata is already lyric-free. First improve read projections, bounded list windows, change-triggered refetches, and targeted updates. Keep WAL/NORMAL and the current serialized writer. Transactionally batch lyric inserts and inbound sync application where it preserves retry semantics. Use prepared/batched statements rather than one JS↔native round trip for each line. Preserve the existing FTS path if its callers use it; do not claim that the older `searchSongs` LIKE+sequential hydration path is the active user search without verifying callers (graft reports ambiguous `searchSongs` names).

Keep outbox operation identity, `recentPosted`, revisions, tombstones, and cursor advancement. Store an inbound cursor only once the required data/actions are safely applied; successful replays should not re-render unchanged lists. Bound old catalog-origin lookups and deduplicate first-sign-in requests. Account switch/sign-out cancels/fences in-flight work.

Only if profiles show data mapping/bridge overhead remains material, introduce an Android-only `LibraryRepository` with paged immutable results and focused change events. Use typed Expo async APIs, one schema owner, additive migration/backups, downgrade compatibility, and tests that open real existing databases. Preserve the TypeScript public repository interface and iOS implementation. Android's SQLite guidance prioritizes fewer rows/columns, SQL-side filtering/sorting, appropriate indexes, and measured query plans. [SQLite performance best practices](https://developer.android.com/topic/performance/sqlite-performance-best-practices)

## Slice D5: optional native background radio

**Files:** existing `playback/QueueEngine.kt`, `modules/MainPlayerModule.kt`, `src/services/stream/StreamService.ts`, `src/services/stream/recommend.ts`, `src/services/ytmusic/resolver.ts`; proposed native `recommendation/RadioRepository.kt`.

Current radio fetch still needs JavaScript; the native queue itself does not guarantee unlimited radio while the screen is off. If that is a product requirement, let a service-owned coroutine ask Allegra's own bounded recommendation API. Keep provider configuration/secrets server-side. Pass metadata IDs and queue tags, not cached CDN URLs as identity. Resolve only a bounded continuation, apply it on the existing player's thread if the same tag remains active, and stop on repeat-one, non-owned Connect/listen-together queues, replaced queues, service destruction, or network backoff. This is event-triggered queue-low work, not a permanent poller or a WorkManager realtime timer.

Do not move Google/Convex account session ownership or library sync wholesale as part of this slice. If authenticated background requests are required, explicitly design secure token access/refresh/revocation before promising that behavior.

## YouTube route decision

### A. Official embedded player: recommended low-maintenance compatibility route

Use a visible IFrame player inside one controlled WebView (mobile) / visible iframe (web). Metadata search occurs server-side; no Data API key in settings, `EXPO_PUBLIC_*`, `NEXT_PUBLIC_*`, or the downloaded app. Search candidates with `type=video`, `videoEmbeddable=true` and appropriate syndication filters; batch `videos.list` for duration/availability. Search is quota-limited: request only on video demand, respect metadata retention rules, and cache appropriately. Recheck the configured project's quota at implementation time. [Search API](https://developers.google.com/youtube/v3/docs/search/list), [Video metadata API](https://developers.google.com/youtube/v3/docs/videos/list)

Pause catalog/local Media3 through the usual playback funnel and confirm it paused before the embedded video becomes audible. The official video then owns audio and lyric position. Read `getCurrentTime`, duration, rate, and state; stop polling when hidden/paused and invalidate prior clock epochs on seek/source change. Handle removed/private videos (100), embedding disabled (101/150), missing client identification (153), autoplay blocked, buffering, and quota failure. Correctly identify the installed Android package via the documented WebView Referer/base-URL mechanism. [IFrame API](https://developers.google.com/youtube/iframe_api_reference), [API client identity requirements](https://developers.google.com/youtube/terms/required-minimum-functionality#embedded-player-api-client-identity)

This route preserves the provider's player, controls/attribution, ads, and original audiovisual content. Its restrictions matter directly to the requested layouts: background/hidden playback, offline media caching, separating audiovisual parts, and substituting Saavn audio are prohibited absent applicable authorization. Therefore **do not recommend a muted YouTube music video over independently playing Saavn audio as the default official implementation**. [YouTube Developer Policies](https://developers.google.com/youtube/terms/developer-policies)

Official full-lyrics mode needs a conscious capability rule: keep a qualifying visible player region, or pause/leave YouTube mode and return to matched catalog/local audio at a validated mapped time. A truly video-free full-lyrics screen cannot keep invisible official video audio running. Layout-only switches preserve player/position; a deliberate source switch is a different transaction and may require preparation. Surface the limitation clearly rather than secretly hiding an active iframe.

### B. NewPipeExtractor + Media3: optional Android-native route

NewPipeExtractor is a **Java extractor library**, usable from Kotlin; it is not a drop-in native YouTube player or a lyrics engine. It scrapes provider/internal endpoints and can expose separate audio, muxed-video, and video-only streams. The checked official releases/Javadoc currently show v0.26.5; recheck and pin a tested stable version at implementation time. The README specifies GPL-3.0-or-later and Android desugaring requirements for minSdk below 33, along with shrinker keep rules. [Extractor repository](https://github.com/TeamNewPipe/NewPipeExtractor), [Releases](https://github.com/TeamNewPipe/NewPipeExtractor/releases), [StreamInfo API](https://teamnewpipe.github.io/NewPipeExtractor/javadoc/org/schabi/newpipe/extractor/stream/StreamInfo.html)

NewPipe's README explicitly says its YouTube path uses scraping/internal APIs and warns that putting NewPipe or a fork in Google Play violates their terms. Reusing an extractor does not confer platform approval or recording rights. Decide the GPL obligations of the combined app, intended distribution, accepted upstream breakage, and YouTube usage policy before adding this dependency. Do not copy NewPipe/Echo/Pixel code without the exact repository license being reviewed. [NewPipe project](https://github.com/TeamNewPipe/NewPipe)

If this route is explicitly chosen:

1. Propose a narrowly documented **Android native provider-access exception** to Allegra's current server-only provider rule; do not put a JVM sidecar backend behind the app or migrate the Vercel API just to host an extractor. Keep credentials/owned API calls server-side. The native resolver receives a validated YouTube ID, never arbitrary fetch URLs from a screen.
2. Own extraction in a Kotlin repository on an I/O dispatcher with bounded concurrency, timeouts, cancellation-aware downloader, and current-generation fencing. `StreamInfo.getInfo` is synchronous and can throw; catch unavailable/region/age/challenge/network/extraction failures and return typed capability state. Never block JS or Android main thread.
3. Build a source for the **existing Media3 player**. Select a tested muxed stream or synchronized separate tracks using appropriate MediaSources; a video-only URL by itself will be silent. `MergingMediaSource` combines sources in one player; use matching periods/timeline, not two ExoPlayers with timers. [Media3 media sources](https://developer.android.com/media/media3/exoplayer/media-sources)
4. Attach/detach one native video surface to the service-owned player. No player per React mount, lyric layout, or foreground return. Keep MediaSession notification/headset controls, queue tags, audio focus, pause/seek invariants, buffering, and recovery. [MediaSessionService lifecycle](https://developer.android.com/media/media3/session/background-playback)
5. Keep expiring URLs in short-lived internal memory only. Persist video ID and selected format policy. On stale media 403/404, re-extract once with backoff and resume at captured position; detect replacement queue/item before applying. Never log tokens or signed query strings.
6. Cap quality/decoder memory based on device/network/Battery Saver. When showing only lyrics, disable/release unnecessary video rendering/decoding in a controlled way while retaining the same media timeline. Do not reuse the Luvs multi-player pool for this single-player feature.
7. Build the native view/module with the existing Expo mechanism and add it to the checked-in `ExpoModulesPackageList.kt`; use typed async methods/events, not full JS state blobs per frame. [Expo Module API](https://docs.expo.dev/modules/module-api/)

This route can technically support all three layouts on one native clock, but it carries greater operations/licensing/distribution risk and does not automatically extend to web/iOS. Extraction availability, background operation, and offline rights remain separate capability decisions. Do not add YouTube downloading to the existing Save button as part of video + lyrics.

## Additive contract and shared clock proposal

First edit/propose `docs/api-contract.md`, `docs/provider-integration.md` rule 14, and `docs/architecture.md`. The current rule says audio never comes from YouTube and provider URLs never enter frontend; this plan does not silently change either.

### Proposed documentation amendment text

The following is **proposal text only**, not an approved change to the active contract.

For `docs/provider-integration.md`, retain the existing recommendation rule and append:

> **14a. Optional YouTube video playback.** YouTube Music recommendations remain pointers matched to catalog audio. An explicitly selected video attachment is a separate playback mode. In official-embed mode, the visible YouTube player owns its original audio and playback clock; catalog/local audio must be confirmed paused first. The client may construct only the documented public embed URL from a validated video ID. Search credentials, extraction endpoints, and signed media URLs remain outside public JavaScript. No invisible/background YouTube player, offline YouTube media, or replacement audio is enabled by this mode. An Android extractor mode requires a separate documented native-provider-access exception and accepted licensing/distribution policy before implementation.

For `docs/api-contract.md`, propose an additive route:

> **`GET /api/videos/match` — proposed additive video attachment lookup.** Accept `songRef`, `title`, `artist`, and optional `duration` in seconds. Return `ApiResponse<{ status: 'found' | 'no_match' | 'unavailable'; candidates: VideoAttachment[] }>` with a bounded candidate list. Each candidate has validated `source: 'youtube'`, `videoId`, separate catalog/video durations, version-match confidence, and supported playback mode. No provider token or signed stream URL is returned. `no_match` means the lookup completed without a valid candidate; timeout, disabled configuration, quota exhaustion, or provider failure is `unavailable`, with friendly copy and a retry policy. Choosing an attachment does not change a catalog song's `SongRef`. Existing `/api/stream/:songId` continues returning only catalog audio bytes and preserves its Range contract.

For `docs/architecture.md`, propose:

> **One active transport and clock.** Catalog/local audio uses the existing platform player. Explicit official video mode uses a visible YouTube embedded player; native video mode, when separately enabled, uses the existing Android Media3 player. Only one transport is audible and authoritative at a time. Lyrics and controls read that transport's clock. Layout preference changes geometry without replacing its media item. Source switches are acknowledged handoffs with a new clock epoch and a verified version/time mapping.

Start with an optional **video attachment** to a catalog recording, rather than changing every existing `SongRef`. Suggested internal model (proposal, not an existing API):

```ts
type VideoAttachment = {
  source: 'youtube';
  videoId: string;
  catalogRef?: SongRef;
  title: string;
  artist: string;
  videoDurationSec: number | null;
  catalogDurationSec: number | null;
  match: 'verified-version' | 'candidate' | 'mismatch';
  lyricTimeline: 'catalog' | 'video' | 'unverified';
  offsetSec?: number;
  playback: 'official-embed' | 'android-extractor';
};
```

Return IDs/metadata/capability status through `{ success, data, error? }`; return no signed media URL or key. Only an explicitly approved official-embed exception permits constructing the public embed address on the client. Library identity remains `saavn:<id>`/`gaana:<id>` with the optional attachment. If independently saved/queued YouTube tracks become a later requirement, introduce `youtube:<videoId>` through an announced model/protocol expansion and audit `packages/shared/songRef.ts`, `types.ts`, library validation/mutations, Convex schema/validators, stream identity, downloads, API hydration, web/iOS player ports, Connect and listen-together. Bare video IDs must never collide with catalog IDs or pass into Saavn streaming paths.

Introduce one logical `PlaybackClock`/player port selected by source mode:

- `mediaId`, `clockEpoch`, `positionSec`, `durationSec`, `rate`, `isPlaying`, `isBuffering`, `sampledAtMonotonic`.
- Native mode reads the existing service player. Embedded mode reads the visible official player. Only the selected port publishes accepted transport events; stale native/iframe events from the previous epoch are ignored.
- Pause, seek, next, lyric-line tap, notifications where supported, and Connect commands target this authority. Do not have lyrics advance from wall time while video buffers.
- The same actual recording clock drives video, lines, word sweep, waveform, and seek state. Persist manual lyric offset per recording/version. A video's opening dialogue, edited chorus, concert performance, or alternate speed is **not** fixed by loosely matching title or scaling timestamps by duration. Offer another video/lyrics or show unsynchronized lyrics when no valid timeline is available.
- Default official video uses its own audio. Muted accompanying video with catalog audio is a separate product mode requiring permission/policy review and an actual timeline mapping; it is not assumed to be permitted or synchronized.
- YouTube captions are not a general official lyric-download API: `captions.download` requires authorization and permission to edit the video. Continue to use the selected lyric providers/user lyrics; show plain/unavailable when appropriate. [Caption API](https://developers.google.com/youtube/v3/docs/captions/download)

## All three layouts

**Files:** `src/store/settingsStore.ts`, `screens/NowPlayingScreen.tsx`, `components/NowPlayingLyricsArea.tsx`, `components/NowPlayingControls.tsx`, `components/SynchronizedLyrics.tsx`, the optional native video host and clock adapter. Preserve existing Allegra colors, cover stages, motion tokens, reduced motion, and lyric glide semantics.

Persist a layout preference (`video-lyrics`, `full-lyrics`, `lyrics-controls`) separately from source mode and whether the selected song has video. Respect official-player capabilities without losing the preference. Layout changes update host geometry/visibility, not queue/media identity. Keep a single native player or one mounted iframe instance; only source changes prepare a different transport. When video is unavailable/offline, show the lyric/control layout with a clear video state while existing catalog/local audio stays usable.

Compute active-line anchoring from the **measured list viewport**, after safe areas, video stage, titles, and controls have taken their space. Target roughly 0.35 of that viewport (current mobile rule), not 0.35 of the screen. Reserve enough content inset for the first and final lines; wrapped lines and text-size changes must recompute row centers. Switching layouts or rotating performs one alignment to the current lyric, then resumes the existing smooth follow behavior; no accumulated offset and no second automatic scroller. The immediate reported lyric drift fix is a separate owned task and should establish these reusable geometry rules first.

## Delivery phases and acceptance gates

1. **Baseline and lyric correctness:** profile the release build across app areas, gather HTTP/provider counts, and finish the immediate lyric-anchor fix. Record device, refresh rate, network/cache state, queue/library size, cold/warm scenario, and p50/p95 method. No language-change claim before this evidence.
2. **Fast current-song lyrics:** implement D1 as a current-song→lyrics vertical slice with fake provider delays and device rapid-skip tests; then roll out persistence/scanner reuse.
3. **Durable Android download completion:** implement D2 end to end for one downloaded song, including reboot/process-kill and actual library inclusion before extending features.
4. **Backend reuse:** implement D3 shared cache and deadlines without changing stream behavior. Update only the selected development Convex deployment after verifying it; no production deploy in this planning task.
5. **Data/Library scaling:** apply D4 measured query and transaction changes; reevaluate whether a Kotlin library repository remains justified.
6. **YouTube contract choice:** approve source policy, licensing/distribution, attachment model, full-lyrics capability behavior, and Connect behavior. Implement one verified song with video-top + lyrics first; add all layouts while preserving the clock. Then expand search candidates and errors.
7. **Optional native radio/extractor depth:** only after primary slices and source decisions, add D5 and/or the extractor route with bounded background/device validation.

For each implementation slice run root typecheck/lint/tests when API/shared files change, mobile `npm run ci`, focused Kotlin JVM tests, release launch checks, and the player probe. Verify visible UI in the appropriate browser/device. Physical-device acceptance includes all three layouts at small/large text sizes; wrapped multilingual lines; middle/final lyrics; rapid layout switches; background/foreground; notification/headset controls; seeks while playing/paused/buffering; no double audio; stale video/media URLs; video unavailable; and downloads/sync preserved.

Connect keeps authenticated ownership and acknowledged commands. Old devices retain their current Saavn/Gaana capabilities; a YouTube-only source must return an explicit unsupported/cannot-play result on an incapable target, not a guessed alternate recording. Layout preference is local UI state, not a high-frequency Connect payload. If capabilities/source mode need to cross devices, propose an additive protocol version/capability negotiation before shipping it.

No provider keys, signed media URLs, local user file contents, or account tokens belong in telemetry. Playback-readiness confirmation is not first-audible-sample measurement, and a succeeded Worker is not finalization proof.

## Tool/evidence notes

Used the requested backend-developer skill and current root/mobile instructions, provider contract, architecture, workflows, roadmap, and generated Convex guidelines. Memory was used only to recall the earlier native-queue/blank-screen boundaries; current source was rechecked and the old queue-ownership note is superseded by the implemented Kotlin queue.

Graft reported 132,186 tokens saved across 10 calls that reported a savings line, plus 3 no-definition/no-savings calls (13 graft invocations total). Reported dollars: a $0.14 priced subtotal plus 4 calls each reported as `<$0.01`. No price was inferred from token counts.
