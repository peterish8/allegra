# Playback glitches and transition bugs: fix plan

Audit date: 2026-11-11. Branch audited: `feat/stats-playlist-cards` at `fe5df30`, which is the same commit as
`origin/main` (nothing ahead or behind). Scope: the phone app (LuvLyrics 1.45.1, `apps/mobile`) and the website
player (`apps/web`). Focus: next / previous / auto-advance edge cases, song-change animations, gestures, and motion
rules.

Every item below was found by reading the code. None of them has been reproduced on a phone or in a browser
yet. The first step of each fix is to reproduce it (the **Repro** line) and drop the item if it does not happen.

Priorities:

- **P1**: a listener can hit it in normal use, and it does the wrong thing (wrong song, wrong lyrics, lost sync).
- **P2**: a visible glitch (a flash, a jump, an animation going the wrong way) or a broken project rule.
- **P3**: rare, iOS-only (iOS does not ship today), or cleanup.

---

## How a skip works today (for whoever fixes this)

**Android** (the shipped app): the Kotlin `QueueEngine` owns the queue. `playerStore.nextInPlaylist` /
`previousInPlaylist` send the command to the engine, then move the screen at once with `showSkip`
(`apps/mobile/src/store/playerStore.ts:262`). The settled state is read back with `scheduleReconcile`. The screen
predicts what the engine will do. **Most Android glitches below come from that prediction being wrong for a moment,
and the reconcile then snapping the screen back.**

**iOS / tests**: the queue is JavaScript's. `nextInPlaylist` / `previousInPlaylist` change `currentSong`, and
`MiniPlayer` loads the audio when `loadedAudioId !== currentSong.id` (`MiniPlayer.tsx:337`).

**Web**: `useAudioPlayer` owns the queue in refs (`apps/web/src/hooks/useAudioPlayer.ts`). The cover in
`PlayerPanel` slides one way or the other based on `coverIntent` / queue position.

---

## Phase 1: Wrong song, wrong lyrics, lost sync (P1)

### 1.1 Classic bar shows the wrong song's lyrics after a quick next then previous (mobile)

- **Where:** `apps/mobile/src/components/MiniPlayer.tsx:271-293`.
- **What:** with the classic bar open, a song change fades the lyrics out over 300 ms, and the callback sets
  `displayedSong` to the `currentSong` captured when the fade **started**. Skip A to B, then back to A within 300 ms:
  the second change sees `currentSong.id === displayedSong.id` (still A) and does nothing, the first fade finishes
  and sets `displayedSong = B`. The effect never runs again, so B's lyrics stay on screen while A plays.
- **Repro:** classic nav bar, open the bar to half height, tap next then previous quickly.
- **Fix:** do not capture the song in the worklet callback. Keep a ref to the latest `currentSong`, and in the
  fade-out callback set `displayedSong` from that ref. In the "same id" branch, cancel any fade in progress
  (`cancelAnimation(transitionOpacity)`), set `displayedSong = currentSong`, and set the opacity back to 1.
- **Test:** pull the "which song to show after a fade" decision into a pure function and unit-test the
  A → B → A sequence.

### 1.2 Mini player's restart-the-song path skips the one playback funnel and LuvLink (mobile)

- **Where:** `MiniPlayer.tsx:515-533` (`skipBackward`).
- **What:** past 3 s it calls `player.seekTo(0)` and then `playerControls.play()` directly. That breaks playback
  invariant 1 (all play goes through `requestPlayback`). It also skips `handleOwnedLuvLinkSeek` /
  `notifyOwnedLuvLinkUserSeek`, which the Now Playing version calls (`useNowPlayingLogic.ts:164-182`), so a LuvLink
  partner keeps playing at the old position. On Android it also repeats the 3 s rule the engine already applies.
- **Repro:** in a LuvLink session, play past 0:05 and tap previous on the classic mini player. The other phone does
  not restart.
