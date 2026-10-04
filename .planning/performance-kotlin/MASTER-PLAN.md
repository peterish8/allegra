# LuvLyrics performance and Kotlin master plan

Date: 2026-10-04. Research baseline: `feat/native-queue-engine`, initially at `10f1e0c73e60094059fc0ac913f350f525d6ed83`. The user reports lag throughout the Android app and requests a staged Kotlin plan, comparisons with PixelPlayer/Echo Music/NewPipe, all three video/lyrics layouts, and a separate immediate lyric-follow correction.

## Recommendation

Keep React Native for the app shell while making Kotlin own the time-sensitive player surface and device/background work. First remove avoidable rendering/request work in the existing app. Then pilot a Kotlin lyrics/video component backed by the current Media3 service. A complete Android Compose application remains an optional later migration with explicit feature parity gates.

This recommendation comes from current source and reference-app architecture. It is not a measured claim that Kotlin will make the app a particular percentage faster. Native audio and the full queue are already implemented; repeating that migration will not address every screen's lag.

Detailed area plans:

- [Rendering, screens and interaction](UI-PERFORMANCE-PLAN.md)
- [Kotlin playback, background work and native surface](NATIVE-PLAYBACK-PLAN.md)
- [Backend/data performance and YouTube integration](BACKEND-YOUTUBE-PLAN.md)

Implementation authority for this request: planning across all areas; product edits limited to the requested lyrics correction. The wider optimization and YouTube phases below are proposed work, not delivered features.

## What is already native or optimized

| Existing implementation | Keep it |
|---|---|
| Kotlin Media3 `PlaybackService`, native `QueueEngine`, notification/lock-screen controls, shuffle/repeat/queue restoration | One audio/queue authority. JS is a controller and mirror on Android. |
| Kotlin Luvs feed/audio pool, native palette/search/voice modules, WorkManager download/update workers | Extend the existing modules where evidence supports it; do not build duplicates. |
| Hermes, New Architecture, release minification/resource shrinking | Already enabled. They are not new optimization tasks. |
| Progress shared values, approximately 1 Hz coarse position-store updates, UI-thread gestures, frozen hidden tabs | Preserve these. Avoid pushing display-frequency progress through React state. |
| Six-entry decoded-cover LRU with per-URI in-flight coalescing, cached Stream page, incremental library changes | Improve byte sizing, cancellation and retention where measured; do not claim there is no cache. |

## Best wins, in order

The ranking combines direct source evidence, expected scope of benefit, effort and risk. Expected benefits require device validation; request latency and frame jank are distinct metrics.

| Priority | Change | Why it is worth doing | Kotlin needed? | Effort / risk |
|---|---|---|---|---|
| 1 | Correct lyric geometry and resize/reopen following | The user-visible drift has concrete measured-row/cache/scroll-range defects | No; immediate correction in shared RN component | Small / low |
| 2 | Stop hidden graphics/lyrics/video work; stabilize frame callbacks and gestures | Source has a glow visibility predicate gap and inline frame callbacks; every hidden surface consumes the same device resources | No initially | Small-medium / low |
| 3 | Virtualize Stream's vertical shelf feed and defer continuation | A long `ScrollView` mounts shelf trees outside the viewport; eager continuation adds UI/network work | No | Medium / medium |
| 4 | Cancel/coalesce provider calls and cache verified lyric results/misses | Long cascades, non-aborting timeouts and repeated failures delay starts and waste CPU/network | No; Kotlin can be considered after request behavior is correct | Medium / medium |
| 5 | Move native queue persistence IO off the player/main thread | `QueueEngine.saveNow` writes the snapshot with `temp.writeText`; scheduled by main Handler | Yes, inside existing engine | Small-medium / medium |
| 6 | Bound image bytes, blur work and prepared player resources | Count-based caches and full-screen composition can still cost memory/GPU; Luvs/video resources need lifecycle limits | Selective; avoid an unnecessary decoder rewrite | Medium / medium |
| 7 | Native radio top-up and stream-link recovery | Queue playback works while JS sleeps, but requesting more songs/fresh links still relies on JS | Yes, service-owned cancellable work | Medium-large / medium-high |
| 7 | Durable download completion receipts and reconciliation | Existing WorkManager can finish assets without a live JS listener to finalize the library row; retain a receipt and reconcile idempotently | Yes, extend the existing worker | Medium / medium |
| 8 | Native lyrics renderer and shared video surface | Moves line selection/highlight/geometry/scroll off JS and binds them directly to the playback clock | Yes, native View/Fabric or ComposeView | Large / high |
| 9 | SQL/search/large-library work | Full-library reads and JS sort/filter deserve measurement at large fixture sizes; basic SQLite/native search already exists | Only if profiling justifies it | Medium-large / medium-high |
| 10 | Entire Now Playing, then entire Android UI in Compose | Can eliminate RN rendering for migrated screens, but requires recreating every interaction and integration | Yes | Very large / high |

