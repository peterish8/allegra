# Android native playback and Kotlin performance plan

Prepared 2026-10-04. Source checkout: `feat/native-queue-engine`, `10f1e0c73e60094059fc0ac913f350f525d6ed83`. This is a read-only investigation and implementation plan. Physical-device performance profiling was unavailable during this research. An emulator has since booted for functional QA in the parent task; that does not establish physical-device performance. The priorities below are expected opportunity and risk, not a demonstrated explanation of the reported lag.

## Recommendation

Keep React Native for the product shell and shared account/catalog workflows. Extend the existing Kotlin playback service, isolate the player clock from React renders, move disk work off the player thread, and prototype one native lyrics view only if profiling identifies lyrics rendering as a material cost. Upgrade Media3 in its own slice before adopting current preload APIs. A full Compose player is a later measured decision; an entire Kotlin app rewrite is not the first optimization.

The user reports lag across the app, so the baseline must include Stream, Library, Luvs and Now Playing. A faster transport service will not by itself repair slow list shaping, image decoding, overdraw, JS subscriptions or shader composition. The native plan complements the master plan's React/GPU work rather than replacing it.

## What already exists

Paths below are relative to `C:\dev\allegra`. Line references were obtained from the current graft graph; recheck them before implementation.

| Area | Current source evidence | Implication |
|---|---|---|
| Android playback | `apps/mobile/android/app/src/main/java/com/lyricflow/app/services/PlaybackService.kt:176–250`, `onCreate` builds ExoPlayer + MediaSessionService, registers `addSession`, handles audio focus/noisy output and wake mode. | Audio is already Kotlin/Media3. Rewriting audio in Kotlin adds no new ownership. |
| Queue ownership | `.../playback/QueueEngine.kt:36–475`, `setQueue`, `replaceQueue`, `playNext`, `addToQueue`, `skipToNext`, `skipToPrevious`, `setShuffle`, `setRepeat`, `restore`. `QueueForwardingPlayer` handles system skips. | Whole queue, shuffle/repeat and notification controls already work without JS choosing the next item. Preserve this authority. |
| Ordered commands | `apps/mobile/src/services/NativeAudioPlayer.ts:83–111`, `serial`, `isQueueBusy`, `whenQueueIdle`, `afterQueue`. | Do not add an independent command lane or acknowledge commands before the player thread applies them. |
| UI status | `.../modules/PlayerBridge.kt:170–190`, `startProgressPoller`: 250 ms, only when `player.isPlaying && uiVisible`; `MainPlayerModule.kt:40–489` activity lifecycle stops foreground reports. | The app already suppresses background/paused polling. Four reports/s are not evidence of the root cause. Improve consumers before reducing rate blindly. |
| Queue data crossing RN | `NativeAudioPlayer.ts:17–26`, `NativeQueueState`: ids/cursor/modes/tag/position; full `items` only for reads/restoration. | Preserve small ordinary events. Do not send the complete queue on every position sample. |
| Position path | `apps/mobile/src/contexts/PlayerContext.tsx:37–178`, `AndroidPlayerProvider`; `src/playback/positionBus.ts`. | Native position is mirrored into RN, with a shared-value path available. Profile which consumers still force React work. |
| Radio continuation | `apps/mobile/src/services/stream/StreamService.ts:240–283`, `extendRadio` calls `recommendFor`, dedupes and inserts with the captured native queue tag. | Queue advances natively but generating new radio items still needs JS. Background endless radio is a real remaining Kotlin opportunity. |
| Preparing the next song | `apps/mobile/src/store/playerStore.ts:66–73`, `prepareNextInQueue` currently prefetches only `coverImageUri`. | Calling this function does not establish audio-byte preloading. Test actual join latency before choosing a preload policy. |
| Persistence | `QueueEngine.kt:58,399–403,410–443`: `saveRun = Runnable { saveNow() }`, posted to `main`; `saveNow` contains `temp.writeText(text)` at line 431. | Concrete main-handler disk-write path to remove. It may cause intermittent stalls on slow storage, but its contribution to this user's lag is unmeasured. |
| Audio buffer/cache | `PlaybackService.kt:196–219`: 30 s minimum/240 s maximum buffer, prioritizes time; plain DefaultDataSource/DefaultHttpDataSource. | Current stream buffer is deliberately large for background reliability. Native audio disk caching is absent in this factory; do not shrink the buffer without a screen-off regression test. |
| Native dependencies | `apps/mobile/android/app/build.gradle:170–172` pins all three Media3 artifacts to `1.3.1`; `android/gradle.properties:32,45,49` enables release minification, New Architecture and Hermes. | Current documented preload APIs require version verification/upgrade. Hermes, R8 and New Architecture are already enabled; listing them as new optimizations would be misleading. |
| Other native work | Scoped rules document native WorkManager downloads/update workers, Luvs URL-keyed player pool, Palette, voice recognition and rescue UI. | Extend existing modules. Avoid duplicate download engines, pools or databases. |