- **Fix:** delete the mini player's own copy. Both mini player and Now Playing call one shared `skipBackward`
  (move it out of `useNowPlayingLogic` into `services/player/` or the store): LuvLink first, then on Android just
  `previousInPlaylist()` (the engine decides), and on iOS seek via `handleScrub` and resume through
  `requestPlayback`.
- **Test:** a jest test asserting that `MiniPlayer` / `PillPlayer` previous goes through the shared function (the
  repo already has `src/connectRouting.test.ts` as a pattern for "every caller must route").

### 1.3 Position and length are not reset when the song changes (mobile)

- **Where:** `positionSV` / `durationSV` are written only by status ticks (`PlayerContext.tsx:119-122`, every
  250 ms while playing) and by seeks. `showSkip`, `adoptPreparedTrack`, `skipToQueueIndex` and `applyNativeQueue`
  change the song without touching them.
- **What:** for up to one tick after a skip, the new song shows the old song's elapsed time and length. Three knock-on
  effects:
  1. The scrubber and the pill's progress ring flash the old position, then jump to 0.
  2. Lyrics can light a line from the middle of the new song for a frame, then glide back to the top.
  3. Previous straight after a skip reads the old position (> 3 s), so `previousWillRestart` and the cover swipe's
     `adjacentSong` (`NowPlayingScreen.tsx:465`) believe "restart" and refuse to go back. Tapping next then
     previous within a quarter of a second restarts the new song instead of returning.
- **Repro:** play a song past 1:00, tap next, watch the scrubber; then tap next and previous quickly.
- **Fix:** one helper in the store, `resetPlayheadFor(song)`: set `positionSV = 0` and `durationSV = song.duration`
  (or 0) unless `isSeeking` is set. Call it wherever `currentSongId` changes: `showSkip`, `adoptPreparedTrack`,
  `skipToQueueIndex`, `applyNativeQueue`, `setPlaylistQueue`. The store must not import the UI position bus (see the
  comment at `playerStore.ts:111`), so register the reset through `playerControls` like `getPosition`.
  A restore after launch (`restoreNativeQueue`) must **not** reset: it resumes where it stopped. Neither must a
  resume via `resumeNextLoadAt`.
- **Test:** store test: after `nextInPlaylist`, `playerControls.getPosition()` returns 0.

### 1.4 Previous near the 3 second mark: the screen moves and snaps back (Android)

- **Where:** `playerStore.ts:799-806`. The screen predicts the engine's rule from `playerControls.getPosition()`,
  which is up to 250 ms old (the native poller rate). The engine decides from `player.currentPosition`.
- **What:** at about 2.8 to 3.0 s, JavaScript predicts "go back" and shows the previous song. The engine sees 3.05 s
  and restarts. The reconcile then snaps the title, cover and backdrop back. The reverse also happens: the screen
  stays while the engine goes back, and the title arrives late.
- **Repro:** tap previous at about 2.9 s into a song, several times.
- **Fix (pick one):**
  - (a) Preferred: have `NativeAudioPlayer.skipToPrevious()` resolve with what the engine did (`'restart' |
    'back'`), the same thing the native skip buttons already report (`adoptNativeSkip(direction, moved)`). Move the
    screen only after the answer. That costs one bridge round trip (a couple of frames). Only do this inside a
    window around the threshold, say 2.5 to 3.5 s, and keep the instant prediction outside it.
  - (b) Cheaper: extrapolate the position (`lastPosition + (now - lastTickAt)` while playing) before predicting.
- **Test:** `QueueMath` stays the rule. Add a JS test for the window logic, and a Kotlin test if the return value
  changes `MainPlayerModule`.

### 1.5 Web: a song that fails to load stops the whole queue

- **Where:** `apps/web/src/hooks/useAudioPlayer.ts:394-406` (`onError`).
- **What:** a dead stream sets the error and stops. During auto-advance through a playlist or radio, one bad track
  ends the session, while the phone recovers by itself (`playback/recovery.ts`).
