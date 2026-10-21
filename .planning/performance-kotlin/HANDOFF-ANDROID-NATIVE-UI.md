# Android native UI migration handoff

Updated: 2026-10-21 (pushed for a cloud session)

## Start here (cloud continuation)

- Repository: `https://github.com/peterish8/allegra` (remote `origin`). Work on the branch **`perf/mobile-player-responsiveness`**, pushed to `origin`. It is 14 commits ahead of `origin/main` (merge base `74b4b47`) and there is **no PR**. Do not open a PR, merge, or push to `main` without the user's approval. Pushing more commits to this branch is expected.
- Newest code commit on the branch: `0fdb780 feat(mobile): draw the Up next queue rows in Kotlin on Android` (app version 1.21.0). Everything before it was verified on an emulator; **that one was not** (see slice 7).
- First steps: `git fetch origin && git checkout perf/mobile-player-responsiveness && git status`, read `CLAUDE.md` and `apps/mobile/CLAUDE.md`, then this file. The mobile app is not a root workspace: `cd apps/mobile && npm install` (own lockfile).
- What a cloud session can and cannot do: it can write Kotlin and TypeScript, run `npx tsc --noEmit`, `npx eslint`, `npx jest`, and (if the Android SDK is available) `./gradlew :app:compileDebugKotlin :app:testDebugUnitTest`. It **cannot** run the user's Windows emulator (`LowEnd_M31`), so it cannot do the emulator checks the goal requires. For every slice done in the cloud: finish the code and the automated checks, commit, and add a **"Needs a device check"** list to the slice's section below saying exactly what to look at (alignment, safe areas, transparency, gestures, animation). Never write "verified on an emulator" for something that was not. The user (or a local session) does that check on the Windows machine and then marks the slice verified.
- Never commit `apps/mobile/metro.config.js` (a local Windows shim) or stage `apps/mobile/.expo-export-check/`. They are not in the pushed branch and must stay out of it. No `Co-Authored-By` or AI footers in commits; conventional messages (`feat(mobile):`, `fix(mobile):`, `docs(planning):`). Bump `expo.version` in `apps/mobile/app.json` for every change that rebuilds the APK (minor for a feature, patch for a fix).
- Order of work from here: (1) the queue slice below needs its device check first; (2) then the remaining Now Playing pieces, one vertical slice at a time: cover/background stage, gestures and the player sheet, the header and controls rows still in React Native; (3) then the content screens behind the tab bar: Stream, Library, Luvs, More. Route handling stays JavaScript-owned until a slice explicitly changes it.
- The goal is complete only when every requested Android screen is migrated and verified on a device or emulator. As of this push it is not: queue (unverified), the header/controls rows, cover stage, gestures/sheet, Stream, Library, Luvs and More remain, and nothing has TalkBack, release-build, real-device or performance evidence yet.

## Current objective

Continue the active goal: migrate Allegra Android's primary UI surfaces, including navigation and Now Playing, from React Native rendering to native Kotlin while preserving the existing custom design, animations, playback behavior, routing, and performance safety. The user explicitly wants the current Allegra look and motion retained, with transparency, blending, and alignment issues corrected. This is a sustained migration; do not claim it is complete until the requested Android screens have actually moved and been verified.

The user also requested that synced lyrics remain responsive across phone and Dynamic Island, with line and letter highlighting following the playing recording, and that `[INSTRUMENTAL]` render as an animated waveform symbol rather than text. Keep those behaviors in scope when their surfaces are touched.

## Worktree and Git state

