# P1-2 Premature-end guard (Android) and mid-song recovery (web)

Draft id: P1-3. Priority: P1. Two PRs, two branches:
`fix/android-cutoff-guard` (mobile, version bump: yes, patch) and `fix/web-midsong-recovery` (web only, no bump).
Ships after P1-1 on Android (P1-1 removes most early ends at the byte level; this guard is the second line).

## 1. Goal and user-visible outcome

A song never "finishes" or gets skipped because its audio stream stopped early. On Android, if the player reaches
the end of a track more than 3 seconds before the catalog says it should end, it goes back to where it stopped and
carries on, at most twice per track. On the web, a network error in the middle of a song (today: "This track could
not be loaded. Try another song." and playback stops, or the queue skips) reloads the same song and resumes at the
same second, at most twice per song; a premature `ended` event gets the same treatment.

Non-goals: changing auto-advance rules, repeat or shuffle; recovering decode errors; recovering a song that never
started (position under 1 s is the existing load-failure path); changing Connect/LuvLink routing; iOS (expo-audio path).

## 2. Evidence

Current state:

| Fact | Where |
| --- | --- |
| Android auto-advance is ExoPlayer's playlist; an early end of item N silently becomes a `MEDIA_ITEM_TRANSITION_REASON_AUTO` to N+1, reported to JS as `"auto"` | `apps/mobile/android/app/src/main/java/com/lyricflow/app/playback/QueueEngine.kt:329-341` |
| `STATE_ENDED` (last item, repeat off) is handled by `QueueMath.endAction` | `QueueEngine.kt:343-359` |
| Queue items carry no duration (`id, uri, title, artist, album, artworkUri`) | `apps/mobile/android/app/src/main/java/com/lyricflow/app/playback/QueueItemSpec.kt:7-14` |
| The saved queue decodes a fixed key list; version 1 | `apps/mobile/android/app/src/main/java/com/lyricflow/app/playback/QueueSnapshot.kt:30-60` |
| JS builds the native item map | `apps/mobile/src/playback/nativeQueue.ts:28-35` and `:230-237` |
| Media3 1.8.0 `DefaultHttpDataSource` returns end-of-input on an early socket close (silent truncation) | see P1-1 section 2 |
| Web `ended` always advances; `error` either advances (automatic recovery cursor) or shows the error and stops | `apps/web/src/hooks/useAudioPlayer.ts:568-587` |
| Web already has a "near end" advance at 0.35 s before `audio.duration` | `useAudioPlayer.ts:533-535` |
| Web pattern for reloading a source and resuming (generation counter, `waitForSourceReady`, superseded check, intent re-read) | `useAudioPlayer.ts:391-444`, `:753-768` |
| Web pure rules live in `apps/web/src/lib/audioPlayerRules.ts` with tests in `audioPlayerRules.test.ts`; only `src/lib/*.test.ts` run | `apps/web/package.json` test script |
| Mobile JS recovery (`expired`/`stall`/`network`) is a separate, already-capped path (2 per song per 60 s) | `apps/mobile/src/playback/recovery.ts:33-54` |

Behavioural reference: `Echo-Music/playback/src/main/kotlin/echo/music/iad1tya/playback/PlaybackCutoffGuard.kt`
(3 s threshold, 2 recoveries per track, reset on track change, trusts the decoder's duration first and the catalog
duration second) and its use at `Echo-Music/app/src/main/kotlin/com/music/echo/playback/MusicService.kt:2583-2615`
(checked only on `STATE_ENDED`; Allegra must also check playlist auto-transitions, which Echo's single-item use does not need).

External facts (accessed 2026-11-13):
- `MediaError` codes: 1 aborted, 2 network, 3 decode, 4 source not supported. https://html.spec.whatwg.org/multipage/media.html#error-codes
- Chrome's media loader already retries failed and short loads with a new `Range` request (`kMaxRetries` with a 250 ms
  base delay, total about 29 s) before surfacing `MEDIA_ERR_NETWORK`.
  https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/platform/media/resource_multi_buffer_data_provider.cc
  So a web `error` with code 2 means the browser already gave up; reloading is the right next step.
- Media3 `Player.Listener.onPositionDiscontinuity(oldPosition, newPosition, reason)` with
  `DISCONTINUITY_REASON_AUTO_TRANSITION` reports the outgoing item's last position (`PositionInfo.positionMs`,
  `mediaItemIndex`, `mediaItem`). https://developer.android.com/reference/androidx/media3/common/Player.Listener
  UNVERIFIED for exact delivery order relative to `onMediaItemTransition` in 1.8.0; the design does not depend on it
  (see 3, "suppress reports by pending marker").