- **Fix:** if the error came during auto-advance or right after a skip (the listener did not pick this exact song),
  show the error briefly and move on to the next song, at most N in a row (say 3) so a dead network does not spin
  through the queue. If the listener picked the song, keep today's behaviour.
- **Test:** hook test with a fake audio element firing `error` after an auto-advance.

### 1.6 Web: shuffle has no history

- **Where:** `useAudioPlayer.ts:203, 220-222, 603-607` (`pickDistinct`).
- **What:** every shuffled next is a fresh random pick from the whole queue. Songs repeat before the queue is
  used up, and previous walks back by queue index rather than to the song that was actually playing before.
  `upcomingSong` returns null under shuffle, so nothing can show or prepare the next song.
- **Fix:** when shuffle turns on, build a shuffled play order once, with the current song first (the phone engine's
  rule, `QueueMath.shuffledOrder`; the TypeScript copy can live in `packages/connect` next to `withUpcoming`). Next
  and previous walk that order. Appended songs join the end of the order (`QueueMath.orderWithAppended`).
  `upcomingSong` then works under shuffle too.
- **Test:** pure tests for the order: no repeats until exhausted, previous returns the song heard before.

---

## Phase 2: Visible glitches in song-change motion (P2)

### 2.1 Cover swipe at the last song slides the new cover in from the wrong side (Android)

- **Where:** `NowPlayingScreen.tsx:459-468` (`adjacentSong`) and `:573-578`.
- **What:** with repeat off at the last song, `adjacentSong(-1)` returns null (no preview), but `canSwipe(-1)` is
  true and the engine wraps to the first song (`QueueEngine.skipToNext`). With no preview, the fling's end handler
  springs `stageX` from `-windowW` back to 0, so the new cover comes back in from the side the old one left by.
- **Fix:** make `adjacentSong(-1)` agree with the engine: next always wraps when the queue has 2 or more songs
  (`skipToNext` wraps regardless of repeat). Then the preview exists. Also, when no preview is available, start the
  incoming cover from the opposite side (`stageX = -dir * windowW` before springing to 0), never from the same side.

### 2.2 Swiping right past 3 seconds is refused, but the previous button restarts the song (Android)

- **Where:** `NowPlayingScreen.tsx:465` and `canSwipe` at `:540-544`.
- **What:** past 3 s, `adjacentSong(1)` returns null and `canSwipe(1)` is false, so the cover rubber-bands with a
  refusal haptic. The previous button at the same moment restarts the song. Two controls for "previous" disagree.
- **Decide with the owner:** either (a) the swipe restarts the song like the button (spring the cover back and show
  the seek ripple at 0), or (b) the swipe always goes to the previous song (YouTube Music's behaviour: the swipe is
  "the other song", the button is "previous"). (b) needs a `skipToIndex(current - 1)` path, not `previous()`.

### 2.3 The pill's outgoing slide is cut off on Android

- **Where:** `PillPlayer.tsx:99-117`.
- **What:** `skip()` starts a 32 px slide out, then calls `onNext`. On Android `showSkip` changes the song in the
  same tick, so the effect at `:101` runs on the next render, cancels the skip and starts the slide in. The old title
  never visibly leaves; the new one just appears 16 px off and settles.
- **Fix:** let the slide out finish (Motion.duration.instant) before the new title is shown: keep the shown title in
  local state and swap it in the slide-out's completion (or hold the incoming one for that duration). Keep the 
  `SKIP_SETTLE_MS` fallback for a restart, where the song does not change.
- **Also:** the pan is `.runOnJS(true)`, so the follow-the-finger motion runs on the JavaScript thread and stutters
  when JavaScript is busy (a skip is exactly when it is). Move `onUpdate` to a worklet writing `shift` / `fade`, and
  `runOnJS` only the commit in `onEnd`.

