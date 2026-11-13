# Implicit state machines — inventory (2026-11-13)

Prompt (Steve Ruiz, tldraw, X, 2026-10-31): **"find all of the implicit state machines in my app"**.
This is the inventory pass only (states, transitions, illegal combinations, locations). No code changed.

An implicit state machine here = a lifecycle spread across several booleans, refs, optional fields or
timers instead of one `status` value, so illegal combinations are representable and every transition
has to remember to reset every flag.

Ranked by risk (playback first, per the repo's invariants).

---

## 1. Web audio player — `apps/web/src/hooks/useAudioPlayer.ts`

**State today:** `isPlaying` + `isPlayingRef`, `isBuffering`, `playbackIntentRef`, `pendingPlaybackRef`,
`autoAdvancedRef`, `automaticRecoveryRef`, `playbackGenerationRef` / `loadedGenerationRef`,
`sourceOverrideRef`, `pendingCanPlayRef`, `error`.

**The machine they encode:**
`empty → loading(wantsPlay?) → ready-paused ⇄ playing ⇄ buffering → ended → (next | end-of-queue)`,
plus `swapping-source` and `failed`, with "generation" as the cancellation token.

**Findings**
- **`autoAdvancedRef` does three jobs**: "already advanced from this track" (debounce near-end at
  L513), "end of queue reached" (L273, L300) and "stopped" (`stop()`, L352). Only `loadedmetadata`
  (L518), `selectSongWithIntent(manual)` (L154), `skipNext`/`skipPrevious` clear it.
  **Likely bug (found by reading, not reproduced):** after the queue ends with repeat off, seek back
  in the last song and press play, then turn repeat on or add songs (`appendQueue` L210,
  `replaceUpcoming` L240, `cycleRepeat` L449). Nothing clears the latch, so `advanceToNext` returns
  at L257, before it even reaches the repeat-one branch. The song ends and nothing plays next.
  A radio top-up that lands after the end of the queue hits the same path.
- `playbackIntentRef` and `pendingPlaybackRef` are set together at both write sites (L165–166, L182–183).
  `pending` is consumed once on `canplay` (L634); `intent` lives on. That's two flags for "wants to
  play" with different lifetimes, and they're kept in sync only by convention.
- `isBuffering` is written from 12+ places; `buffering && !intent` is reachable only if one path
  forgets to clear it (L569 guards it, other writers don't).

**Shape it would take:** `type Transport = { kind: 'empty' } | { kind: 'loading'; gen; wantsPlay } |
{ kind: 'ready'; gen; wantsPlay; buffering } | { kind: 'ended'; reason: 'track' | 'queue' | 'stopped' }`.
`ended.reason === 'queue'` replaces the latch, and any queue/repeat edit or play press leaves it.

## 2. DJ voice — `apps/web/src/hooks/useDjVoice.ts`

**State today:** 12 boolean `useState`s + `busyRef`, `speakingRef`, `wakeWantedRef`,
`recognitionRef`, `captureRef`, `wakeRecognitionRef`, `wakeAbortRef`, `speakRun`, `localProgress`,
`speechProgress`, `micState`.

**Four machines running at once:**
| Region | States | Flags today |
|---|---|---|
| Ears (one utterance) | idle → listening → transcribing → idle | `listening`, `transcribing`, `busyRef` (L434–475) |
| Wake word | off → armed → hearing → (hand-off to Ears) → armed | `wakeOn`, `wakeWantedRef`, `wakeRecognitionRef`, `wakeAbortRef`, `followUntilRef` (L526–649) |
| Voice (TTS) | quiet → speaking → quiet, run-numbered | `speaking`, `speakingRef`, `speakRun` (L711–760) |
| Model setup ×3 | absent → offered → downloading(%) → ready / failed | `localReady`+`needsLocalDownload`+`localProgress`; `speechReady`+`speechProgress`; `canInstall`+`installing`+`deviceEars` |

**Findings**
- `busyRef` and `listening` are a mirrored pair written at 6 sites; each one has to set both.
- Wake and Ears coordinate through `busyRef` + `stopWake()` + `startWakeRef` in `finally`/`onend`.
  The local wake loop polls `speakingRef || busyRef` every 400 ms (L592) instead of reacting to a transition.
- `browserFailed` is a one-way engine fallback that sits outside `engine`; it's really an engine state.

## 3. Connect session — `packages/connect/src/connectSession.ts`

**State today (L83–130):** ~30 closure `let`s. The command-in-flight lifecycle alone is `pending`,
`pendingCommandId`, `optimistic`, `feedbackTimer`, `retryTimer`, `retryCount`, `intent.feedbackTimedOut`,
`intent.deadlineAt`. Separate regions: device presence (`listening`, `registering`, `fresh`,
`listenRetryCount`), position reporting (`reportInFlight`, `reportQueued`, `reportQueuedSeek`),
handoff (`handoffInFlight`, `handoffCommandId`), inbox (`inboxWorker`, `inboxRetryCount`),
restore (`didRestore`, `restoring`), `startedAway`, `claimInFlight`.

**Command lifecycle actually encoded:** `queued → sending(retry n) → sent(commandId) →
running(began, until deadline) → done | failed | timed-out-but-still-pending`.

**Findings**
- Every exit path clears the same 4–5 variables by hand (L591, L600–601, L615–616, L1074). The
  stale-ownership path clears `feedbackTimer`; the final-failure path clears it; `observeOutcome`
  clears `retryTimer` but leaves `feedbackTimer` to `finishFeedback`. That's correct today, but
  nothing enforces it.
- After a feedback timeout (L514) `pending` stays set until an outcome arrives or the session is
  disposed, so `pump()` (L543) holds the whole queue behind a command the UI has already called
  "Couldn't reach …". That may be intended (ordering), but it's implicit: the state has no name.
- This module is the best tested of the four, so it has the lowest risk of the ones listed here.

## 4. Convex lifecycles encoded as optional fields — `convex/schema.ts`

| Table | Implicit machine | Fields |
|---|---|---|
| `luvLinkRooms` (L~637) | active → handing-off(epoch, deadline) → active / closed | `status`, `closedAtMs?`, `handoffFromUserId?`, `handoffEpoch?`, `handoffDeadlineAtMs?`. A handoff is "the three optionals happen to be set" |
| Connect commands (L~575) | pending → reserved → began → done/failed/expired, plus legacy-vs-V2 | `status`, `reservationToken?`, `beganAt?`, `executeBefore?`, `errorCode?`, `release?` |
| `spotifyPlaylists` (L~621) | idle → leased(token, until) → scanning(offset) → synced | `leaseUntil?`, `leaseToken?`, `offset`, `scanSnapshotId`, `lastSyncedAt?` |
| `luvLinkInvites` | live → revoked / expired | `revokedAtMs?`, `expiresAtMs` |
| `reports` | open → closed | `status` + `closedAt?` (explicit; fine) |

The cheap win is not a schema change. Add one pure `phaseOf(row)` per table and use it in the
mutations, so "is a handoff pending?" has one definition.

## 5. Mobile updater panel — `apps/mobile/src/components/about/UpdatePanel.tsx`

`checking`, `checked`, `build`, `status.kind`, `installing`, `notice` + refs `autoInstall`,
`needsPermission`, `installBusy`, `downloadBusy`, `checkBusy` (L68–80). The header (L186–194) is a
9-branch ternary that *derives* the state on every render: `checking > downloading > ready >
available > current > older > checked-failed > never-checked`. The order of that ternary is the
machine. `autoInstall` + `needsPermission` are two latched intents that survive across app
background/foreground (L111–128).

## 6. Smaller ones (low risk; booleans that should probably be one union)

- `apps/web/src/components/LyricsSyncDialog.tsx` L50–62: `finding`, `pasting`, `saving`, `saved`,
  `pasteOpen` → `finding | choosing | pasting | saving | saved`.
- `apps/web/src/components/LyricsPanel.tsx` L148–168: follow mode `followPaused`/`followPausedRef`,
  `touchingRef`, `isAnimatingRef`, `plainPaused`, `plainNeedsAnchorRef` → `following | user-scrolling |
  settling`; plus 4 mutually exclusive menus (`alternativesOpen`, `sourceInfoOpen`, `moreOpen`,
  `actionsOpen`) that should be one `openMenu` value.
- `apps/web/src/App.tsx` L160–199: `lyricsLoading` + `lyricsAlternativesLoading` + `translating` +
  `showTranslated`; per-section `*Loading` flags; `radioActiveRef` beside `djLive`.
- `apps/web/src/components/PlayerPanel.tsx` L199–237: `lyricsHidden`, `coverHidden`, `mixOpen`, `noteShown`.
- Mobile `PlaylistDetailScreen` (7 flags), `useSongActions` (6), `NowPlayingScreen` / `MiniPlayer` (5 each).
  The audio-load claim (`beginAudioLoad`) is already an explicit, documented module-level lock.

## Already explicit (no action)

`RepeatMode`, `DownloadStatus.kind`, `reports.status`, `luvLinkRooms.status`, `swapAudioSource`'s
`'ready' | 'failed' | 'superseded'`, the Android Kotlin `QueueEngine`, `songsStore.toggleLike`'s result union.

## Suggested order if acting on this

1. Regression test, then fix for the `autoAdvancedRef` end-of-queue latch (§1). It's small and touches playback.
2. Fold `listening`/`transcribing`/`busyRef` into one `ears` union in `useDjVoice` (§2).
3. `phaseOf()` helpers for `luvLinkRooms` handoff and Connect commands (§4).
4. The low-risk UI unions (§6) when those files are next touched anyway.