Do not rewrite the Express/Convex backend in Kotlin to fix Android rendering. Keep the existing API envelope, seconds-based duration, Range/206 behavior, authentication and source-qualified identities.

## Lessons from the reference apps

| Reference | Adoptable lesson | Boundary |
|---|---|---|
| [PixelPlayer](https://github.com/PixelPlayerHQ/PixelPlayer) / [PixelPlayerOSS](https://github.com/PixelPlayerHQ/PixelPlayerOSS) | Native service, native UI/state observation and device-local media operations are useful architecture references | The main PixelPlayer repository's current license is proprietary; architecture study is different from copying code/assets. Use the separately licensed OSS edition and its exact pin for any source reuse. |
| [Echo Music](https://github.com/EchoMusicApp/Echo-Music) | Service-owned queue/transport, player connection, native lyric/video composition and progressive metadata loading | Allegra has already adopted much of the native queue model. Compare gaps, not language percentages. Preserve our design and provider contracts. |
| [NewPipe](https://github.com/TeamNewPipe/NewPipe) / [NewPipeExtractor](https://github.com/TeamNewPipe/NewPipeExtractor) | Extractor/player separation, stream variants and subtitles, explicit loading/error/lifecycle handling | Extractor is a Java/JVM library callable from Kotlin, not a drop-in whole-app Kotlin conversion. Source playback changes need identity/clock/contract and distribution review. |

Research pins, actual inspected paths and license evidence are in the area plans. Do not copy source from an unverified different edition or assume a local clone equals current upstream.

## Language and ownership boundaries

| Responsibility | Recommended owner |
|---|---|
| Audio, video audio, queue, shuffle/repeat, position, focus, notifications and recovery | One Kotlin Media3 service/player for a native media source |
| High-frequency Android lyric line/word selection, layout and follow | Kotlin native renderer after the correctness and profiling stages |
| Radio fetch/link refresh needed during background listening | Service-owned Kotlin coroutines with queue generation/token checks and cancellable IO |
| Android downloads/updates/media scan/device integrations | Existing Kotlin/WorkManager modules; improve their actual gaps |
| Navigation, settings, accounts, library/playlist product flows, web/iOS UI | Existing RN/TypeScript initially |
| Cross-device protocol and source-qualified sync model | Existing shared TypeScript/Convex contract; native adapter must preserve it |
| Provider secrets, protected API operations, server cache/recommendations | Existing Node/Convex backend |

A native module computes or performs device work; a native component renders it. Moving a calculation to Kotlin while every display frame still rerenders React does not accomplish a native lyrics surface. Conversely, putting networking in Kotlin does not make a shader cheaper.

Native boundaries pass snapshots only when they change and user commands when they occur. Use typed/versioned events, song/queue generation, command acknowledgement and monotonic clock semantics. No per-frame JSON lyric/position events. The same player survives layout changes and navigation.

## Required video and lyrics modes

All three requested layouts belong to the plan:

1. **Current player lyrics:** lyrics in the upper available region, transport below; active line a little above the center of the measured lyrics viewport.
2. **Video + lyrics:** video at the top, synchronized lyrics below, accessible controls; each region has its own measured geometry.
3. **Full lyrics:** lyrics use the available screen, with accessible navigation/transport affordances; song position and provider selection are preserved when switching modes.

A layout change must not recreate the player, replay the song, drop the queue, reset time or launch a second audio owner. Geometry reacts to the actual viewport, font size, wrapping, transliteration, RTL, insets and header/control changes. Initial/final lyric lines need enough scrollable space to reach their anchor.

### Source decision before YouTube implementation

The app already contains a legacy iframe preview (`YtMiniPlayer`, wired from `MiniPlayer`) and a YouTube-style background which is a color wash. Neither is the requested video-and-lyrics feature: the preview has its own play state and no shared lyrics clock. Replace/integrate that path rather than add another player.

Two implementation choices have different product capabilities:

- **Official YouTube embed:** video can be above lyrics while the visible YouTube player owns audio/time. Full lyrics cannot hide the official player and keep its audio going. Follow official minimum visible-player requirements and handle buffering/ad/discontinuity behavior explicitly. It is not a native Media3 decoder.
- **NewPipeExtractor + native Media3:** a JVM extractor supplies Android source information to a native player adapter; the one Media3 timeline can drive video and lyrics across layouts. This is a distinct YouTube playback source with extractor maintenance, signed-URL expiry, availability, licensing and terms/distribution implications. Keep it isolated behind a source port and propose the contract change first.

Do not play muted YouTube video over a different catalog recording and promise sync. A music video may have an intro, edit, different duration or recording; exact video/version match, timing source and an explicit offset are needed. Catalog matching currently tolerates differences useful for finding candidates; that does not establish timeline equivalence.

Recommended decision sequence: design the three-layout native surface with local/catalog fixtures first; settle official-embed vs native-extractor source capability requirements next; implement one source end to end. The native extractor path is the closer technical fit if continuous audio in full lyrics is a hard requirement, but it must not be silently added to the existing metadata-only YouTube Music client.

## Execution phases

### Phase 0 — immediate lyrics correction

Files: `apps/mobile/src/components/SynchronizedLyrics.tsx`, `apps/mobile/src/playback/lyricLayout.ts`, `lyricLayout.test.ts`.

Use actual native row y/height and the block origin, retain unchanged valid measurements, include a sufficient footer, wait for layout readiness, clamp to actual scroll extent and retry when layout/content changes. Batch measurement recomputation against the latest song/settings callback. The same component serves local and Connect remote views.

Concurrent-work boundary: the native-row/footer portion appeared from another workspace writer during this investigation. Preserve it; the assigned correction agent verifies that work and adds only the needed readiness/resize/recompute hardening. Do not misattribute the existing edits, revert them or broadly redesign the player.

Gate: mixed-height long-song regression cases, font/viewport changes, seek/manual follow/reopen, typecheck/lint/worklet safety, and native emulator/phone evidence. Code arithmetic alone is not visual proof. Final check status is recorded separately in `VERIFICATION.md`.

### Phase 1 — baseline all screens

Create an Android benchmark/profileable harness and controlled fixtures. Capture cold/warm startup, Stream search/scroll, Library at several sizes, Luvs lane transitions, Now Playing open/close, long lyrics, downloads during browsing, video/no-video, background/notification controls, audio focus and Connect.

Use release-equivalent Macrobenchmark/Perfetto, native frame timing, React/Hermes profiling, CPU/memory/decoder and request counts. Record device/build/refresh rate, cache and network state. Separate frame jank from delayed content/audio. No migration is accepted merely because it compiles or “feels native.”

### Phase 2 — rendering and cancellation wins

2026-10-04 status: the UI-1 hidden-surface and stable-callback source slice is implemented by GPT-6 Luna xhigh workers and locally checked. See [worker prompts and debug handoff](LUNA-EXECUTION.md) and [integrated verification](LUNA-VERIFICATION.md). Device/frame evidence and the Phase 1 release baseline remain open; the remaining Phase 2 items below are still planned.

Deliver UI visibility/callback slice, then Stream virtualization. In independent vertical slices fix lyric timeout cancellation and in-flight coalescing, expiry-aware positive/negative caching, interactive-request priority and stale-request generations. Each should preserve the existing UI/actions and include focused behavioral checks.

Backend requests must finish within their response budget or expose an explicit additive asynchronous contract. Do not rely on an in-process cascade continuing after a serverless response; instances can freeze. Verify actual cache wiring instead of assuming an unused layered cache is active. Keep miss/error copy and fallback behavior clear.

### Phase 3 — improve the existing Kotlin service

Move immutable queue snapshot persistence to an ordered IO writer without losing latest-state/process-death recovery. Then move background radio/link recovery under the service if the behavior/ownership contract is approved. Use existing recommendation endpoint only if its behavior is sufficient; document any needed additive contract change first.

Validate local and streamed queues, stale-generation rejection, shuffle/repeat, screen-off advance, link expiry, service/process recreation and Connect ownership. Add a separate download-completion slice: persist a terminal receipt before notifying JS, then idempotently reconcile it into the library at resume/startup; test process death between asset completion and library insertion. Upgrade Media3 separately before adopting newer preload APIs; the installed artifact is currently 1.3.1. A full playlist does not prove next audio bytes are buffered.

### Phase 4 — data and graphics budget

Select the highest measured remaining cost: image resolution/byte budgets and blur reuse, bounded Luvs retained pages/players, or large-library query/filter work. Preserve SQLite data, online/download playlist union, tombstones and deck order. Room migration is optional only when it solves a measured database boundary problem, with explicit data conversion/rollback.

### Phase 5 — native lyrics component

Pilot one native component in the current RN shell. Typed lyric/style/layout snapshots in; native Media3 clock and measured geometry inside; tap/scroll/follow actions out. It must support all three layouts, line/letter highlight, provider picking, plain/synced lyrics, transliteration, large fonts, RTL, reduced motion, seek and manual follow. Remote Connect uses its remote clock and cannot accidentally start local audio.

Gate: feature parity plus repeatable before/after frame and memory traces on a low-tier device and a normal device. Keep the prior RN renderer as the rollback path during the pilot; no duplicate scroll/clock authority.

### Phase 6 — YouTube source + video/lyrics vertical slice

Approve the source/capability choice and additive identity/timeline contract. Use a source-qualified video reference and timing provenance; do not label every new stream Saavn or hand signed extractor URLs to web/Convex. Build exact match selection, load/error/expiry/recovery, one audio authority and all permitted layouts. Stop/release hidden video surfaces appropriately.

Acceptance includes no double audio, layout switch continuity, lyrics following the real audible timeline, video intro/alternate versions, buffering/seek, unembeddable/restricted/missing video, foreground/background behavior and source-specific Connect capability. Do not export unsupported transfer/download capabilities.

### Phase 7 — evaluate broader Compose migration

Only after the native-surface pilot has evidence. First port the complete Now Playing vertical slice with existing queue, likes, provider picker, system volume, sheets, Connect remote, background playback and navigation. Then evaluate Library/Stream/Luvs individually, preserving the product design.

A full Android rewrite must cover local SQLite migration, auth/account/library sync/outbox, downloads/updates/recovery, voice/widgets/deep links, Listen together, accessibility, settings migration and all established release gates. Keep the server/shared protocol and web/iOS paths intact. Do not simultaneously rewrite backend, database, renderer and player.

## Delivery and verification rules

- One finished vertical slice per change; relevant scoped instructions and root contract apply.
- Preserve unrelated `.mcp.json`, branding files, `output/` and concurrent edits. Stage explicit paths only if later authorized to commit.
- Root: `npm run typecheck`, `npm run lint`, `npm test`. Mobile is not a root workspace: run mobile typecheck/lint/tests separately. Kotlin changes also require Gradle unit tests and matching release/emulator launch/smoke gates.
- Native binary changes require an APK; JS/source checks do not establish physical-phone acceptance or a deployed release.
- Track frame overrun/jank, startup/first-audio/first-video timing, JS long tasks, CPU/memory/decoder count and request counts. Set target budgets against the baseline/device; do not invent speedup percentages.
- Benchmarks run without the FPS HUD and concurrent test/build CPU load. Repeat under stable thermal/cache/network conditions; keep traces and failures.
- Fail a migration when it loses an existing behavior, duplicates an authority, corrupts library/queue data, or has no measurable benefit large enough to justify its maintenance cost.

## First implementation after this correction

Start with Phase 1/2: a release baseline, then hidden-surface inactivity and stable callbacks. Next virtualize Stream and fix provider cancellation/coalescing. Move queue snapshot IO off the player thread as a small Kotlin change. These are concrete, lower-risk steps before a native lyrics/video surface or an all-app rewrite.

## Primary methodology references

- [React Native 0.81 performance](https://reactnative.dev/docs/0.81/performance)
- [Android Macrobenchmark](https://developer.android.com/topic/performance/benchmarking/macrobenchmark-overview)
- [Compose in Views](https://developer.android.com/develop/ui/compose/migrate/interoperability-apis/compose-in-views)
- [Media3 background playback](https://developer.android.com/media/media3/session/background-playback)
- [YouTube IFrame API](https://developers.google.com/youtube/iframe_api_reference)
- [YouTube API required minimum functionality](https://developers.google.com/youtube/terms/required-minimum-functionality)

The area plans contain source-specific citations and proposed native/API contracts.