## 3. Design decisions

| Decision | Rationale |
| --- | --- |
| Threshold 3 s, max 2 recoveries per track, reset when a different track starts (both platforms, same constants) | Echo's tested values; small enough to not fight real "radio edit" mismatches, large enough to ignore rounding |
| Trust the container duration first: if the decoder knows the duration and the position is within 3 s of it, the end is genuine | A catalog duration can be wrong (edit vs album version); the container cannot lie about its own end |
| Fall back to the catalog duration (seconds, from the queue item) only when the container duration is unknown or the position is far from it | A truncated MP4 still reports its full duration from the `moov` box, so the container check alone already catches most cuts |
| Android: catalog duration travels as `durationSec` (string in the map, `Int` in Kotlin) inside `MediaMetadata.extras` | Additive; no snapshot version bump (absent key decodes as 0 = unknown) |
| Android hook: `onPositionDiscontinuity(AUTO_TRANSITION)` for items with a successor, `onPlaybackStateChanged(STATE_ENDED)` for the last item | Covers both ways a cut-short track ends inside a playlist |
| Android recovery: `player.seekTo(oldIndex, positionMs)` keeping `playWhenReady`; the engine suppresses the `"auto"` report for the transition it is undoing and the `"seek"` report that returns to the same id | JS must not see a phantom track change (listen tracker, lyrics, history would all react) |
| The guard lives inside `QueueEngine` (which owns transitions), with the decision logic in a pure `CutoffGuard` | One owner of transitions; pure logic is JVM-testable |
| Web: pure verdict functions in `audioPlayerRules.ts`; the hook keeps a per-song counter in a ref and reloads via the same generation pattern as `swapAudioSource` | Testable rules; respects the one-funnel and no-`isPlaying`-deps invariants |
| Web recovers only `MEDIA_ERR_NETWORK` (2) with position >= 1 s; decode and not-supported errors keep today's behaviour | A decode error will fail again; a start failure is a load problem handled by the existing cursor |

Rejected: restarting the song from 0 (loses place); retrying forever (a dead stream would loop); Echo's
"pause instead of advance" when duration is unknown (Allegra keeps advancing as today).

## 4. Exact change list

### 4.1 Create `apps/mobile/android/app/src/main/java/com/lyricflow/app/playback/CutoffGuard.kt`

```kotlin
package com.lyricflow.app.playback

/** Decides whether a track that just ended really ended. Pure: no Media3 types. Main thread only. */
class CutoffGuard(
    private val thresholdMs: Long = THRESHOLD_MS,
    private val maxRecoveries: Int = MAX_RECOVERIES,
) {
    sealed interface Verdict {
        data object Accept : Verdict
        data class Resume(val positionMs: Long, val attempt: Int) : Verdict
    }

    private var trackId: String? = null
    private var used = 0

    /** A different track is now the one we judge. Same id again (repeat-one restart) keeps the count. */
    fun onTrack(mediaId: String?) { if (mediaId != trackId) { trackId = mediaId; used = 0 } }

    /**
     * [containerDurationMs] is the decoder's duration (<= 0 or C.TIME_UNSET when unknown, pass -1 for unknown);
     * [catalogDurationSec] is the catalog's, 0 when unknown.
     */
    fun judge(mediaId: String, positionMs: Long, containerDurationMs: Long, catalogDurationSec: Int): Verdict {
        onTrack(mediaId)
        val position = positionMs.coerceAtLeast(0)
        if (position < MIN_POSITION_MS) return Verdict.Accept
        if (containerDurationMs > 0 && containerDurationMs - position <= thresholdMs) return Verdict.Accept
        val expectedMs = when {
            containerDurationMs > 0 -> containerDurationMs
            catalogDurationSec > 0 -> catalogDurationSec * 1000L
            else -> return Verdict.Accept
        }
        if (expectedMs - position <= thresholdMs || used >= maxRecoveries) return Verdict.Accept
        used += 1
        return Verdict.Resume(position, used)
    }

    companion object {
        const val THRESHOLD_MS = 3_000L
        const val MAX_RECOVERIES = 2
        const val MIN_POSITION_MS = 1_000L
    }
}
```

Note on units: `catalogDurationSec` is seconds (Allegra rule); it is converted to milliseconds only inside `judge`.