- Main checkout: `C:\dev\allegra`, branch `main`.
- Active feature checkout: `C:\dev\allegra-mobile-responsiveness`, branch `perf/mobile-player-responsiveness`.
- Commits on the branch so far (newest first): `0fdb780` queue rows in Kotlin (unverified), `b184600` canvas colours drive the bottom wash, `fc4ff7a` Apple + glow with the island's light, `dea965c` island lyrics scroll and controls, the docs commits, `bbe9fd8` island first-line fix, `0c38769` fullscreen header fix, `67d63fd` mini player skip fix, `faca34c` native synchronized lyrics, `b2b2cfb` tab bar, `e2003b4` transport controls, `7491020` aligned transport controls.
- Local-only, never commit: `apps/mobile/metro.config.js` carries a Windows shim appended after the Sentry wrappers (Sentry's feedback stub matches origin paths with forward slashes, so on Windows the dev bundle pulled in the real feedback widget and crashed). A real fix should be its own commit. `apps/mobile/.expo-export-check/` is generated output; keep it out of commits. `apps/mobile/android/app/debug.keystore` was copied into the worktree and is git-ignored.
- The branch was pushed to `origin` (`peterish8/allegra`) on 2026-10-21 at the user's request, for a cloud session. No PR is open. Do not open one, merge, or push to `main` without the user's approval.

## Slices done

### 1. Transport controls (`e2003b4`)
Kotlin `NativeTransportBar`: play/pause and skip glyphs with press and morph motion; commands go through the existing player flow.

### 2. Tab bar (`b2b2cfb`)
Kotlin Canvas `NativeTabBarView` for the classic and modern-pill bars (geometry in the pure, JVM-tested `TabBarGeometry`). React Navigation still owns route state; the mic and the More menu stay React Native. Fixes made while verifying on the emulator: the classic bar now fills under the gesture strip, the pill no longer jumps to the top when More opens, the doubled pill rim is gone, Stream's selected state is set on first draw, tabs are Buttons with a click action and a selected state for TalkBack.

### 3. Synchronized lyrics in Now Playing (app version 1.18.0)
Android draws the timed lyrics in Kotlin; the React Native `SynchronizedLyrics` stays as the fallback.

- `views/NativeLyricsView.kt` (Expo view `NativeLyrics`): own scroll, drag and fling (`OverScroller`), tap, edge fade, per-line brightness tweens (`DIM_MS` 360 on the standard bezier), the critically damped glide, Apple's early/auto resume rules, the three-copy feathered letter sweep clipped per word, the title glow, and the `[INSTRUMENTAL]` equalizer. Accessibility: one virtual Button per visible line (`ExploreByTouchHelper`).
- `lyrics/LyricsMath.kt` (pure, JVM-tested): glide, rest opacity, feather, anchor, active line, sweep offset, pill direction, equalizer heights. A port of `lyricMotion.ts` and `lyricLayout.ts`, constants included.
- `lyrics/LyricsModel.kt`, `LyricsLayouts.kt`: the JSON payload parser (rejects malformed or dishonest segments) and the `StaticLayout` builder, run on a background thread. Fixed line height follows React Native's rule.
- `modules/NativeLyricsModule.kt`, registered in `ExpoModulesPackageList.kt` (guarded by `nativeModuleList.test.ts`).
- `src/playback/lyricTiming.ts` is the shared word/syllable timing builder; the island and the native lyrics both use it. `nativeLyricsPayload.ts` builds the payload and the style config. `NativeSynchronizedLyrics.tsx` is the adapter. `LyricsResumePill.tsx` is the frosted "Now playing" pill, shared with the React Native list. `instrumentalLine.ts` holds `isInstrumentalLyric`.
- `IslandFonts` gained the Bold face and now tells every caller when fonts arrive (not only the first).

Contracts kept:

- One playback authority. Native reads the Media3 player's own `currentPosition` on the main thread (`IslandPlayback.watch`), per frame only while the lyrics are `live` (on screen, route focused, app active) and playing; paused it redraws only on seeks and state changes. It follows the player only while `currentMediaItem.mediaId` is the song the lines were fetched for (media IDs are song IDs); otherwise it holds at the position JavaScript last knew (`seedMs`).
- Taps go back through `onLyricPress(timestamp)` to the existing `handleLyricTap` (seek, then `requestPlayback(true)`).
- Connect remote playback is unchanged: `NowPlayingLyricsArea` takes `localClock`, which only `NowPlayingScreen` passes. iOS, plain lyrics, no timed lines and a missing native view all use `SynchronizedLyrics`.
- The dismiss pan still fails over the lyrics only when they are scrolled: native emits `onAtTop` and the adapter writes `scrollOffset` (0 at the top, 3 otherwise; the gesture's threshold is 2).
- No lyric timing is invented: a line with no usable timing has no segments and lights as a whole. Lines of more than 24 words light as a whole, as before.

Known differences from the React Native list (kept small on purpose):

- Letters-mode wrapping uses one text layout per line instead of one view per word, so a line can wrap one word differently.
- No overscroll glow at the ends.
- Debug builds have no raw font resources, so the native text falls back to the system bold there. Font parity needs a release build.

## Verification evidence (slice 3)

Automated, all passing:

- Kotlin JVM tests: `LyricsMathTest` (13) and `LyricsParserTest` (6); `:app:compileDebugKotlin`, `:app:testDebugUnitTest` for the lyrics package, and `:app:assembleDebug`.
- Jest: `lyricTiming`, `nativeLyricsPayload`, `nativeModuleList`, `dynamicIslandSetup`, `lyricMotion`, `lyricLayout`, `lyricClock` and the rest of the suite (see the commit's final run); `tsc --noEmit` clean; `eslint .` 0 errors (79 pre-existing warnings).

Emulator (`LowEnd_M31`, x86_64 Android 16 image, debug build against Metro), observed with screenshots:

- The native view is the one drawing: the accessibility tree shows one virtual `android.view.View` per visible line with the line text and `clickable=true`.
- Lines render with the right per-line brightness falloff, the soft-edged letter sweep mid-line, the glowing song title inside a line ("levitating" in "Levitating"), and the top and bottom edge dissolve.
- The equalizer replaces the leading blank/`[INSTRUMENTAL]` row: five white bars, dancing while that line is active, placed at the same inset the React Native waveform uses.
- Following: the active line holds its anchor and a line change glides (a frame captured 0.4 s after a seek shows the lines mid-flight, the settled frame 2 s later).
- Reading: a drag scrolls the lines, the lines brighten, the frosted "Now playing" pill appears when the sung line is far away; scrolling stops at the last-line anchor like the React Native list.
- Tap: tapping "Didn't want to call your name" moved the song to 0:14 with that line active and sweeping; playback continued (existing `handleLyricTap` path).
- Island (shares `lyricTiming.ts` after the refactor): its card still sweeps letters in step with the song.
- Logcat: no crash or exception from the view.

Not verified, so do not claim it: TalkBack itself; release-build font parity; a real device and any performance numbers (no frame-time or CPU measurement was taken, so no gain is claimed); the cover-to-lyrics morph and dismiss-pan interplay were seen only in passing; fullscreen lyrics mode; Reduce Motion; large font scale; RTL lines; a delay change at runtime; the Connect fallback. The emulator closed the player sheet on every song change, which cut several checks short.

## Follow-up fixes the user asked for during the lyrics slice

Done and committed (each verified on the emulator, no unit test possible for the layout ones; the dumpsys bounds are the evidence):

- `67d63fd` Mini player: the skip icons sat about 9 dp left of centre because `NativeSkipView` (an Expo LinearLayout) re-laid its React Native child from its own origin and dropped the slop padding. It now leaves placement to React Native. dumpsys: child at 21,21 in its wrapper; play button 99 px / 100 px from the two icons.
- `0c38769` Fullscreen lyrics header: the cover was invisible (`Artwork` sizes its frame from `style`, and the header's style had no width or height). Fixed, and the header now mirrors the bottom row: cover, title, artist, exit fullscreen, options, heart.
- `bbe9fd8` Island: the full lyrics opened with the first line jammed under the top fade; the list now rests with the first line at the sung-line place from the start (`IslandView.drawFullLyrics`).

- 1.18.4 Island full lyrics: a vertical drag inside the lyrics now scrolls them (new `Axis.LYRICS`, with fling and rubber band past the last line) instead of folding the card. Pulled down past the first line, the card grows 72 dp below the scrubber (`shape(..., pk)`) and shows previous / play-pause / next there; pushing back up tucks the row away. The lyrics hand back to the song 3.5 s after the finger lifts (a tap on a line resumes at once). Verified on the emulator with screenshots: scroll up and down, row revealed under the scrubber, pause and resume by tapping it, row tucked away. Kotlin unit tests, `tsc`, Jest (878) pass; eslint reports 0 errors (78 old warnings). Not verified: TalkBack itself (the island already exposes previous / play-pause / next as custom accessibility actions on the view, so they work in the lyrics state; the revealed buttons are canvas-drawn without their own virtual nodes), the cover-to-lyrics morph with the row open, a real device.

- 1.19.0 In-app Apple + glow now uses the island's light. New `NativeFlowGlowView` (module `NativeFlowGlow`, JS `components/player/NativeFlowGlow.tsx`) draws `IslandFlow` (the cover's colours as one flowing liquid mesh, computed at 40x56 and drawn large with filtering) under a soft top veil; the colours come from the same cover reading as the island (`IslandPalette`, split out of `IslandArt`, which now calls it). `NowPlayingBackground` uses it on Android when the view exists and keeps the Skia `GlowBackground` as the fallback (iOS, builds without the view); the Skia palette read is skipped when native is used. The flow's clock runs only while the surface is visible and the song plays, eases to a stop on pause, stops with Reduce Motion, and is recomputed at the island's device budget (66 / 33 / 16 ms). Verified on the emulator with two screenshots 5 s apart on a green cover (no black gaps; the shapes moved). Kotlin unit tests, `tsc`, eslint on the touched files, the module-list guard test pass. Not verified: a cross-fade on song change on a device, the veil strength on bright covers, a release build, performance (nothing measured, so no gain is claimed over the Skia glow), a real device.

- 1.20.0 Animated canvas colours now drive the bottom wash of Now Playing. New `NativeCanvasWashView` (module `NativeCanvasWash`, JS `components/player/NativeCanvasWash.tsx`): it finds the canvas's `TextureView` (the video is drawn into one on Android) through the native ID the canvas layer's wrapper carries (`nativeID`, set only by `NowPlayingBackground`), reads it four times a second into a 16x24 bitmap (no second decoder, the video is untouched), takes the lower half, blurs it (3 passes), caps brightness at 150/255 so it stays a room, eases between readings each display frame, and draws it filtered large under the same shade as the cover room, melting into the video's own dissolve. It samples only while the canvas is on screen and the song plays; paused it holds the last colours; with no view (iOS, older builds) the still cover room stays. Verified on the emulator on "Animals" (Apple Music HLS canvas): bottom wash is plum/magenta continuing the video (the cover palette gave blue/teal and pink before), two frames 9 s apart differ slightly. A first version showed blocky white blobs from the video's bright strokes: fixed by the blur and the cap. Kotlin tests, `tsc`, eslint on touched files, Jest (878) pass. Not verified: other canvases (dark or very bright clips), a song change while the canvas plays, the sheet drag, a real device and its cost (nothing measured: `TextureView.getBitmap` at 4 Hz into a tiny bitmap should be cheap, but no number was taken), release build. The emulator was very slow during this run (the JS thread lagged by minutes), so timing and animation smoothness are not judged.

Still open from the user's follow-up list: nothing. Continue with slice 7's device check, then the remaining screens below.

### 7. Up next queue rows in Kotlin (app version 1.21.0, commit `0fdb780`) — BUILT, NOT DEVICE-VERIFIED

What it is. `views/NativeQueueListView.kt` (Expo view `NativeQueueList`, module `NativeQueueListModule`, JS wrapper `components/player/NativeQueueList.tsx`) draws, scrolls and re-orders the rows of `UpNextPanel`: cover (loaded small through Media3's `DataSourceBitmapLoader`, 150 ms fade over the base colour; the generated duotone cover when there is no picture or it fails, seeded like `Artwork`), title, `artist · m:ss`, the playing row's mark (three still bars) and tint, the pressed highlight, the two-bar handle. The panel's glass, header (Playing from, Shuffle), filter chips and swipe-down-to-close stay React Native; the `FlatList` is the fallback (iOS, builds without the view).

Contracts kept:

- Tap -> `onPick(index)` -> the existing `pick` (`skipToQueueIndex`). Nothing in Kotlin touches the queue or the player.
- Re-order: a touch on a row's handle (right 52 dp) lifts it (spring scale 1.03 on a lit pane, haptic), the others step aside on `Motion.spring.tactile` springs, release settles it into its slot, then `onMove(from, to)` -> `onNativeMove` -> `updateQueue(moveItem(...))` + `prepareNextInQueue()`, the same calls the old drop made. The new order comes back as new `rows`; the native list clears its offsets in that same update (a 900 ms timeout clears them if no update arrives). Geometry and rules are ported from `coverStage.ts` (`dropIndex`, `rowShift`, `moveItem`) in the JVM-tested `queue/QueueModel.kt`.
- The panel's dismiss pan still fails when the list is scrolled: the native list emits `onAtTop` and the panel writes `scrolled` (0 at the top, 3 otherwise; the pan fails past 2). A touch on a handle disallows parent interception, and the pan still fails in the handle column.
- Opening or changing the filter scrolls to the playing row minus one: the panel bumps `scrollToken` and passes `startRow`.
- Accessibility: one virtual Button per visible row ("Play <title>" / "Now playing: <title>") and, when movable, a "Move <title>" node with Move up / Move down actions (new; the React Native handle had a label but no way to move a row without dragging).

Automated, passing at this commit: `:app:compileDebugKotlin`, `:app:testDebugUnitTest` (new `QueueModelTest`, 8 tests), `nativeQueuePayload.test.ts` (5), `nativeModuleList.test.ts`, `tsc --noEmit`, `eslint` on the touched folders. The debug APK built and installed on the emulator; the emulator then stalled and the checks below were never run.

**Needs a device check (do this first, on the Windows emulator or a phone):** open Now Playing, swipe up for Up next, and confirm: the rows match the React Native list pixel for pixel in look (row height 64 dp, 48 dp cover, 14 dp row radius, text left edge, the lit current row, the playing mark); covers load and fade in, and a song with no cover shows the duotone tile; the list opens on the playing song with one row above; scrolling and fling feel right and the panel's swipe down closes it only from the top; tap plays the row; lift/drag/drop on the handle with the others stepping aside and the order persisting (check the queue in the notification and the island too); the Familiar and Discover chips show no handles; safe area at the bottom (last row clears the gesture bar); transparency over the frosted panel; TalkBack reads rows and the move actions. Fix what is off, then record the evidence here and in the commit.

Not measured: no frame time or CPU number was taken, so no performance gain is claimed. Reduce Motion and large font scale were not checked (rows are a fixed 64 dp, like the React Native rows).

## Remaining screens (in order)

After slice 7's device check, continue one vertical slice at a time through the rest of Now Playing and then the main screens: cover/background stage (`AppleBackdrop`, `CoverStage`), gestures and the player sheet (`PlayerSheet`, the dismiss and swipe-up pans), the header and controls rows still in React Native (`NowPlayingControls`), then the content screens behind the tab bar (Stream, Library, Luvs, More). Route handling stays JavaScript-owned until a slice explicitly changes it.

Pattern every slice so far follows (copy it): a pure, JVM-tested Kotlin model/math file; one Expo view (`views/Native<Name>View.kt`) that draws on a Canvas, owns its touch handling and a Choreographer loop that runs only while it has something to animate, uses `ExploreByTouchHelper` for accessibility, overrides `onMeasure`/`onLayout` so it never re-lays out React Native children, and applies props in one `commit()` via `OnViewDidUpdateProps`; a module in `modules/` registered in `ExpoModulesPackageList.kt` and guarded by `nativeModuleList.test.ts`; a JS wrapper that uses `requireNativeView` inside try/catch and exposes an `available()` check; a pure TypeScript payload builder with a Jest test; the React Native component kept as the fallback; and a version bump.

## Constraints for continuation

1. Work in `C:\dev\allegra-mobile-responsiveness`; first re-check `git status`, branch, HEAD, and the diff. Do not overwrite or stage unrelated work.
2. Read `C:\dev\allegra\CLAUDE.md` and `C:\dev\allegra\apps\mobile\CLAUDE.md` first. One vertical slice at a time. All existing behaviors are contracts.
3. No `Co-Authored-By`, AI attribution, or similar footers in commits. Commits may be pushed to `origin/perf/mobile-player-responsiveness` (the user approved that for the cloud session); no PR, merge, or push to any other branch without the user's approval. Never stage `apps/mobile/.expo-export-check/`. Bump `expo.version` in `apps/mobile/app.json` for every APK-reaching change (minor for features).
4. Android native rendering is additive: keep the React Native fallback for iOS and for when the native view is missing.
5. One playback authority. No second player and no JavaScript per-frame clock. Connect remote has its own session clock.
6. Never fabricate lyric timing; reject results for another recording.
7. Verify native visual changes on an Android emulator/device (alignment, safe areas, transparency, gestures, animation). Measure before claiming performance gains, and say plainly what lacks device proof.

## Environment notes

- Emulator `LowEnd_M31` (its data was wiped on 2026-10-21 after a disk-full corruption). Start it with `-gpu host -cores 6`. Stop the Gradle daemon before using it on this machine (RAM). Run one Gradle at a time.
- Metro: from `apps/mobile`, `node node_modules/expo/bin/cli start --port 8081 --offline`, then `adb reverse tcp:8081 tcp:8081`. In the dev launcher, tap the 10.0.2.2:8081 server.
- Testing tips: the emulator's queue advances on its own and closes the player sheet, so re-check which screen is up before every tap (a stray tap once nudged the island width slider to 105% on this emulator; reset it to 100%). `uiautomator dump` fails with "could not get idle state" while the island animates. Git Bash mangles `/sdcard` paths: use `MSYS_NO_PATHCONV=1`; use `adb exec-out screencap -p` from bash.
- The C: drive was almost full (about 4 GB free). `AppData\Local\Temp` holds tens of GB from other tools; the user has not approved deleting those.

## Files and references

- `.planning/performance-kotlin/UI-PERFORMANCE-PLAN.md`
- `.planning/performance-kotlin/NATIVE-PLAYBACK-PLAN.md`
- `apps/mobile/src/screens/NowPlayingScreen.tsx`, `apps/mobile/src/components/NowPlayingLyricsArea.tsx`, `apps/mobile/src/components/SynchronizedLyrics.tsx`
- `apps/mobile/android/app/src/main/java/com/lyricflow/app/views/NativeLyricsView.kt`
- `apps/mobile/android/app/src/main/java/com/lyricflow/app/modules/PlayerBridge.kt`, `.../services/PlaybackService.kt`
