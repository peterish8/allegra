# P1-1 Android on-device stream cache and resuming data source

Draft id: P1-2. Priority: P1, first to ship. Branch: `feat/android-stream-cache`. Mobile version bump: yes (minor).

## 1. Goal and user-visible outcome

A song streamed on LuvLyrics is kept on the phone's disk (up to a ceiling the listener picks), so replaying it,
seeking back into it, or recovering from a dropped connection reads from disk instead of the network. When the
connection drops mid-song or the server closes the body early, the player reopens the stream at the exact byte it
stopped at instead of ending the song early or failing. The listener sees: replays that start at once, fewer
"stopped at 1:47" glitches on patchy networks, less mobile data, and a "Song cache" choice plus "Clear song cache"
in Settings, Playback.

Non-goals:
- No offline downloads (Downloads already exist through WorkManager, `apps/mobile/src/services/DownloadManager.ts`).
- No caching on the web or desktop (the browser has its own HTTP cache; `Cache-Control: private, max-age=86400`
  is already sent by `apps/api/src/lib/streamResolver.ts:16,68`).
- No chunked range requests (Echo splits requests into fixed chunks to dodge YouTube throttling; Allegra's CDNs
  do not throttle that way, see REJECTED.md).
- No change to the Luvs player pool (`modules/LuvsPlayerModule.kt`) or the canvas video player.
- No change to the queue semantics, the saved-queue format version, or the three playback invariants.

## 2. Evidence

Current state (verified 2026-11-13 on `fix/web-auth-dialog-focus` @ 8a084c07):

| Fact | Where |
| --- | --- |
| ExoPlayer is built with a plain `DefaultHttpDataSource.Factory` inside `DefaultDataSource.Factory`; no cache, no resume wrapper | `apps/mobile/android/app/src/main/java/com/lyricflow/app/services/PlaybackService.kt:272-282` |
| Network errors re-prepare 4 times (1/2/4/8 s), refused links (`IO_BAD_HTTP_STATUS`, `FILE_NOT_FOUND`, `NO_PERMISSION`) go to JS as `expired` | `PlaybackService.kt:114-142` |
| Stall watchdog: 4 ticks of 4 s without progress, at most 2 in-place reloads, then `stall` to JS | `PlaybackService.kt:29-99` |
| Media items are built by the queue engine; `mediaId` = the song id, `uri` = the song address | `apps/mobile/android/app/src/main/java/com/lyricflow/app/playback/QueueEngine.kt:67-79` |
| Allowed media addresses are `file`, `content`, `https` only | `apps/mobile/android/app/src/main/java/com/lyricflow/app/playback/QueueItemSpec.kt:20-24` |
| Streamed songs (`stream:<source>:<id>`) carry the provider CDN URL directly; account songs carry `${ALLEGRA_API_URL}/api/stream/...` | `apps/mobile/src/services/stream/streamSong.ts:27-41`, `apps/mobile/src/services/stream/StreamService.ts:49` |
| A stream link can expire; JS fetches a fresh one and replaces the item in place (`loadItem` swaps the URI for the same id) | `apps/mobile/src/playback/recovery.ts:82-96`, `QueueEngine.kt:252-268` |
| Media3 is pinned to 1.8.0 and must equal the version expo-video/expo-audio use; a test guards it | `apps/mobile/android/app/build.gradle:211-218`, `apps/mobile/src/media3Version.test.ts` |
| Robolectric 4.17 and JUnit 4 are available to JVM tests | `apps/mobile/android/app/build.gradle:260-264` |
| AND-003 (retry budget restarting on the same network) is mostly addressed: `ResumeOnline.shouldResume` now requires a seen loss and a validated network | `apps/mobile/android/app/src/main/java/com/lyricflow/app/playback/ResumeOnline.kt:12-35`, `audit/FIX-BACKLOG.md:298-314` |

Behavioural reference (Echo, GPL-3.0; read for behaviour only, do not copy):
- `Echo-Music/app/src/main/kotlin/com/music/echo/playback/DynamicLruCacheEvictor.kt`: an LRU evictor whose ceiling is a
  mutable field (SimpleCache can only be opened once per folder per process, so the ceiling must move without
  reopening), plus a bounded exemption for spans near byte 0 because plain LRU always evicts a track's opening first.