Worked examples (catalog 245 s):
- container 245_000, position 120_500 -> container gap 124_500 > 3_000 -> expected 245_000 -> gap 124_500 -> `Resume(120_500, 1)`.
- container 245_000, position 243_100 -> container gap 1_900 <= 3_000 -> `Accept`.
- container unknown (-1), catalog 245, position 120_500 -> expected 245_000 -> `Resume`.
- container unknown, catalog 0 -> `Accept`.
- third cut of the same track -> `Accept` (used == 2).
- container 200_000 (radio edit), catalog 245, position 199_000 -> container gap 1_000 -> `Accept` (catalog ignored).

### 4.2 Modify `playback/QueueItemSpec.kt`

Add `val durationSec: Int = 0` as the last constructor field; in `fromMap` read
`map["durationSec"]?.toIntOrNull()?.coerceIn(0, 86_400) ?: 0`; in `toMap` add `"durationSec" to durationSec.toString()`.

### 4.3 Modify `playback/QueueSnapshot.kt` decode map (around line 52-60)

Add `"durationSec" to item.optString("durationSec")` to the map passed to `QueueItemSpec.fromMap`. Keep `VERSION = 1`.

### 4.4 Modify `playback/QueueEngine.kt`

- `mediaItemOf` (line 67): add `.setExtras(android.os.Bundle().apply { putInt(EXTRA_DURATION_SEC, spec.durationSec) })`
  to the `MediaMetadata.Builder`. `specOf` (line 81): read `durationSec = item.mediaMetadata.extras?.getInt(EXTRA_DURATION_SEC) ?: 0`.
  `private const val EXTRA_DURATION_SEC = "durationSec"` at file top.
- New fields: `private val cutoff = CutoffGuard()`, `private var undoing: Pending? = null` where
  `private data class Pending(val mediaId: String, val index: Int)`.
- New `override fun onPositionDiscontinuity(old: Player.PositionInfo, new: Player.PositionInfo, reason: Int)`:

```
if reason != Player.DISCONTINUITY_REASON_AUTO_TRANSITION: return
val item = old.mediaItem ?: return
val id = item.mediaId
val index = old.mediaItemIndex
val container = windowDurationMs(index)            // timeline window duration or -1 if TIME_UNSET / index invalid
val catalog = item.mediaMetadata.extras?.getInt(EXTRA_DURATION_SEC) ?: 0
when (val v = cutoff.judge(id, old.positionMs, container, catalog)):
  is Resume -> { undoing = Pending(id, index); Log.w(TAG, "cutoff id=... at=${v.positionMs}ms attempt=${v.attempt}"); player.seekTo(index, v.positionMs) }
  Accept -> Unit
```

- `onMediaItemTransition` (line 329): before emitting, consult `undoing`:

```
val pending = undoing
if pending != null:
  if reason == AUTO and id != pending.mediaId: queueChanged(); scheduleSave(); return      // the transition being undone
  if id == pending.mediaId: undoing = null; queueChanged(); scheduleSave(); return          // the seek back
  undoing = null                                                                           // anything else: a real change
cutoff.onTrack(id)                                                                         // real new track
... existing emit ...
```

- `onPlaybackStateChanged` (line 343): before `QueueMath.endAction`, when `STATE_ENDED`:

```
val item = player.currentMediaItem
if item != null:
  v = cutoff.judge(item.mediaId, player.currentPosition, durationOrUnknown(player.duration), catalogOf(item))
  if v is Resume: player.seekTo(player.currentMediaItemIndex, v.positionMs); player.prepare(); scheduleSave(); return
... existing endAction ...
```

  (`player.prepare()` is a no-op unless idle; seeking from ENDED goes back to BUFFERING with `playWhenReady` unchanged.)

### 4.5 JS: `apps/mobile/src/playback/nativeQueue.ts`

In both map builders (lines ~28-35 and ~230-237) add `durationSec: String(Math.max(0, Math.round(song.duration || 0)))`.
`Song.duration` is seconds (`apps/mobile/src/services/stream/streamSong.ts:35`).

### 4.6 Web: `apps/web/src/lib/audioPlayerRules.ts` (append)