### 2.4 Title swap animates for metadata updates and not for a same-title skip (mobile)

- **Where:** `allegra/Marquee.tsx:146-153` (`SwapMarquee`, `key={children}`), used at
  `NowPlayingControls.tsx:485-490`.
- **What:** the swap is keyed on the text, not the song.
  - Two songs with the same title back to back (the same song twice in a queue, a single-song queue where next
    restarts, "Intro" from two albums) get no transition at all.
  - A title that changes for the **same** song (the full row from SQLite arriving in `noteTrackChange`, a lyrics
    pick, a renamed song) plays a swap animation, with whatever `lastSongDirection()` happened to be.
- **Fix:** key on `songId + title`, and pass `direction={0}` (a plain cross-fade) when the song id did not change.

### 2.5 Up next does not follow the playing song while it is open (mobile)

- **Where:** `UpNextPanel.tsx:321-327`.
- **What:** the list scrolls to the playing row only when the panel opens or the filter changes. With the panel open
  through an auto-advance or a skip, the "playing" marker moves off screen.
- **Fix:** also scroll when `index` changes while open, but only if the listener is not dragging or has not
  scrolled in the last ~3 s (same rule as lyrics following). Animated scroll for a one-row move, jump for more.

### 2.6 Web: the cover slides the wrong way after a previous that restarted the song

- **Where:** `apps/web/src/components/PlayerPanel.tsx:159-167`.
- **What:** `goPrevious` sets `coverIntent = -1` before calling `onPrevious`. Past 4 s `skipPrevious` only seeks to
  0 (`useAudioPlayer.ts:233-236`), so the song does not change and the intent is never used. It stays set, and the
  next song change of any kind (auto-advance, a queue pick) slides the cover backwards. Same for `goNext` when
  `skipNext` returns null.
- **Fix:** clear the intent when the call does not change the song. Simplest: let `onNext` / `onPrevious` return
  whether the song changed (`skipNext` already returns the song) and set the intent only then, or store the intent
  with the target song id and use it only if that id is the one that arrives.

### 2.7 Web: title block always rises from below while the cover slides sideways

- **Where:** `PlayerPanel.tsx:509-514` (`np-meta`, keyed per song).
- **What:** on next / previous the cover slides left or right but the title and artist fade up from 10 px below. Two
  directions for one change reads as two separate events.
- **Fix:** use the same `coverDir` for a small horizontal offset (or a plain cross-fade with no movement).

### 2.8 Web: possible double advance at the end of a song

- **Where:** `useAudioPlayer.ts:373` (near-end fallback in `timeupdate`) and `:393` (`ended`).
- **What:** the fallback advances at 0.35 s before the end and `selectSong` immediately clears `autoAdvancedRef`.
  Until React's effect swaps the `src` (`:455-484`), the element is still the old track: one more `timeupdate`
  near the end, or the old track's `ended`, calls `advanceToNext` again with the **new** song as current, skipping
  one. Normally the effect wins the race; on a busy main thread (karaoke separation running, a background tab) it may
  not.
- **Fix:** tie the advance to the source that ended. Record `playbackGenerationRef` (or the `src`) when the
  fallback fires and ignore `timeupdate` / `ended` events whose generation is older than the current song's. Do not
  clear `autoAdvancedRef` until the new source has loaded (`loadedmetadata` for the new generation).
- **Test:** hook test that fires `timeupdate` (near end) then `ended` before the src effect runs, and asserts one
  advance.

### 2.9 Previous at the first song: three platforms, three behaviours

- Android engine: restarts the song (repeat off) or wraps to the last (repeat all).
- iOS JavaScript queue: always wraps to the last song (`playerStore.ts:809-813`), ignoring repeat.
- Web: always wraps (`previousDistinct`), ignoring repeat; restart threshold is 4 s instead of 3 s
  (`useAudioPlayer.ts:233`).