- `Echo-Music/playback/src/main/kotlin/echo/music/iad1tya/playback/ChunkingDataSource.kt`: on an early end-of-input or a
  read error it closes and reopens the upstream at `position + bytesRead`, retries a few times with a short growing
  pause, and treats HTTP 416 / position-out-of-range as a clean end.
- `Echo-Music/app/src/main/kotlin/com/music/echo/playback/MusicService.kt:2270` sets a custom cache key per song id;
  `:3294-3324` stacks `CacheDataSource` over the HTTP stack with `FLAG_IGNORE_CACHE_ON_ERROR`.

External facts (accessed 2026-11-13):
- Media3 1.8.0 `DefaultHttpDataSource.readInternal` returns `C.RESULT_END_OF_INPUT` whenever the socket returns -1, even if
  fewer than `bytesToRead` bytes arrived. A body that ends early is therefore silent at this layer.
  https://raw.githubusercontent.com/androidx/media/1.8.0/libraries/datasource/src/main/java/androidx/media3/datasource/DefaultHttpDataSource.java
- Media3 1.8.0 `SimpleCache` locks its folder; a second instance on the same folder throws
  `IllegalStateException("Another SimpleCache instance uses the folder: ...")`; `release()` unlocks it.
  https://raw.githubusercontent.com/androidx/media/1.8.0/libraries/datasource/src/main/java/androidx/media3/datasource/cache/SimpleCache.java
- `media3-exoplayer` 1.8.0 exposes `lib-datasource` and `lib-database` as `api` dependencies, so `SimpleCache`,
  `CacheDataSource` and `StandaloneDatabaseProvider` need no new Gradle line.
  https://raw.githubusercontent.com/androidx/media/1.8.0/libraries/exoplayer/build.gradle
- Official cache recipe: `SimpleCache(dir, LeastRecentlyUsedCacheEvictor(maxBytes), StandaloneDatabaseProvider(context))`,
  `CacheDataSource.Factory().setCache(cache).setUpstreamDataSourceFactory(http)`, "should be a singleton".
  https://developer.android.com/media/media3/exoplayer/network-stacks
- `CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR = 2` exists in 1.8.0 (same file as above, CacheDataSource.java).
- UNVERIFIED (compile-check in step 1): `DataSpec.subrange(long)` and `MediaItem.Builder.setCustomCacheKey(String)` exist in
  1.8.0 with these names. Safe default if either is missing: build the DataSpec with
  `dataSpec.buildUpon().setPosition(p).setLength(l).build()`, and set the key through `DataSpec.key` via a
  `CacheKeyFactory` that reads `MediaItem.localConfiguration.customCacheKey`.

## 3. Design decisions

| Decision | Rationale |
| --- | --- |
| One process-wide `StreamCache` object owns the only `SimpleCache`, in `File(context.cacheDir, "stream-cache")` | SimpleCache throws on a second instance; `cacheDir` is excluded from backup and the OS may trim it under pressure, which SimpleCache tolerates |
| Never call `SimpleCache.release()` from `PlaybackService.onDestroy` | The service can be recreated in the same process; releasing and reopening races with a recreated service. Process death releases the lock |
| Cache key = `"v1|" + mediaId + "|" + first 16 hex of SHA-256(host + path)` for `https` items only | Keyed by the song so a refreshed signed query string reuses the cache; the path hash keeps two different files (another quality) apart so bytes from two renditions can never mix |
| Evictor: own `ReplayFriendlyLruEvictor` with a mutable ceiling and a 32 MiB budget of protected "heads" (spans starting below 512 KiB) | Lets the setting change without reopening the cache; protects the first ~13 s of recently played songs so a replay starts from disk |
| Resume layer `ResumingDataSource` sits between `CacheDataSource` and the HTTP source | Reopens at `position + bytesRead` after an early end or a read error; the cache then receives contiguous bytes |
| Resume does not retry HTTP 403, 404, 410 | Those mean the signed link is dead; rethrowing keeps the existing `expired` path (`PlaybackService.kt:118-126`) that makes JS fetch a fresh link |
| 3 reopen attempts, pauses 100 ms, 250 ms, 500 ms | Total under 1 s, far inside the 20 s read timeout and the 16 s stall watchdog, so the existing recovery ladder still owns longer outages |
| Ceiling choices 128, 256, 512, 1024, 2048 MB; default 512 MB; no "off" | 512 MB is about 53 songs at 320 kbps x 4 min (9.6 MB each). An "off" switch cannot be applied without rebuilding the player's data source |
| The native side persists the ceiling in `SharedPreferences("stream_cache")` | The service starts before JS; the cache must open with the listener's ceiling |
| `FLAG_IGNORE_CACHE_ON_ERROR` set | A corrupt cache file must fall back to the network, never stop playback |