```ts
/** Seconds a song may end short of its length before the end counts as a cut. */
export const CUTOFF_THRESHOLD_SECONDS = 3;
/** Reloads allowed per song for a cut or a mid-song network error. */
export const MAX_MIDSONG_RECOVERIES = 2;
/** Below this position a failure is a load failure, handled by the existing recovery cursor. */
export const MIN_RECOVERY_POSITION_SECONDS = 1;

export interface EndCheck {
  readonly positionSec: number;
  /** `audio.duration` when finite, else NaN. */
  readonly elementDurationSec: number;
  /** The catalog duration (UnifiedSong.duration), 0 when unknown. */
  readonly catalogDurationSec: number;
  readonly recoveriesUsed: number;
}

export function endVerdict(check: EndCheck): 'accept' | 'resume' { /* same algorithm as CutoffGuard.judge, in seconds */ }

export function errorVerdict(input: { readonly mediaErrorCode: number | null; readonly positionSec: number; readonly recoveriesUsed: number }): 'resume' | 'fail' {
  return input.mediaErrorCode === 2 && input.positionSec >= MIN_RECOVERY_POSITION_SECONDS && input.recoveriesUsed < MAX_MIDSONG_RECOVERIES ? 'resume' : 'fail';
}
```

`endVerdict` pseudocode: `p = max(0, positionSec)`; if `p < 1` accept; if element duration finite and
`elementDurationSec - p <= 3` accept; `expected = finite(element) ? element : catalog`; if `expected <= 0` accept;
if `expected - p <= 3 || recoveriesUsed >= 2` accept; else resume.

### 4.7 Web: `apps/web/src/hooks/useAudioPlayer.ts`

- Add `const midSongRecoveriesRef = useRef<{ songId: string | null; used: number }>({ songId: null, used: 0 });`
  and reset it (`{ songId: playable.id, used: 0 }`) inside `selectSongWithIntent` where a new song is chosen (after line 180).
- Add `recoverInPlace = useCallback(async (resumeAt: number): Promise<boolean> => { ... }, [requestPlayback])`
  modelled on `switchTo` in `swapAudioSource` (lines 402-415): increment `playbackGenerationRef`, `audio.pause()`,
  `setIsBuffering(true)`, `audio.load()` (same `src`), `await waitForSourceReady(audio, SOURCE_SWAP_TIMEOUT_MS)`, return
  false if the generation or song changed; then `audio.currentTime = resumeAt; setCurrentTime(resumeAt)`;
  `setIsBuffering(false)`; if `playbackIntentRef.current` then `await requestPlayback(true)`; return the ready flag.
  Set `loadedGenerationRef.current = playbackGenerationRef.current` on ready (as `onLoadedMetadata` does) so
  `sourceIsLoaded()` stays true.
- In `onEnded` (line 568): before `advanceToNext()`, if `sourceIsLoaded()` and the song is current, compute
  `endVerdict({ positionSec: audio.currentTime, elementDurationSec: audio.duration, catalogDurationSec: currentSongRef.current.duration, recoveriesUsed })`;
  on `'resume'` increment `used`, call `void recoverInPlace(position)` and return. Skip the check when
  `repeatRef.current === 'one'`? No: a cut repeat-one song should also resume; keep the check for all modes.
- In `onError` (line 569): before the `automaticRecoveryRef` branch, if `errorVerdict({ mediaErrorCode: audio.error?.code ?? null, positionSec: audio.currentTime, recoveriesUsed })`
  is `'resume'`, increment `used`, call `void recoverInPlace(audio.currentTime)` and return. If `recoverInPlace`
  resolves false (source would not open), fall through to the existing behaviour by calling the old branch code
  (extract it into a local `failCurrent()` closure to avoid duplication).
- The effect's dependency array stays `[advanceToNext]` plus the new stable callbacks; it must not gain `isPlaying`.

## 5. Implementation order

Android PR:
1. `CutoffGuard.kt` + `CutoffGuardTest.kt`. Verify `cd apps/mobile/android && ./gradlew :app:testDebugUnitTest --tests "*CutoffGuardTest"`.
2. `QueueItemSpec` + `QueueSnapshot` field. Extend `QueueSnapshotTest.kt`. Verify the Kotlin suite.
3. `nativeQueue.ts` maps + jest case. Verify `npm run mobile:check`.
4. `QueueEngine` wiring. Verify the Kotlin suite and compile.
5. Bump `apps/mobile/app.json` `expo.version` (patch). Verify `npm run infra:test`.
6. Device check (section 9).

Web PR:
1. Rules + tests. Verify `npm test --workspace apps/web` (or `cd apps/web && npm test`).
2. Hook wiring. Verify `npm run typecheck && npm run lint && npm test`.
3. Browser check on :5173 (section 9). Never test on an :8080 URL (CSP, `CLAUDE.md`).

## 6. Edge cases and failure modes