- **Fix:** one rule, the engine's, in `packages/connect` (shared and pure): past 3 s restart; at the first song with
  repeat off restart; otherwise go back one. Web and iOS use it; `QueueMath.kt` stays its Kotlin twin, with a note in
  both files to keep them in step.

---

## Phase 3: Project motion rules that the code breaks (P2)

Hard rules 5 and 6 in `CLAUDE.md` (transform and opacity only; every duration and easing from a token).

### Web

| Where | Problem | Fix |
|---|---|---|
| `styles/global.css:2613` and `:3230` | `.nav-label` transitions `width` | fade with `opacity` and clip with `transform: scaleX` / let the parent clip |
| `global.css:2617`, `:3234` | `.site-header` transitions `width` and `padding` on sidebar collapse | animate a `transform: translateX` on the rail and keep the width fixed, or swap without a transition |
| `global.css:2620`, `:3237` | `.content-wrap` transitions `margin-left`: the whole page re-lays out each frame | reserve the space and move the content with `transform`, or no transition |
| `global.css:1973`, `:2367` | `box-shadow` in transitions | put the shadow on a pseudo-element and fade its `opacity` |
| `global.css` | the block at `:2613-2620` appears twice (`:3230-3237`) | delete the duplicate after checking which one wins |
| `components/PlayerPanel.tsx:310` | ad-hoc spring `260 / 36 / 0.95` | add `spring.sheet`-style token or use `spring.sheet` |
| `components/PlaylistControls.tsx:182` | ad-hoc spring `300 / 20`, and no reduced-motion branch | `spring.tactile`; opacity only when reduced |
| `components/ui.tsx:82` | ad-hoc spring `520 / 14` | a token (`spring.bounce` if a bounce is wanted) |
| `components/ArtistPreviewCard.tsx:48` | `duration: 0.45, bounce: 0.12` | token |
| `components/InfoTour.tsx:131-199`, `infoScenes.tsx`, `blend/BlendsInfo.tsx:136`, `TasteOnboarding.tsx:298` | literal durations, delays and a literal cubic-bezier | tokens; keep the choreography, name the numbers |

Add a guard test like the phone's `src/designGuards.test.ts`: fail on `transition:` lines in CSS that name a
banned property, and on numeric `duration` / `stiffness` literals in `.tsx`.

### Mobile

| Where | Problem | Fix |
|---|---|---|
| `MiniPlayer.tsx:130-146` | skip buttons animate `width` every frame | fixed width with `scaleX` + `opacity`, or a measured `translateX` re-centre |
| `MiniPlayer.tsx:427-460` | classic shell animates `height`, `left`, `right`, radii every frame | known trade-off (comment at `:440-445`); consider a fixed-height shell with a `translateY` reveal. Classic bar only, so lower priority |
| `MiniPlayer.tsx:233-234, 276-279, 385-395` | literal durations / springs (55 ms, 300 ms, 400 ms, 200 ms, damping/stiffness numbers) | `Motion` tokens from `allegraTheme.ts` |

`src/designGuards.test.ts` should already cover screens; check why `MiniPlayer.tsx` is not caught (it lives in
`components/`), and extend the guard rather than whitelisting it.

---

## Phase 4: Rarer edge cases and cleanup (P3)

1. **iOS: next / previous may play a blip of the old song.** `nextInPlaylist` (`playerStore.ts:784-787`) and
   `previousInPlaylist` (`:824-826`) call `playerControls.play()` themselves, before `MiniPlayer` has replaced the
   audio, and `MiniPlayer` plays again after the load anyway (`MiniPlayer.tsx:358`). Drop the direct `play()` calls;
   let the loader own "play after load". (The Android code already documents this exact blip at `:632-635`.)