Rejected alternatives: OkHttp data source (new native dependency, APK size; `apps/mobile/CLAUDE.md` APK size rule);
Echo's two stacked caches (download cache + player cache; Allegra downloads are files, not cache spans);
caching `file://`/`content://` (already local; `DefaultDataSource` routes them to file/content sources, never to the
base HTTP factory); a JS-side cache (cannot see ExoPlayer's byte ranges).

## 4. Exact change list

All Kotlin paths are under `apps/mobile/android/app/src/main/java/com/lyricflow/app/`.

### 4.1 Create `playback/StreamCacheKey.kt` (pure, JVM-testable)

```kotlin
package com.lyricflow.app.playback

import java.net.URI
import java.security.MessageDigest

/** The cache key for one song's bytes, or null when the address is not cached (anything but https). */
object StreamCacheKey {
    const val VERSION = "v1"

    fun of(mediaId: String, uri: String): String? {
        if (mediaId.isBlank()) return null
        val parsed = try { URI(uri) } catch (_: Exception) { return null }
        if (!parsed.scheme.equals("https", ignoreCase = true)) return null
        val host = parsed.host?.lowercase() ?: return null
        val path = parsed.rawPath ?: ""
        val digest = MessageDigest.getInstance("SHA-256").digest((host + path).toByteArray(Charsets.UTF_8))
        val hex = digest.joinToString("") { "%02x".format(it) }.substring(0, 16)
        return "$VERSION|$mediaId|$hex"
    }
}
```

Worked example: `of("stream:saavn:AbC1", "https://aac.saavncdn.com/123/abc_320.mp4?Expires=1&Signature=x")`
hashes `"aac.saavncdn.com/123/abc_320.mp4"`; the same call with `?Expires=2&Signature=y` returns the identical key.
`of("stream:saavn:AbC1", "file:///music/a.mp3")` returns null.

### 4.2 Create `playback/CacheBudget.kt` (pure eviction arithmetic, JVM-testable)

Holds no Media3 types so it can be tested without a `Cache`.

```kotlin
package com.lyricflow.app.playback

/** A cached span as the budget sees it. [id] is any stable identity the adapter maps back to a CacheSpan. */
data class SpanInfo(val id: Any, val position: Long, val length: Long, val lastTouch: Long)

class CacheBudget(
    @Volatile var maxBytes: Long,
    private val headBytes: Long = HEAD_BYTES,
    private val headBudgetBytes: Long = HEAD_BUDGET_BYTES,
) {
    // Ordered by (lastTouch, position, id.hashCode) ascending; ties broken deterministically.
    private val ordinary = java.util.TreeSet<SpanInfo>(ORDER)
    private val heads = java.util.TreeSet<SpanInfo>(ORDER)
    private var headSize = 0L
    var totalSize = 0L
        private set

    fun added(span: SpanInfo) {
        if (span.position < headBytes && headSize + span.length <= headBudgetBytes) {
            heads.add(span); headSize += span.length
        } else ordinary.add(span)
        totalSize += span.length
    }

    fun removed(span: SpanInfo) {
        if (heads.remove(span)) headSize -= span.length else ordinary.remove(span)
        totalSize -= span.length
    }

    /** Spans to evict, oldest first, so that totalSize + required <= maxBytes. Does not mutate state. */
    fun victims(requiredBytes: Long): List<SpanInfo> { /* see pseudocode */ }

    companion object {
        const val HEAD_BYTES = 512L * 1024          // ~13 s at 320 kbps
        const val HEAD_BUDGET_BYTES = 32L * 1024 * 1024
        val ORDER = compareBy<SpanInfo>({ it.lastTouch }, { it.position }, { System.identityHashCode(it.id) })
    }
}
```

`victims` pseudocode (no mutation; the adapter calls `cache.removeSpan`, which calls back `removed`):

```
need = totalSize + required - maxBytes
if need <= 0: return []
out = []
for span in ordinary (oldest first): if need <= 0 break; out += span; need -= span.length
for span in heads (oldest first):    if need <= 0 break; out += span; need -= span.length
return out
```

Worked example (max 1000, head budget 300, headBytes 100):
add A(pos 0, len 200, t1) -> head; add B(pos 500, len 400, t2) -> ordinary; add C(pos 0, len 200, t3) -> head budget
200+200 > 300 so ordinary; total 800. `victims(500)`: need = 800+500-1000 = 300 -> ordinary oldest B(400) -> need -100
-> returns [B]. `victims(900)`: need 700 -> B(400) need 300 -> C(200) need 100 -> A(200) need -100 -> [B, C, A].

### 4.3 Create `playback/ReplayFriendlyLruEvictor.kt` (Media3 adapter)

```kotlin
@androidx.media3.common.util.UnstableApi
class ReplayFriendlyLruEvictor(initialMaxBytes: Long) : androidx.media3.datasource.cache.CacheEvictor {
    private val budget = CacheBudget(initialMaxBytes)
    private val byKey = HashMap<CacheSpan, SpanInfo>()   // CacheSpan identity -> SpanInfo

    var maxBytes: Long
        get() = budget.maxBytes
        set(value) { budget.maxBytes = value }

    override fun requiresCacheSpanTouches() = true
    override fun onCacheInitialized() = Unit
    override fun onStartFile(cache: Cache, key: String, position: Long, length: Long) {
        if (length != C.LENGTH_UNSET.toLong()) evict(cache, length)
    }
    override fun onSpanAdded(cache: Cache, span: CacheSpan) {
        val info = SpanInfo(span, span.position, span.length, span.lastTouchTimestamp)
        byKey[span] = info; budget.added(info); evict(cache, 0)
    }
    override fun onSpanRemoved(cache: Cache, span: CacheSpan) {
        byKey.remove(span)?.let(budget::removed)
    }
    override fun onSpanTouched(cache: Cache, oldSpan: CacheSpan, newSpan: CacheSpan) {
        onSpanRemoved(cache, oldSpan); onSpanAdded(cache, newSpan)
    }
    /** Apply a lowered ceiling now. Call on a background thread. */
    fun trim(cache: Cache) = evict(cache, 0)

    private fun evict(cache: Cache, required: Long) {
        for (victim in budget.victims(required)) cache.removeSpan(victim.id as CacheSpan)
    }
}
```

Threading: SimpleCache calls evictor methods while holding its own lock; `trim` must be called from a background
thread (it takes the cache lock through `removeSpan`).

### 4.4 Create `playback/StreamCache.kt`

```kotlin
@UnstableApi
object StreamCache {
    const val DIR_NAME = "stream-cache"
    const val PREFS = "stream_cache"
    const val KEY_LIMIT_MB = "limit_mb"
    const val DEFAULT_LIMIT_MB = 512
    val ALLOWED_LIMITS_MB = intArrayOf(128, 256, 512, 1024, 2048)

    @Volatile private var cache: SimpleCache? = null
    @Volatile private var evictor: ReplayFriendlyLruEvictor? = null

    @Synchronized fun get(context: Context): SimpleCache  // opens once with limitMb(context)
    fun limitMb(context: Context): Int                      // prefs value if in ALLOWED_LIMITS_MB else DEFAULT_LIMIT_MB
    /** Persists, applies the ceiling, trims on the calling thread. Returns the value applied. Call off the main thread. */
    fun setLimitMb(context: Context, mb: Int): Int
    fun usedBytes(): Long = cache?.cacheSpace ?: 0L
    /** Removes every cached song except [keepKey] (the one playing). Call off the main thread. */
    fun clear(keepKey: String?)
}
```

`setLimitMb` clamps an unknown value to the nearest allowed value below it (minimum 128).
`get` builds `SimpleCache(File(context.applicationContext.cacheDir, DIR_NAME), evictor, StandaloneDatabaseProvider(context.applicationContext))`.

### 4.5 Create `playback/ResumingDataSource.kt`

```kotlin
@UnstableApi
class ResumingDataSource(
    private val upstream: DataSource,
    private val pausesMs: LongArray = longArrayOf(100, 250, 500),
    private val sleeper: (Long) -> Unit = { Thread.sleep(it) },
) : DataSource {
    private var spec: DataSpec? = null
    private var expected: Long = C.LENGTH_UNSET.toLong()   // bytes this open promised, or unset
    private var delivered = 0L

    override fun addTransferListener(listener: TransferListener) = upstream.addTransferListener(listener)
    override fun open(dataSpec: DataSpec): Long {
        spec = dataSpec; delivered = 0
        expected = upstream.open(dataSpec)                 // resolved length, may be LENGTH_UNSET
        return expected
    }
    override fun read(buffer: ByteArray, offset: Int, length: Int): Int  // pseudocode below
    override fun getUri(): Uri? = upstream.uri
    override fun getResponseHeaders(): Map<String, List<String>> = upstream.responseHeaders
    override fun close() = upstream.close()

    class Factory(private val upstream: DataSource.Factory) : DataSource.Factory {
        override fun createDataSource(): DataSource = ResumingDataSource(upstream.createDataSource())
    }
}
```

`read` pseudocode:

```
if length == 0: return 0
if expected != UNSET and delivered >= expected: return END_OF_INPUT
attempt = 0
loop:
  result = try upstream.read(buffer, offset, length)
           catch InterruptedIOException: rethrow
           catch IOException e: failure = e; result = FAILED
  if result > 0: delivered += result; return result
  if result == END_OF_INPUT and (expected == UNSET or delivered >= expected): return END_OF_INPUT  // genuine end
  // early end (fewer bytes than promised) or a read failure
  if attempt == pausesMs.size: if failure != null throw failure else throw EOFException("ended at $delivered of $expected")
  sleeper(pausesMs[attempt]); attempt++
  try upstream.close() catch ignored
  remainingSpec = spec.subrange(delivered)              // position + delivered, length - delivered (unset stays unset)
  try:
     upstream.open(remainingSpec)
  catch InvalidResponseCodeException e where e.responseCode == 416: return END_OF_INPUT
  catch InvalidResponseCodeException e where e.responseCode in {403, 404, 410}: throw e   // dead link: JS refreshes it
  catch DataSourceException e where e.reason == PlaybackException.ERROR_CODE_IO_READ_POSITION_OUT_OF_RANGE: return END_OF_INPUT
  catch InterruptedIOException: rethrow
  catch IOException e: failure = e; continue loop
```

Range arithmetic, worked example: ExoPlayer opens `position=1_048_576, length=UNSET`; the server answers
206 `Content-Range: bytes 1048576-9599999/9600000`, so `open` returns 8_551_424. After 3_000_000 bytes the socket
returns -1. `delivered=3_000_000 < expected` -> reopen `subrange(3_000_000)` = position 4_048_576, length 5_551_424
-> HTTP `Range: bytes=4048576-9599999` (DefaultHttpDataSource builds it from position and length).
Off-by-one check: last byte index = position + length - 1 = 4_048_576 + 5_551_424 - 1 = 9_599_999.

### 4.6 Modify `services/PlaybackService.kt:272-282`

Replace the data source factory with:

```kotlin
val http = DefaultHttpDataSource.Factory()
    .setAllowCrossProtocolRedirects(true)
    .setConnectTimeoutMs(15_000)
    .setReadTimeoutMs(20_000)
val network = CacheDataSource.Factory()
    .setCache(StreamCache.get(this))
    .setUpstreamDataSourceFactory(ResumingDataSource.Factory(http))
    .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)
// ...
.setMediaSourceFactory(DefaultMediaSourceFactory(DefaultDataSource.Factory(this, network)))
```

Do not touch the load control, wake mode, recovery listener, watchdog or `ResumeOnline` code. Add the
`@OptIn(UnstableApi::class)` annotation the file needs (Media3 cache classes are `@UnstableApi`).

### 4.7 Modify `playback/QueueEngine.kt:67-79` (`mediaItemOf`)

Add `.apply { StreamCacheKey.of(spec.id, spec.uri)?.let { setCustomCacheKey(it) } }` to the builder. Nothing else.
`specOf` (line 81) does not need to read it back (the key is derived from id and uri).

### 4.8 Modify `modules/MainPlayerModule.kt` (next to `setRepeatOne`, line 185)

```kotlin
AsyncFunction("setStreamCacheLimitMb") { mb: Int -> StreamCache.setLimitMb(appContext.reactContext!!, mb) }
AsyncFunction("getStreamCacheInfo") { mapOf("usedBytes" to StreamCache.usedBytes().toDouble(), "limitMb" to StreamCache.limitMb(appContext.reactContext!!)) }
AsyncFunction("clearStreamCache") { keepKey: String? -> StreamCache.clear(keepKey); true }
```

If `reactContext` is null return the defaults (`limitMb` = 512, `usedBytes` = 0) instead of throwing.
Expo `AsyncFunction` bodies run off the main thread by default; keep them off it (disk I/O).

### 4.9 JS side

- `apps/mobile/src/services/NativeAudioPlayer.ts`: add optional members to the module type (line ~41 interface) and
  wrappers `setStreamCacheLimitMb(mb: number): Promise<number>`, `getStreamCacheInfo(): Promise<{ usedBytes: number; limitMb: number }>`,
  `clearStreamCache(keepKey: string | null): Promise<boolean>`, each returning a safe default when unavailable
  (same pattern as `setRepeatOne`, line 309-311).
- `apps/mobile/src/playback/streamCacheKey.ts` (create): `streamCacheKeyFor(id: string, uri: string): string | null`
  computing the same key with `sha256Hex` from `@shared/sha256` (`packages/shared/sha256.ts`, exported, synchronous),
  used only to pass `keepKey` when clearing. Parse with `new URL(uri)`; key = `v1|${id}|${sha256Hex(host + pathname).slice(0, 16)}`
  where `host` is lower-cased and `pathname` is the raw (still percent-encoded) path, matching Kotlin's `URI.rawPath`.
- `apps/mobile/src/store/settingsStore.ts`: add `streamCacheLimitMb: '128' | '256' | '512' | '1024' | '2048'`, default
  `'512'`, setter `setStreamCacheLimitMb`. Read lines 296-430 first: if the persist config has no custom `merge`, the
  default shallow merge fills the new key and no `version` bump is needed; if it has one, bump `version` 7 -> 8 and
  default the key in `migrate`.
- `apps/mobile/src/screens/SettingsScreen.tsx`, Playback section (the section holding "Keep playing similar songs"):
  `Kit.Choice` label "Song cache", hint "Songs you stream are kept on this phone so they replay without data.",
  options 128 MB / 256 MB / 512 MB / 1 GB / 2 GB; and `Kit.Action` label "Clear song cache", value "<used> MB used",
  calling `clearStreamCache`. Use only `src/ui` / `SettingsKit` parts (`apps/mobile/CLAUDE.md` rules; `designGuards.test.ts`).
- Boot: add `runWhenIdle('stream-cache-limit', () => NativeAudioPlayer.setStreamCacheLimitMb(Number(limit)))` through
  `apps/mobile/src/services/bootPhases.ts` (phase two, where the other idle jobs are registered), so a setting saved by an
  older build reaches native. Add a case to `apps/mobile/src/services/bootPhases.test.ts` if that file asserts the job list.

### 4.10 Version

`apps/mobile/app.json` `expo.version` 1.60.0 -> 1.61.0 (or the next minor after whatever main holds).

## 5. Implementation order

1. Compile spike: add only `StreamCacheKey.kt` and `StreamCache.kt` and reference `setCustomCacheKey` and
   `DataSpec.subrange` in a scratch line. Verify: `cd apps/mobile/android && ./gradlew :app:compileDebugKotlin`.
   Remove the scratch line.
2. `StreamCacheKey.kt` + `StreamCacheKeyTest.kt`. Verify: `./gradlew :app:testDebugUnitTest --tests "*StreamCacheKeyTest"`.
3. `CacheBudget.kt` + `CacheBudgetTest.kt`. Verify the same way.
4. `ReplayFriendlyLruEvictor.kt`, `StreamCache.kt`. Verify compile.
5. `ResumingDataSource.kt` + `ResumingDataSourceTest.kt` (Robolectric). Verify tests.
6. Wire `PlaybackService.kt` and `QueueEngine.kt`. Verify `./gradlew :app:testDebugUnitTest` (all Kotlin tests).
7. Module functions, JS wrappers, settings, boot job. Verify `npm run mobile:check` (after `npm run convex:test` has finished, never overlapping).
8. Bump `expo.version`. Verify `npm run infra:test` (release notes test) and the root gates.
9. Open the PR; CI builds the APK and runs `launch-check` and the player probe (`.github/scripts/mobile-player-probe.sh`).
10. Physical phone checks (section 9) and record them in `.planning/mobile-ui-review/IMPLEMENTATION-STATUS.md`.

## 6. Edge cases and failure modes

| Input / state | Required behaviour |
| --- | --- |
| Link expired mid-song (403 on reopen) | `ResumingDataSource` rethrows; `PlaybackService` emits `expired`; JS fetches a fresh link; `loadItem` swaps the URI; same cache key (path unchanged) so cached bytes are reused |
| Refreshed link points at another file (different path) | Different key; old bytes stay until evicted; no mixing |
| Server ignores Range and answers 200 on reopen | `DefaultHttpDataSource` skips to the position itself (its `bytesToSkip`); bytes stay correct |
| 416 on reopen (we were at the end) | `END_OF_INPUT`, the item ends normally |
| Chunked response, no Content-Length | `expected` unset; an early -1 is indistinguishable from the end and is accepted; P1-2 (cutoff guard) covers this case |
| Listener seeks during a reopen pause | ExoPlayer cancels the load: the loader thread is interrupted; `Thread.sleep` throws `InterruptedException` -> wrap and rethrow as `InterruptedIOException`, never swallow |
| Track skipped while downloading | Loader cancelled, partial span stays cached (valid bytes) |
| Ceiling lowered from 2 GB to 128 MB | `setLimitMb` trims at once on a background thread |
| Clear while a song plays | `clear(keepKey)` removes all other keys; the playing song continues |
| Disk full | SimpleCache write fails; `FLAG_IGNORE_CACHE_ON_ERROR` makes reads bypass the cache; playback continues |
| OS deletes `cacheDir` files | SimpleCache drops the stale span on next read and refetches |
| `file://` or `content://` item | No key, `DefaultDataSource` never routes it to the cache stack |
| Account erase / sign-out | Cache is not account data; no change (open question 3) |
| Offline replay of a fully cached song | Plays from disk; `WAKE_MODE_NETWORK` still held for https items (acceptable, unchanged) |
| Two players in one process (Luvs) | Luvs does not use `StreamCache`; only `PlaybackService` does |

## 7. Test plan

Kotlin JVM tests under `apps/mobile/android/app/src/test/java/com/lyricflow/app/playback/`:

- `StreamCacheKeyTest.kt`
  - `same path different query gives the same key`
  - `different path gives a different key`
  - `file and content uris are not cached` (returns null)
  - `blank media id is not cached`
  - `key has version prefix and 16 hex chars` (regex `^v1\|.+\|[0-9a-f]{16}$`)
- `CacheBudgetTest.kt`
  - `no victims while under the ceiling`
  - `evicts ordinary spans oldest first` (worked example 4.2, `victims(500) == [B]`)
  - `releases protected heads only after ordinary spans` (`victims(900) == [B, C, A]`)
  - `head budget caps protection` (C goes to ordinary when budget exceeded)
  - `lowering maxBytes produces victims without new spans`
- `ResumingDataSourceTest.kt` (`@RunWith(RobolectricTestRunner::class)`; a hand-written `FakeUpstream : DataSource` that
  serves a byte array, records every `DataSpec` it was opened with, and can be scripted to end early, throw `IOException`,
  or throw `InvalidResponseCodeException(403/416)`; `sleeper` injected as a list recorder)
  - `full body passes through untouched`
  - `early end reopens at position plus bytes delivered` (assert second DataSpec position = first.position + delivered,
    length = expected - delivered, and the concatenated bytes equal the source)
  - `read failure reopens and continues`
  - `gives up after three reopen attempts and rethrows`
  - `403 on reopen is rethrown, not retried`
  - `416 on reopen is a clean end`
  - `unknown length early end is accepted as the end`
  - `pauses are 100, 250, 500 ms`
- Existing tests that must still pass: `QueueMathTest`, `QueueSnapshotTest`, `QueueStoreTest`, `ResumeOnlineTest`, `MiniSwipeTest`.

JS (jest, `apps/mobile`):
- `src/playback/streamCacheKey.test.ts`: the JS key equals the Kotlin key for the 4.1 example (hard-code the expected
  string computed once from the Kotlin test, both tests assert the same literal).
- `src/media3Version.test.ts` unchanged and passing (no Media3 version change).
- `src/designGuards.test.ts` passing (settings rows built from `SettingsKit`).

Gates: `npm run typecheck`, `npm run lint`, `npm test`, then `npm run mobile:check`, then
`cd apps/mobile/android && ./gradlew :app:testDebugUnitTest`.

## 8. Security, privacy and cost

- No secrets involved. Cached audio is stored in app-private `cacheDir`, not readable by other apps, excluded from backup.
- The cache reveals listening history to anyone with root/device access; "Clear song cache" gives the listener control.
- Data cost goes down; disk use is bounded by the ceiling (default 512 MB). State the ceiling in the setting row.
- No new network calls, no new third parties, no licence change (Media3 is Apache-2.0).

## 9. Rollout and rollback

- No flag: shipped in an APK; rollback = next APK reverting the wiring (cache folder is harmless if unused; optionally
  delete `cacheDir/stream-cache` on start in the rollback build).
- Phone evidence to capture (record in `.planning/mobile-ui-review/IMPLEMENTATION-STATUS.md`):
  1. Play a streamed song to the end, enable airplane mode, replay it: plays fully from disk.
  2. `adb shell run-as com.lyricflow.app du -sh cache/stream-cache` grows and stays under the ceiling after 20+ songs.
  3. Throttle with a hotspot and walk out of range mid-song: playback continues after reconnect from the same second,
     logcat shows no `giving up` line from `LyrFlow`.
  4. Lower the ceiling to 128 MB: the folder shrinks within a few seconds.
  5. Background playback for 30 min with screen off: no stall reports.

## 10. Acceptance checklist

- [ ] Only one `SimpleCache` constructor call exists in the app (`rg "SimpleCache\(" apps/mobile/android`).
- [ ] `ResumingDataSource` never retries 403/404/410 and never swallows interrupts.
- [ ] Cache keys are derived from id + host + path, never from the full signed URL.
- [ ] No change to `ResumeOnline`, the watchdog constants, the retry ladder, or `QueueSnapshot.VERSION`.
- [ ] Media3 stays 1.8.0; `media3Version.test.ts` green.
- [ ] Settings rows use `SettingsKit`; no new colours, sizes or durations in the screen.
- [ ] `expo.version` bumped in the same PR.
- [ ] Phone evidence recorded; CI emulator results are not presented as device evidence.

Common mistakes to avoid here: releasing the cache in `onDestroy`; using the full URL as the key (signed query
changes every refresh, caching becomes useless); catching `InterruptedIOException`; adding OkHttp; touching
`ExpoModulesPackageList.kt` (no new Expo module is added); forgetting `@OptIn(UnstableApi::class)`.

## 11. Open questions (with defaults)

1. Default ceiling 512 MB or 256 MB on low-end phones? Default: 512 MB everywhere; `performanceTier` low devices start at 256 MB (read `utils/performanceTier.ts` at boot and only when no value was ever saved).
2. Should downloads reuse cached bytes? Default: no (downloads run in WorkManager with their own files).
3. Clear the cache on sign-out or account erase? Default: no; the cache is device data, not account data. Mention it in the privacy page's device-storage paragraph.
4. Protect heads at all? Default: yes with the 32 MiB budget; drop it if `CacheBudgetTest` shows complexity bugs.