The older memory entry saying JS owns much of the Android queue predates this implementation. Current source and `apps/mobile/CLAUDE.md` are authoritative. `apps/mobile/AGENTS.md` contains older descriptive architecture too; preserve its applicable rules, but do not revive removed state ownership or the old disabled desktop-bridge assumption.

## Verified reference applications

### Echo Music

Verified live upstream: [EchoMusicApp/Echo-Music](https://github.com/EchoMusicApp/Echo-Music), main pinned at [`399e6bcb44ebd2d3e08915d13f079b7af3ee1635`](https://github.com/EchoMusicApp/Echo-Music/tree/399e6bcb44ebd2d3e08915d13f079b7af3ee1635), commit author Aditya. The local clone at `C:\Users\nithy\Desktop\aclones\Echo-Music-upstream` points to that repository but remains at `4934cbfbb0f09aaf80a4e12d279ee8933813270a`; it is a historical reference, not current upstream.

Observed current patterns worth adapting conceptually:

- [MusicService.kt](https://github.com/EchoMusicApp/Echo-Music/blob/399e6bcb44ebd2d3e08915d13f079b7af3ee1635/app/src/main/kotlin/com/music/echo/playback/MusicService.kt#L2398): service-owned queue continuation uses `Dispatchers.IO`, captures queue identity and generation, and rejects stale results before appending.
- [MusicService.kt cache factory](https://github.com/EchoMusicApp/Echo-Music/blob/399e6bcb44ebd2d3e08915d13f079b7af3ee1635/app/src/main/kotlin/com/music/echo/playback/MusicService.kt#L3076): download cache and bounded player cache are separate layers.
- [PlayerConnection.kt](https://github.com/EchoMusicApp/Echo-Music/blob/399e6bcb44ebd2d3e08915d13f079b7af3ee1635/app/src/main/kotlin/com/music/echo/playback/PlayerConnection.kt#L134): queue, metadata and transport properties have separate state flows.

These patterns match the intended direction; they do not prove Allegra would match Echo's performance. Do not copy the whole service: upstream has product features and provider assumptions Allegra does not share. [Echo's license](https://github.com/EchoMusicApp/Echo-Music/blob/399e6bcb44ebd2d3e08915d13f079b7af3ee1635/LICENSE) is GPL-3.0; retain source attribution/notices and review any concrete copy against Allegra mobile's GPL-3.0-only license.

### PixelPlayer and PixelPlayerOSS

The name resolves to [PixelPlayerHQ/PixelPlayer](https://github.com/PixelPlayerHQ/PixelPlayer), master pinned at [`63cb59b97aff1d60c5aa46afdf5ce489e632b267`](https://github.com/PixelPlayerHQ/PixelPlayer/tree/63cb59b97aff1d60c5aa46afdf5ce489e632b267), copyright Theo Vilardo. Its current [LICENSE](https://github.com/PixelPlayerHQ/PixelPlayer/blob/63cb59b97aff1d60c5aa46afdf5ce489e632b267/LICENSE) is proprietary: personal/non-commercial study/use is allowed, commercial distribution including Play Store derivatives is restricted. Use as a study reference only; do not copy code/assets into this product.

Separately, [PixelPlayerHQ/PixelPlayerOSS](https://github.com/PixelPlayerHQ/PixelPlayerOSS), maintained by lostf1sh, is pinned at [`ba94188015258211889abe62baea8ff4e928e805`](https://github.com/PixelPlayerHQ/PixelPlayerOSS/tree/ba94188015258211889abe62baea8ff4e928e805). Its README identifies GPL-3.0-or-later; verify file headers/notices for any actual adoption. Relevant inspected source:

- [MusicService](https://github.com/PixelPlayerHQ/PixelPlayerOSS/blob/ba94188015258211889abe62baea8ff4e928e805/app/src/main/java/com/lostf1sh/pixelplayeross/data/service/MusicService.kt#L153): lifecycle-scoped Kotlin playback work and scope cancellation on destroy.
- [PlayerSheetAnimationBenchmarks](https://github.com/PixelPlayerHQ/PixelPlayerOSS/blob/ba94188015258211889abe62baea8ff4e928e805/baselineprofile/src/main/java/com/lostf1sh/pixelplayeross/baselineprofile/PlayerSheetAnimationBenchmarks.kt#L30): repeated sheet scenarios with `FrameTimingMetric` and controlled compilation.
- [LyricsSheet](https://github.com/PixelPlayerHQ/PixelPlayerOSS/blob/ba94188015258211889abe62baea8ff4e928e805/app/src/main/java/com/lostf1sh/pixelplayeross/presentation/components/LyricsSheet.kt#L1212): derived active line and guarded list following. Adopt the separation of timing and geometry, preserving Allegra's own accepted glide and typography.

## Kotlin candidates ranked by practical value

This ranking is conditional on baseline results. Effort is relative, not an estimate in days; no speedup percentages are claimed.

| Priority | Slice | Expected benefit | Effort / risk | Decision |
|---|---|---|---|---|
| 0 | Release profiling plus global scenario tags | Finds which thread/resource actually limits each area; avoids expensive rewrites with no gain | Small-medium / low | Do first across all four main areas. |
| 1 | Queue persistence snapshot + ordered IO writer | Removes a known disk write from the main handler | Small-medium / low-medium | Strong first native optimization; validate durability on teardown/process death. |
| 1 | Native snapshot generations + granular status consumers | Avoids stale status, full queue retransmission and React work from time updates | Medium / medium | Implement after measuring subscriber costs; retain immediate transport events. |
| 2 | Native service-owned background radio refill | Keeps radio supplied while RN is inactive and prevents JS/network work landing during UI interactions | Medium-large / medium-high | First use existing API contract; preserve account context and queue-tag rules. |
| 2 | Bounded native audio cache + measured next-item preload | Reduces repeated network waits and join latency; separate from frame jank | Medium / medium-high | Requires version compatibility, cache identity, network/storage policy and background QA. |
| 3 | Native lyrics surface | Removes line/word frame work and text layout from RN for a measured hotspot | Medium-large / medium | Prototype one surface behind a flag, retain RN fallback. |
| 3 | Native Luvs preload manager/pool consolidation | Can reduce concurrent allocator/decoder pressure in multi-clip navigation | Large / high | Existing Kotlin pool already exists; change only after pool/memory traces. |
| 4 | Native library scanning/search worker | Moves expensive MediaStore/metadata scans off JS and main; useful at large library sizes | Large / medium-high | Keep SQLite authority; no simultaneous Room + expo-sqlite owners. Root data plan should decide this. |
| 5 | Entire player in Compose | Removes RN from one complex interactive surface if native prototype wins | Very large / high | Measured gate only; keep shared services and account/catalog contracts. |
| 6 | Entire app in Kotlin | Would replace navigation/auth/library/Connect/settings/sync as well as views | Very large / very high | Not justified by source review. Reconsider only after targeted slices still fail budgets. |

## Slice 0: Baseline and observability

Add proposed `apps/mobile/android/benchmark/` module, `PlayerJourneyBenchmark.kt` and `StartupBenchmark.kt`; integrate through `android/settings.gradle` and a profileable release-like target configuration. Add proposed `performance/FrameMetricsRecorder.kt` and scene annotations at `MainActivity.kt`, with JS reporting coarse scene changes through `StartupModule` or a narrowly scoped performance module. Do not add session replay or an additional analytics vendor.

Use [Macrobenchmark](https://developer.android.com/topic/performance/benchmarking/macrobenchmark-overview) for cold/warm startup and repeatable user journeys, [Perfetto/system tracing](https://developer.android.com/topic/performance/tracing) for JS/main/render/storage/network correlation, and [JankStats](https://developer.android.com/topic/performance/jankstats) for scenario context. Aggregate JankStats data off the main thread; do not log every frame. Benchmark compilation with/without a generated [Baseline Profile](https://developer.android.com/topic/performance/baselineprofiles/measure-baselineprofile) separately: it can improve native/JVM startup paths, but does not AOT-compile the Hermes JavaScript bundle.

Required scenes: cold launch to usable Stream; Stream shelves/search scroll; Library with large local inventory and downloads in flight; Luvs lane/depth swipe; mini-player → full player → lyrics → queue → close; covers/canvas on and off; video+lyrics, full lyrics and upper-lyrics/lower-controls layouts; 30-minute screen-off audio/radio; foreground recovery.

Capture p50/p95/p99 frame overrun, JS commit/scheduling samples, TTID/TTFD, tap-to-player/tap-to-audio, next-track join latency, native/Hermes heap, decoder count, buffered bytes, cache hit ratio, network bytes and battery/thermal state. Record build SHA, device model/API/RAM, refresh rate, battery saver, animation scale and fixture. Start with 10 repeated journeys per condition on a budget Android and a normal phone, report variance and raw traces. Use emulator only for functional coverage. Performance testing must use release builds ([React Native performance guidance](https://reactnative.dev/docs/0.81/performance)).

Proposed acceptance budgets, to ratify against the first baseline: fewer than 5% missed frame deadlines per scrolling/transition scenario on the selected 60 Hz reference devices; no recurring stalls above 100 ms during steady interaction; no audio gap introduced by a UI operation; no increase in startup, memory or battery cost beyond measurement noise. These are goals, not current results. Keep the on-screen HUD as a diagnostic, not the acceptance measurement.

## Slice 1: Move persistence IO off the player thread

Owned existing files: `playback/QueueEngine.kt`, `QueueSnapshot.kt`; proposed `QueueSnapshotWriter.kt` and JVM tests. The graph did not index incoming `saveNow` edges, so inspect literal uses and lifecycle flushes as well as the `Runnable` path before editing.

1. Build a small immutable snapshot on ExoPlayer's application looper. Never read player state from `Dispatchers.IO`.
2. A single IO coroutine/actor encodes and writes snapshots. Conflate pending writes; include a monotonically increasing revision so an older write cannot replace a newer one.
3. Retain temporary-file → rename behavior and snapshot decode compatibility. Handle storage full, corrupt data and partial writes by retaining the previous valid snapshot.
4. Separate player release from writer completion. Do not block main with `runBlocking`, and do not cancel an already-started write merely because the RN activity detached. Define last durable checkpoint semantics; Android process kill cannot guarantee an arbitrary final flush.
5. Keep restoration paused, queue tag, shuffled play order, repeat and seconds↔milliseconds conversion unchanged.

Acceptance: StrictMode/Perfetto show no queue file writes on main; shuffled/reordered queue restores correctly after interrupted writes and process kill; 500-item queues remain valid; stale snapshot jobs cannot overwrite a newer queue; existing `QueueMath`/`QueueSnapshot` JVM suite passes. Rollback: preserve format and swap the writer implementation, without deleting a valid queue.

## Slice 2: Native state hub and one playback clock

Owned files: `modules/PlayerBridge.kt`, `MainPlayerModule.kt`, `services/NativeAudioPlayer.ts`, `contexts/PlayerContext.tsx`, `playback/positionBus.ts`; proposed `playback/PlaybackStateHub.kt`. Keep the Kotlin queue engine as the authority.

Separate three channels:

- Structural events: track, queue revision/order/cursor, repeat/shuffle, errors. Send on changes only. A full queue snapshot is requested for initial attach/recovery and actual shape changes, never on position polling.
- Transport events: play intention, actual `isPlaying`, buffering, suppression, speed, seeks/discontinuities. Send immediately and reconcile on attach/foreground.
- Position: a compact foreground sample, currently 4/s. Write shared values; prevent it from re-rendering root/provider/whole-screen trees. Only reduce the sample rate after comparing drift and render cost.

Proposed internal snapshot contract, additive rather than silently replacing current events:

```ts
type PlaybackAnchor = {
  serviceGeneration: number; // changes whenever the native service/player is rebuilt
  sequence: number;          // strictly increasing within that generation
  queueRevision: number;
  queueTag: string | null;
  mediaId: string | null;
  positionSec: number;
  durationSec: number;
  bufferedSec: number;
  sampledAtElapsedRealtimeMs: number; // monotonic Android timestamp; not a duration
  playbackRate: number;
  playWhenReady: boolean;
  isPlaying: boolean;
  buffering: boolean;
  suppressed: boolean;
};
```

Duration/position at the RN seam stay seconds. Native Media3 fields remain milliseconds internally; convert once at the boundary. The clock derives from ExoPlayer, never a JS interval advancing the audio. Native renderers extrapolate `positionSec + elapsedSeconds * playbackRate` only while actually playing, not merely `playWhenReady`; pause/buffer/focus suppression freeze the anchor. Reset anchors immediately on seek, transition, speed change and foreground resumption. Clamp to valid duration, reject old generation/sequence/mediaId data, and fence in-flight seek replies.

Android `elapsedRealtime` and JS `performance.now` are different domains. Never subtract them directly. RN can use receive-time anchoring with bounded correction or a tested ping/midpoint offset calibration if interpolation is needed; the native lyrics view reads the hub directly and needs neither conversion nor per-frame bridge updates. The presented clock is a visualization of playback, not another authority. For Connect remote playback, use the existing remote session clock, not the local dormant player.

Acceptance: immediate pause/seek/mode changes; no stale position from the previous song/service; no growing lyric drift at changed speed, seeks or focus loss; hidden/paused subscribers do zero periodic work; JS renders per second and payload bytes are recorded before/after; queue acknowledgements retain current ordering. Rollback: maintain old event adapters during rollout.

## Slice 3: Native background radio continuation

Existing boundaries: `StreamService.extendRadio`, `services/stream/recommend.ts`, `playback/nativeQueue.ts`, `QueueEngine.maybeAskForMore`. Proposed Kotlin `playback/RadioRefillCoordinator.kt` + `RadioRepository.kt`; integrate with `PlaybackService` lifecycle.

The existing [GET /api/recommendations contract](../../docs/api-contract.md) already returns playable catalog rows with `songId` and bearer context (`docs/api-contract.md:185–195`). First verify it is sufficient for the intended stream/library seed and behavior. A native implementation using that endpoint is an API-preserving vertical slice. If current `recommendFor` needs unsupported inputs or continuation semantics, propose the contract change before implementing; do not silently replace it with a new client provider protocol.

Flow: engine reaches low watermark → capture queue tag/revision and current seed → one service-owned cancellable IO request with finite timeout → validate envelope/catalog rows → dedupe with id and recording keys → post insertion to application looper only if tag/seed ownership remains valid → persist new queue → emit settled state. Enforce existing settings, repeat-one exclusions, Connect/Listen together ownership and auto-refill rules. Cancel old work on new queue/service release. Finite exponential backoff while playing; no everlasting timer when idle.

Authentication must be provisioned through a narrow existing credential/session seam: token kept private on device, no provider secret in RN props, no token/URL logging. Bound guest/account context and clear jobs/cache on sign-out as applicable. Network failure leaves already queued music usable; do not strand playback waiting on radio.

Use a coroutine in the already-running media service for time-sensitive continuation. [WorkManager](https://developer.android.com/develop/background-work/background-tasks/persistent) is for deferrable durable preparation/download work, with [unique work](https://developer.android.com/develop/background-work/background-tasks/persistent/how-to/manage-work); its scheduling is not a next-song deadline guarantee. Preserve [foreground-service requirements](https://developer.android.com/develop/background-work/services/fgs/service-types), notification controls and the existing service registration. Do not start autoplay after boot.

Acceptance: radio continues beyond initial items with screen off and RN inactive; one request per queue/seed at a time; changing playlists during fetch never appends stale songs; no refill in repeat-one/remote-owned/listen-together states; airplane mode, auth expiry and provider failure retain truthful transport state. Rollback: disable native refill and restore the existing foreground JS coordinator, never run both simultaneously.

## Slice 4: Media3 upgrade, cache and next-item preload

Existing files: `android/app/build.gradle`, `services/PlaybackService.kt`, `playback/QueueEngine.kt`; proposed `playback/PlaybackCache.kt`. Upgrade all Media3 artifacts together to a chosen tested stable release after consulting [official release notes](https://developer.android.com/jetpack/androidx/releases/media3). Do not inject a modern API into the current 1.3.1 build. Validate audio focus, foreground service, queue forwarding and RN wrappers before adding preload behavior.

Add one `SimpleCache` owner per directory with bounded LRU eviction and `CacheDataSource` for catalog streams; keep explicit downloads in their existing storage/worker path. Cache keys need provider-qualified recording identity plus resource format/version, not an expiring signed URL; do not reuse bytes across different variants. Local `file`/`content` playback should not be copied into a network cache. Respect byte ranges, authenticated source policy, storage pressure and cache errors. [SimpleCache permits only one instance per directory](https://developer.android.com/reference/androidx/media3/datasource/cache/SimpleCache).

For QueueEngine's already-known next item, test the simpler [playlist PreloadConfiguration](https://developer.android.com/blog/posts/elevating-media-playback-introducing-preloading-with-media3-part-1) after upgrading; active audio loading wins. Start with one bounded next item and separately measure wifi/cellular, downloaded/streamed and Battery Saver. The four-minute audio buffer is a reliability choice: compare retained memory, join latency and background stalls before replacing it with a smaller adaptive policy.

Reserve [DefaultPreloadManager](https://developer.android.com/media/media3/exoplayer/preloading-media/preloadmanager) for dynamic candidates such as Luvs lanes. Share its components and playback looper consistently with the consuming player; handoff of stateful sources must obey [Media3 threading guidance](https://developer.android.com/blog/posts/elevating-media-playback-a-deep-dive-into-media3-s-preload-manager-part-2). Do not add a second uncontrolled pool on top of the existing `LuvsPlayerModule.byUrl` implementation.

Acceptance: measured next-item join latency/cache hit behavior improves on the network fixture without worsening current-track buffering; bounded heap/buffer/cache bytes; no duplicate cache ownership; 206/seek behavior survives; screen-off streaming lasts the full scenario; quality variants never share incorrect bytes. Rollback: disable preload/cache writes; keep download files untouched and the previous buffering policy available.

## Slice 5: Native lyrics surface prototype

Proposed exact integration paths:

- `apps/mobile/src/specs/LyricsSurfaceNativeComponent.ts`: RN 0.81 Codegen component contract.
- `apps/mobile/src/components/player/NativeLyricsSurface.tsx`: platform/flag wrapper; existing `SynchronizedLyrics` remains fallback.
- `apps/mobile/android/app/src/main/java/com/lyricflow/app/lyrics/LyricsSurfaceView.kt`, `LyricsSurfaceManager.kt`, `LyricsSurfacePackage.kt`: native view and Fabric registration.
- `.../lyrics/LyricLayoutModel.kt`, `LyricsClockFollower.kt`: pure geometry/following and hub subscription.
- Integrate into existing `apps/mobile/src/components/NowPlayingLyricsArea.tsx`; preserve `apps/mobile/src/screens/NowPlayingScreen.tsx` and `apps/mobile/src/components/NowPlayingControls.tsx` gestures/control semantics.

Use [RN 0.81 Fabric component guidance](https://reactnative.dev/docs/0.81/fabric-native-components-introduction), matching the installed 0.81.5 runtime. Register the ReactPackage through `apps/mobile/android/app/src/main/java/com/lyricflow/app/MainApplication.kt`; do not assume Expo autolinking will register a custom native view. If the chosen implementation introduces an Expo module/dependency, also update the checked-in `apps/mobile/android/app/src/main/java/expo/modules/ExpoModulesPackageList.kt` and `apps/mobile/src/nativeModuleList.test.ts`. The specific Codegen schema must compile before any product migration.

Reviewable proposed view contract:

| Input/event | Meaning and ownership |
|---|---|
| `mediaId`, `lyricsRevision`, `serviceGeneration` | Atomic source identity. Late layout/provider replies for old identities are discarded. |
| `lines` | Immutable pre-parsed `{ timestampSec, text, lineOrder, words? }`; transfer once per lyric revision, not each tick. Valid word timing only. |
| `live`, `layoutMode` | Explicit actual visibility; layout modes preserve video top + lyrics below, full lyrics, and upper lyrics + lower controls. |
| `activeLineFraction` | Default 0.35 of the measured unobscured lyrics viewport; not the entire display. |
| `textSize`, `alignment`, `reducedMotion`, colors | Existing settings/theme contract; no unrelated typography/design system. |
| `viewportInsets` / measured bounds | Exclude video/controls/safe areas and recompute on rotation/font/layout changes. |
| `onSeekRequested` | `{ mediaId, serviceGeneration, lyricRevision, targetSec }`; routed through existing player command funnel. Native view never starts another player. |
| `onUserScrollStateChanged` | Low-frequency begin/end/follow state so the enclosing player pan keeps current gesture ownership. |
| `onNativeFailure` | Identity + safe reason, selecting RN fallback; no per-frame event or screen-recording telemetry. |

Either a custom View using StaticLayout/Paint and one block translation, or a ComposeView with carefully scoped state can implement it. Prototype the simpler view first if text layout/word painting is the hotspot. Shape/cache text off main as permitted, install immutable layouts on main, keep only visible/neighbor lines, invalidate the minimum changed regions. Native Canvas/Compose still uses the GPU; it does not eliminate heavy blur or overdraw.

Lifecycle: attach subscribes to the native state hub; attach does not create an ExoPlayer. The frame callback runs only when `live && attached && lifecycleStarted && (actuallyPlaying || glideActive)`. Stop it when hidden, paused and settled, detached, backgrounded or released. Native status changes can resynchronize while no frame loop is active. Dispose listeners/coroutines/bitmaps when the view is dropped. For ComposeView use a deliberate [ViewCompositionStrategy](https://developer.android.com/develop/ui/compose/migrate/interoperability-apis/compose-in-views) suited to the host/recycling behavior; do not rely on a retained composition accidentally keeping playback subscriptions alive.

Preserve the accepted single non-bouncy block glide and manual-scroll resume rules. The active line center equals `contentTop + lineCenter - targetViewportY`; clamp with adequate leading/trailing padding, and recompute wrapped line metrics when width/font changes. The current lyric positioning correction can ship independently; do not require a Kotlin renderer to correct its geometry.

Acceptance: native/RN behavior parity on synced/plain/word timing, multiline/Indic/RTL text, seeks, tempo, manual scrolling, font 20–44, rotation, reduced motion and all three layouts; no offscreen animation; no stale song line; visible transport and screen reader support; long session no growing heap; measured lyric scene frame/JS cost improves beyond run-to-run variance. Rollback: select RN fallback on settings/build flag or native error; keep lyric/settings data format unchanged.

## Gate to a full Compose player

Only propose the full player after the baseline, RN subscription/GPU cleanup and native lyrics prototype. Require evidence that remaining RN player work materially dominates missed deadlines across the target phones, and that the prototype improves those deadlines without startup/memory/feature regressions. If Perfetto instead shows render-thread/GPU fill or artwork decode dominating, continue graphics/resource work.

A full native player would be one embedded surface or Android destination, backed by the same MediaSessionService, QueueEngine, radio/cache/hub. Keep React Native Stream/Library/Luvs/account flows and existing shared TS contracts initially. Its action adapter must cover play/pause/seek, queue editing, volume/output, sleep timer, lyrics provider selection, liking, menus, Listen together, Connect remote owner and transfer. Preserve all three requested video/lyrics layouts, design tokens, mini-player handover, insets, back/pan precedence, accessibility and reduced motion. Never mount two authorities or two simultaneous players during a transition.

Migration gate: complete action inventory and automated/native-device parity matrix; new surface exceeds baseline variance on the targeted scenes; background and Connect tests pass; APK size/startup/battery effects reviewed; staged build flag with easy RN restoration. Whole-app Compose is a separate product/platform decision after this measured player rollout, not a required final step of this plan.

## Non-goals and invariants

- No API contract edits, provider extraction change, deployment, library DB replacement, account migration or full UI redesign in the optimization slices.
- Android's Media3/QueueEngine remain authoritative; iOS keeps expo-audio/JS until separately implemented.
- All UI play/pause routes through `requestPlayback`; load effects never depend on `isPlaying`; seeks preserve/resume prior playback intention; queue command/tag ordering and paused restoration survive.
- Preserve existing media focus, notification/system controls, stall/network recovery, downloaded/streamed distinctions and Connect/Listen together ownership.
- Decorative canvas stays muted and never claims audio focus. Functional music video is a separate source/timeline feature from canvas; coordinate the YouTube/video plan rather than treating arbitrary video audio as the master clock.
- A new task must stop itself when not needed. No periodic polling added to idle/hidden work. No session replay, provider secrets in public state or production noisy logging.
- Existing root/API/serverless boundaries stay: provider/API caching optimization belongs in the master backend plan. Kotlin cannot improve Vercel cold cache hit rate by itself.

## Delivery and verification

Deliver one small vertical slice at a time: baseline → persistence → snapshot consumers → version-compatible cache/preload → background radio → optional lyrics view → measured full-player decision. Background radio can precede preload if device evidence identifies it as the higher value issue. Show diff and recorded evidence after each slice; no simultaneous renderer/service/data rewrites.

For native changes run mobile `npm run ci` (or direct local binaries if the known npm shim is broken) and `apps/mobile/android/gradlew.bat :app:testDebugUnitTest`; native view/dependency/build changes also compile the release APK and preserve `nativeModuleList`/worklet safety gates. Root typecheck/lint/test are required when shared/root code changes. Keep `.github/scripts/mobile-player-probe.sh`, mobile launch gate and render-liveness assertions; continued audio alone is insufficient.

Record physical-device proof separately from JVM/Jest/emulator evidence. Required device run: downloaded and streamed tracks, no canvas and canvas, toggling lyrics after playback begins, all three layouts, repeat/shuffle/reorder, notification/Bluetooth screen-off controls, radio refill under RN inactivity, kill/relaunch/paused restore, seek/tempo/focus loss, sign-out, offline/network loss, Connect transfer and Listen together exclusion. Every trace/report names the commit and device. Without such evidence mark the slice implemented and locally checked, not performance-accepted.

## Research provenance and graft tally

Read root AGENTS/CLAUDE, architecture/API/workflows/roadmap and mobile AGENTS/CLAUDE; applied backend-developer architecture/performance boundary checks. Memory (`MEMORY.md:3–4,35–39`) supplied the older diagnosis and handoff context; live source supersedes its queue-ownership description. Upstream identities/commits/licenses were verified through GitHub API and pinned raw source, and official Android/RN docs were checked live on 2026-10-04.

Measured graft outputs: 4,978 + 4,201 + 1,529 + 2,885 + 26,999 + 14,204 + 27,039 + 133 + 3,090 + 2,018 + 714 + 4,874 + 4,977 + 4,947 = **102,588 tokens saved across 14 measured calls**. Tool-reported value: **less than $0.19** (three priced calls total $0.08 and eleven calls each reported less than $0.01). One initial discovery invocation's result was not retained in the tool display and is excluded from this tally; 15 CLI calls were invoked in total. This is the tool's estimate of avoided source-reading tokens, not a measured performance result.