2. **iOS: lock-screen, voice, widget and Connect "previous" never restart the song.** Only the two UI buttons apply
   the 3 s rule on iOS; `previousInPlaylist` does not (`PlayerContext.tsx:255-257`, `useVoiceCommands.ts:125`,
   `widgetTaskHandler.tsx:43`, `mobilePlayerPort.ts:253`). Fixed by 2.9 if the rule moves into the store's JavaScript
   branch.
3. **iOS: removing the playing song from Up next stops the music;** Android moves on to the next song
   (`playerStore.ts:685-696` vs `:670-679`). Make iOS move on too.
4. **iOS: end of queue with repeat off** stays on the last song paused; Android goes back to the first song paused
   (`QueueMath.endAction`). Pick Android's.
5. **Android: a skip in a one-song queue** runs `noteTrackChange` again (playlist history and "last played" written
   for a restart). Skip `noteTrackChange` in `showSkip` when the song id is unchanged.
6. **iOS: `updateQueue` when the playing song is missing** from the new list keeps the old index, which then points
   at a different song (`playerStore.ts:592-597`). Clamp and mark "not in queue" (index -1) instead.
7. **`nextInPlaylist` writes the store twice** in a row (`playerStore.ts:774-783`: `loadedAudioId: nextSong.id`,
   then `null`), two renders of every player subscriber per skip on iOS. One `set`.
8. **Web: `skipPrevious` keeps a stale `seek`** (memoised on `[selectSong]`, calls the first render's `seek`). Harmless
   today because the target is 0; add `seek` to the deps so a later change to `seek` does not bite.
9. **Web: wrong copy for a dead source.** Any `play()` rejection shows "Playback needs a tap to begin"
   (`useAudioPlayer.ts:115`), including `NotSupportedError` for a broken stream. Only `NotAllowedError` means "needs
   a tap"; others should say the track could not be loaded.
10. **Web: arrow keys seek while a dialog or menu is open** (`useAudioPlayer.ts:497-510` only skips inputs and
    buttons). Skip when the event target is inside `[role="dialog"]`, `[role="menu"]` or a slider.

---

## Order of work

Each step is one small PR (squash-merged, conventional commit, version bump where the rules ask).

1. **PR 1 (mobile, P1):** 1.3 playhead reset, 1.2 one shared `skipBackward`, 1.1 classic bar lyrics. Bump
   `apps/mobile/app.json` patch version.
2. **PR 2 (mobile, P1/P2):** 1.4 previous near 3 s, 2.1 and 2.2 cover swipe rules (2.2 needs the owner's answer
   first), 2.3 pill slide, 2.4 title key, 2.5 Up next follow. Patch bump.
3. **PR 3 (shared + web, P1/P2):** move the previous / shuffle rules into `packages/connect` (2.9, 1.6) and use them
   on the web; then 1.5, 2.6, 2.7, 2.8. Run `npm run sync:shared`.
4. **PR 4 (web, P2):** Phase 3 web table and the CSS / motion guard test.
5. **PR 5 (mobile, P2/P3):** Phase 3 mobile table, Phase 4 items 1 to 7. Patch bump.

Every fix ships a regression test (repo rule). Pure rules (queue order, previous, which song to show after a fade)
get unit tests; the store and hook changes get store / hook tests.

## Verifying

- `npm run typecheck`, `npm run lint`, `npm test` at the root; `npm run mobile:check` for the phone.
- Kotlin, only if 1.4 (a) changes the bridge: `cd apps/mobile/android && ./gradlew :app:testDebugUnitTest`.
- Web by hand on http://localhost:5173 at 360 / 768 / 1280 / 1920: next, previous before and after 4 s, shuffle on,
  repeat off at the last song, a dead stream in the middle of a queue, Reduce Motion on.
- Phone: the `mobile-player-probe.sh` run plus a physical-phone pass of each **Repro** line, recorded in
  `.planning/mobile-ui-review/IMPLEMENTATION-STATUS.md`. CI emulators run with animations off, so motion fixes
  (2.1, 2.3, 2.4) can only be confirmed on a device or with animations turned on.
