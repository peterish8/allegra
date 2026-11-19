# Kotlin tune-up and the last migrations (2026-11-19)

Audit of `apps/mobile/android/app/src/main/java/com/lyricflow/app` (about 16.4k lines) at `992854f`, done the ponytail
way: delete first, reuse what is here, stdlib/platform before new code, measure before claiming. The Kotlin is already
good in the places that matter most (paints preallocated, frame loops capped, queue writes off the main thread,
Luvs pool memory-aware). What is left: **the same cover is fetched and decoded by five separate pipelines**, **three
HTTP stacks**, some **lifecycle leaks**, a little **dead code**, and **three JavaScript jobs** that belong in Kotlin.

Every item: its own PR, version bump, JVM test for any logic, `npm run ci` + `:app:testDebugUnitTest`, and the
`Mobile benchmark` workflow (base vs head) attached. No speed claim without a number.

## Findings

| # | Finding | Where | Cost today |
|---|---|---|---|
| F1 | Five cover pipelines, each with its own thread pool and memory cache, none with a disk cache | `views/CoverArt.kt` (pool 2, 12 MB LRU), `views/NativeAppleBackdropView.kt` (pool 2, two LRUs), `views/NativeFlowGlowView.kt` (pool 1, LRU 16), `modules/PaletteModule.kt` (HttpURLConnection, fixed `inSampleSize = 4`), `island/IslandArt.kt` (pool 2, dead) | The playing song's cover is downloaded and decoded up to 4 times per process, again after every cold start. Old phones pay in data, decode CPU and GC |
| F2 | Three OkHttp clients plus raw `HttpURLConnection` | `luvs/SaavnClient.kt`, `workers/DownloadWorker.kt`, `workers/AppUpdateWorker.kt`, `PaletteModule` | Separate connection pools and dispatcher threads; no TLS/connection reuse between Saavn, downloads and covers. OkHttp's own guidance: one client, `newBuilder()` for variants |
| F3 | Failed cover = failed for the rest of the process | `CoverCache.failed` (`CoverArt.kt`) | One network blip leaves a generated tile until the app is killed |
| F4 | Coroutine scopes never cancelled | `DownloaderModule.scope` (Main), `PlayerBridge.pollerScope` | Leak across React reloads / UI recovery restarts (`UiRecovery` restarts the activity) |
| F5 | Allocation in `onDraw` | `views/NativeTransportView.kt:88-96` (`RectF`, `Path` per frame) | GC churn on the transport while animating |
| F6 | Palette decodes a fixed quarter of the image | `PaletteModule.decodeBitmap` | A 3000 px local cover still decodes at 750 px; Palette needs ~100 px |
| F7 | Dead code | `views/LuvsPagerView.kt` + `modules/LuvsPagerModule.kt` (no JS caller; CLAUDE.md: "no longer used"), `island/IslandArt.kt`, `island/IslandTime.kt` | ~390 lines + the `viewpager2` dependency in the APK |
| F8 | No audio offload | `services/PlaybackService.kt` ExoPlayer builder | Screen-off playback keeps the CPU decoding; Media3's battery guide recommends offload for long screen-off listening |
| F9 | Radio top-up and stream-link refresh need JavaScript | `StreamService.extendRadio`, `playback/recovery.ts` `refreshStreamLink` | Screen off + JS asleep → radio runs dry, an expired link stops the music |
| F10 | Mini player lyrics and glows still in JS/Skia | `MiniPlayer.tsx:966` (`SynchronizedLyrics`), `MiniPlayerGlow`/`GlowBackground`/`EdgeGlow` | Per-frame UI-thread work on every screen the glow pill shows |

## Plan

### Phase A — delete and share (smallest diffs, biggest cut). One PR each.

**A1. Delete dead code (F7).** Remove `LuvsPagerView`, `LuvsPagerModule` (and its line in the checked-in
`ExpoModulesPackageList.kt`), `IslandArt`, `IslandTime`, the `viewpager2` dependency. Gate: `nativeModuleList.test.ts`,
`apkSize.test.ts`, launch check. Net about −390 lines, smaller APK.

**A2. One HTTP client (F2).** `net/Http.kt`: `object Http { val client by lazy { OkHttpClient.Builder()…cache(Cache(cacheDir/"http", 32 MB)).build() } }`,
initialised from `MainApplication` with the app context. Saavn, DownloadWorker and AppUpdateWorker take
`Http.client.newBuilder()` with their own timeouts (shares pool and dispatcher). Downloads skip the HTTP cache
(`CacheControl.FORCE_NETWORK` or `.cache(null)` on their builder). Net: −2 builders.