| Input / state | Required behaviour |
| --- | --- |
| Cut at 120 s, network still down | Android: seek back, buffering; existing network retry ladder / `ResumeOnline` take over. Web: `waitForSourceReady` times out after 15 s -> existing failure path |
| Cut twice, third cut | Accept: advance like today (no loop) |
| Listener skips during a recovery | Android: `undoing` cleared by the non-matching transition. Web: generation changed -> `recoverInPlace` returns false, does nothing |
| Listener pauses during a web reload | Intent re-read after ready: stays paused |
| Repeat-one song cut | Resume; `onTrack` keeps the counter for the same id |
| Catalog duration wrong (album version longer) | Container duration within 3 s -> accept |
| Unknown durations everywhere | Accept (today's behaviour) |
| Seek near the end by the listener, then end | Genuine (position within 3 s of container) |
| Connect/LuvLink remote playback | Unchanged: the guard runs only where audio plays |
| Queue edit that removes the outgoing item during the seek | `seekTo` on a missing index throws `IllegalSeekPositionException`: guard the call with `index < player.mediaItemCount` and fall back to Accept |
| Old saved queue without `durationSec` | Decodes as 0; container duration still protects |

## 7. Test plan

Kotlin (`apps/mobile/android/app/src/test/java/com/lyricflow/app/playback/`):
- `CutoffGuardTest.kt`: one test per worked example in 4.1, plus `counter resets on a new track`, `counter kept for the same track id`, `position under one second is accepted`.
- `QueueSnapshotTest.kt` add: `durationSec round-trips` and `missing durationSec decodes as zero`.

Jest (`apps/mobile`): `src/playback/nativeQueue.test.ts` add `native items carry durationSec in whole seconds` (duration 245.6 -> "246"; undefined -> "0").

Web (`apps/web/src/lib/audioPlayerRules.test.ts`, node:test): `endVerdict` cases mirroring the Kotlin worked examples
(in seconds: 120.5/245/245 -> resume; 243.1/245 -> accept; NaN/245 -> resume; NaN/0 -> accept; used 2 -> accept),
`errorVerdict` cases (code 2 at 30 s -> resume; code 3 -> fail; code 2 at 0.4 s -> fail; used 2 -> fail).

Existing tests that must pass: all of `apps/web/src/lib/*.test.ts`, `QueueMathTest`, `ResumeOnlineTest`, mobile jest suite.
E2E: run `npm run e2e` locally before merging the web PR (memory rule: full local e2e before merging features).

## 8. Security, privacy and cost

No new data or network surfaces. A recovery is at most two extra stream requests per song; the API's song-change
limiter counts distinct songs, not Range requests (`apps/api/src/app.ts:195-197`), so recoveries do not hit it.
Android logs use `Log.w(TAG, ...)` with media id and positions only, no URLs (signed CDN URLs are credentials).

## 9. Rollout and rollback

- Android: shipped in the APK; rollback by reverting the engine hook (the extra field is harmless).
- Web: no flag; rollback by reverting the PR.
- Evidence: Android, serve a truncated file (first 40% of an MP4) from a local HTTPS fixture or force a cut with
  `adb shell svc wifi disable` mid-song after P1-1 (the resume layer may already hide the cut; then confirm the guard
  with logcat `QueueEngine ... cutoff` using a chunked fixture). Web: Chrome DevTools, Network, block the
  `/api/stream` request pattern for 35 s mid-song (Chrome exhausts its own retries), unblock: the song continues at
  the same second, no skip, button stays on Pause.

## 10. Acceptance checklist

- [ ] Same constants on both platforms (3 s, 2, 1 s).
- [ ] No `isPlaying` in any effect dependency array; play goes through `requestPlayback`.
- [ ] JS never sees a phantom `"auto"` advance for an undone cut (verify with the bridge log in a debug build).
- [ ] `durationSec` is whole seconds; nothing in milliseconds crosses the bridge.
- [ ] `QueueSnapshot.VERSION` unchanged.
- [ ] Mobile `expo.version` bumped; web PR has no mobile paths.

Common mistakes: comparing seconds with milliseconds in the guard; recovering decode errors; resetting the counter
on the seek back (the same id must keep its count); putting `isPlaying` in the effect deps.

## 11. Open questions (defaults)

1. Count a cut recovery toward the mobile JS `MAX_AUTO_RESUMES` budget? Default: no, separate budgets (native guard and JS recovery handle different failures).
2. Show a toast "Reconnected"? Default: no UI; it should feel like nothing happened.
3. Web threshold for very short songs (< 10 s)? Default: same rules; `MIN_RECOVERY_POSITION_SECONDS` covers start failures.