**A3. One art loader (F1, F3, F6).** `art/ArtLoader.kt` replaces the four pipelines:
- one 2-thread low-priority executor (Media3's `DataSourceBitmapLoader` wants a `ListeningExecutorService`; keep that),
- one byte-sized `LruCache` keyed `uri@px`, sized from `ActivityManager.memoryClass / 16` (low-RAM or `memoryClass <= 192`: `/ 24`),
- disk: `OkHttpDataSource.Factory(Http.client)` so covers hit the shared HTTP cache (adds `media3-datasource-okhttp`,
  same Media3 version, already pinned by `media3Version.test.ts`), local `file://`/`content://` unchanged,
- in-flight coalescing per key (already in `CoverCache.pending`; move it),
- a failure is retried after 60 s, not never,
- `onTrimMemory(TRIM_MEMORY_RUNNING_LOW+)` → `trimToSize(size / 2)`; `UI_HIDDEN` → `evictAll()` of the large backdrop sizes only,
- Palette asks the loader for a 128 px square instead of decoding the file itself.
`CoverCache`, `NativeAppleBackdropView`, `NativeFlowGlowView`, `PaletteModule` call it. Pure math (`artBudgetBytes`,
`retryDue`) in a JVM-tested file like `CacheBudget.kt`. Expect fewer downloads and less decode on song change and
cold start; prove it with the benchmark plus `dumpsys meminfo` before/after.

**A4. Lifecycle and draw hygiene (F4, F5).** `OnDestroy { scope.cancel() }` in `DownloaderModule`; cancel
`PlayerBridge.pollerScope` where the bridge is released; hoist the `RectF`/`Path` in `NativeTransportView` to fields.
Debug-only `StrictMode.VmPolicy` (`detectLeakedClosableObjects`, `detectActivityLeaks`, `penaltyLog`) next to the
thread policy already in `MainApplication`.

### Phase B — old-phone playback (needs a real phone to accept)

**B1. Audio offload (F8).** `TrackSelectionParameters.AudioOffloadPreferences` with mode `ENABLED`,
`isGaplessSupportRequired = true`, `isSpeedChangeSupportRequired = true`; switch it off while tempo/pitch are not 1.0
or the equalizer is on (both change the decoded PCM). Offload negotiation is known to misreport on some devices, so:
a kill switch constant, and acceptance only after an hour of screen-off playback on the M31 with skips, Bluetooth and
a call. If anything stutters, ship it off.

**B2. Low-RAM buffer.** Keep the 4-minute time buffer (it is what stopped screen-off stalls), but on `isLowRamDevice`
add `setTargetBufferBytes` so a high-bitrate stream cannot hold tens of MB. Constant in `CacheBudget.kt`, JVM test.

### Phase C — move the last JavaScript jobs into Kotlin

**C1. Radio top-up and fresh stream links in the service (F9).** `PlaybackService` handles `runningLow` itself: reuse
`SaavnClient.suggestions(songId)` (now on `Http.client`), drop songs already queued (port `dedupeStreamable`), insert
with the queue's tag (`QueueEngine` already refuses stale tags). On `expired`, re-resolve by title + artist with the
same rules as `resolver.ts` (no covers/lofi/slowed unless asked) ported into a pure `ResolveRules.kt` with JVM tests
fed the JS test fixtures. JS keeps its richer YouTube-Music radio while the app is in front; the service only fills in
while JS is asleep. YouTube Music stays metadata-only. Removes the "do not promise it in the background" caveat.

**C2. Mini player lyrics on `NativeLyricsView` (F10).** `MiniPlayer.tsx:966` uses `NativeSynchronizedLyrics` like
`NowPlayingLyricsArea` already does; add a remote-clock prop for Connect. When nothing renders `SynchronizedLyrics`
on Android, keep it only for iOS.

**C3. Native glow for the mini player and Cover glow (F10).** Follow `NativeFlowGlowView`: `RuntimeShader` on API 33+,
gradient fallback below; port `glowMath.ts`/`edgeGlowMath.ts` with JVM tests; same `visualBudget` caps and rest rule.

### Phase D — keep it fast

- Run `Mobile benchmark` on every PR above; add `dumpsys meminfo` PSS to `mobile-bench.sh` once A3 lands.
- Re-run the ponytail audit after Phase C; anything with one caller left by the migrations goes.
- The Expo 57 / RN 0.86.3 upgrade (Hermes V1 memory fix, new animation backend) after Phase A, measured the same way.

## Order and size

| Step | Size | Risk | Why this order |
|---|---|---|---|
| A1 delete | S | low | Nothing calls it |
| A2 one client | S | low | A3 and C1 build on it |
| A4 hygiene | S | low | Independent |
| A3 art loader | M | medium | Biggest data/CPU win; touches four views |
| C2 mini lyrics | S–M | low | Pattern proven in Now Playing |
| C1 radio in service | M–L | medium | Biggest "just works" win |
| B1/B2 offload, buffer | S code, L verification | medium | Needs a phone |
| C3 native glows | M | medium | Visual parity work |

Sources: [Media3 battery consumption](https://developer.android.com/media/media3/exoplayer/battery-consumption),
[AudioOffloadPreferences](https://developer.android.com/reference/androidx/media3/common/TrackSelectionParameters.AudioOffloadPreferences),
[OkHttpClient: one shared instance](https://square.github.io/okhttp/5.x/okhttp/okhttp3/-ok-http-client/index.html).
