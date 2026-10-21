# Android native UI migration handoff

Updated: 2026-10-21 (cloud session: slice 7 parity review)

## Start here (cloud continuation)

- Repository: `https://github.com/peterish8/allegra` (remote `origin`). Work on the branch **`perf/mobile-player-responsiveness`**, pushed to `origin`. It is restarted from `origin/main` after each squash-merge. On 2026-10-21 the user said to run the tests, have a reviewer read the code, fix what it finds, bump the version and merge (PR, then squash-merge once CI is green) without emulator checks; that was for that work, so ask again before merging later work if the user has not said the same.
- The branch was squash-merged to `main` as PR #29 (`9922186`, app 1.22.1) on 2026-10-21 on the user's instruction, and restarted from `main` for follow-up work. Slice 7 (`0fdb780`, 1.21.0), its cloud parity-review fixes (1.21.1), slice 8, the song scrubber (1.22.0), and slice 9, the volume slider (1.23.0), were **not** run on a device (see their sections). Everything before them was verified on an emulator. The user decided on 2026-10-21 to merge without emulator checks once the automated checks pass and a code review is clean; the device-check lists stay as the record of what has no device proof.
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

### 7. Up next queue rows in Kotlin (app version 1.21.0, commit `0fdb780`; review fixes in 1.21.1) — BUILT, NOT DEVICE-VERIFIED

What it is. `views/NativeQueueListView.kt` (Expo view `NativeQueueList`, module `NativeQueueListModule`, JS wrapper `components/player/NativeQueueList.tsx`) draws, scrolls and re-orders the rows of `UpNextPanel`: cover (loaded small through Media3's `DataSourceBitmapLoader`, 150 ms fade over the base colour; the generated duotone cover when there is no picture or it fails, seeded like `Artwork`), title, `artist · m:ss`, the playing row's mark (three still bars) and tint, the pressed highlight, the two-bar handle. The panel's glass, header (Playing from, Shuffle), filter chips and swipe-down-to-close stay React Native; the `FlatList` is the fallback (iOS, builds without the view).

Contracts kept:

- Tap -> `onPick(index)` -> the existing `pick` (`skipToQueueIndex`). Nothing in Kotlin touches the queue or the player.
- Re-order: a touch on a row's handle (right 52 dp) lifts it (spring scale 1.03 on a lit pane, haptic), the others step aside on `Motion.spring.tactile` springs, release settles it into its slot, then `onMove(from, to)` -> `onNativeMove` -> `updateQueue(moveItem(...))` + `prepareNextInQueue()`, the same calls the old drop made. The new order comes back as new `rows`; the native list clears its offsets in that same update (a 900 ms timeout clears them if no update arrives). Geometry and rules are ported from `coverStage.ts` (`dropIndex`, `rowShift`, `moveItem`) in the JVM-tested `queue/QueueModel.kt`.
- The panel's dismiss pan still fails when the list is scrolled: the native list emits `onAtTop` and the panel writes `scrolled` (0 at the top, 3 otherwise; the pan fails past 2). A touch on a handle disallows parent interception, and the pan still fails in the handle column.
- Opening or changing the filter scrolls to the playing row minus one: the panel bumps `scrollToken` and passes `startRow`.
- Accessibility: one virtual Button per visible row ("Play <title>" / "Now playing: <title>") and, when movable, a "Move <title>" node with Move up / Move down actions (new; the React Native handle had a label but no way to move a row without dragging).

#### Parity review (cloud session, 1.21.1) — read from code, not seen on a screen

`NativeQueueListView.kt` was re-read against `UpNextPanel.tsx`, `Artwork.tsx`, `coverStage.ts` and the verified `NativeLyricsView`. Geometry (row 64, side 8, art 48 at +12, text at +14, handle column 52, radii 14 / 8, fills and alphas, the playing mark, the lifted pane and the 1.03 scale, `dropIndex` / `rowShift` rounding) matched. These were wrong, and are fixed:

- **The panel's swipe down could be cancelled by the list.** The view called `requestDisallowInterceptTouchEvent(true)` as soon as a drag passed the touch slop (8 dp). Gesture Handler's root view cancels all handlers when a native view does that (my reading of RNGH's root helper; not observed), and the panel's pan only activates at 10 dp, so a pull down from the top would have killed it. Now a drag that starts downward while the list is at its top is *yielded* (`QueueMath.yieldsToPanel`): the list claims nothing, scrolls nothing, and the pan gets the gesture. A drag up, or any drag in a scrolled list, still claims it.
- The first scroll frame jumped by the touch slop; the slop is now subtracted as React Native's ScrollView does (`QueueMath.scrollOrigin`).
- The lift haptic used the system `performHapticFeedback`, which ignores Settings → Haptics. The view now emits `onLift` and the panel ticks through `utils/haptics`.
- Covers were decoded at most 96 px (soft on most phones) and a non-square picture was squashed, not cropped. They now decode at 1.5 x the slot's pixels (never under 96) and are centre-cropped like `contentFit="cover"`; the cover cache is bounded by bytes (10 MB), not by count.
- The handle glyph was hand-drawn too long, too far apart and too heavy. It now uses Ionicons' `reorder-two` geometry (bars x 118..394, y 208 / 304, stroke 44, on 512, at 24 dp), read from the `ionicons` package.
- Explore-by-touch never reached the row nodes: `dispatchHoverEvent` is now forwarded to the `ExploreByTouchHelper`, as `NativeLyricsView` does.
- A tap on the handle column during the settle window played the row; the React Native handle does nothing on a tap, so the native one now matches.
- The text block now uses the font's top..bottom (React Native's Text keeps font padding), and the generated monogram's letter spacing is -4 dp in em, as `GeneratedArtwork`.

Automated, passing at 1.21.1: `:app:testDebugUnitTest` (117 tests; `QueueModelTest` is now 10; `IslandFlowTest`, a Robolectric test, failed once when its runtime jar would not download through the proxy and passed on a rerun), `tsc --noEmit`, `eslint` on the touched files, `jest` (105 suites, 884 tests), `nativeModuleList.test.ts`. `:app:assembleDebug` was **not** run in this container (the full Gradle app build needs the NDK and a long native build); the unit-test task compiles all main Kotlin, including this view.

**Needs a device check (do this first, on the Windows emulator or a phone).** Open Now Playing, swipe up for Up next, and look at:

1. Look: rows against the React Native list (turn the native view off by building without it, or compare with the previous APK): row height, cover size and corner, the text's left edge and baseline (the font-padding change moves the two text lines by about a dp at most), the lit current row, the playing mark, the handle glyph's length and weight.
2. Covers: they load, fade in over the base colour, are sharp (the decode size changed), a non-square cover is cropped not squashed, and a song with no cover shows the duotone tile with the monogram (its letter spacing changed).
3. **Closing:** with the list at the top, drag down on a row (not the handle): the panel must follow the finger and close. Scroll the list down a few rows, drag down: the list must scroll back and the panel must **not** close until it reaches the top. Drag down from the header too. This is the one most likely to be wrong, since it rests on a reading of Gesture Handler.
4. Scrolling and fling feel (no jump when a drag begins), the list opening on the playing song with one row above, safe area at the bottom (the last row clears the gesture bar).
5. Tap plays the row; tap on the handle column does nothing.
6. Re-order: lift (a haptic only if Settings → Haptics is on), the others step aside on springs, release settles into the slot, the order persists (check the notification and the island), the dragged row draws over its neighbours, and the pane under it is lit. Also: a drop that leaves the order unchanged (back where it started), and a drop when the engine is slow.
7. Familiar and Discover chips: no handles, rows are tappable, no re-order.
8. TalkBack: touch-explore reads rows ("Play <title>", "Now playing: <title>"), the "Move <title>" node offers Move up / Move down, and the actions re-order the queue.
9. Transparency over the frosted panel (the rows have no background of their own).

Known differences from the React Native list: no overscroll glow; a row is not recycled (it is drawn, so the cost is per visible row, not measured).

Not measured: no frame time or CPU number was taken, so no performance gain is claimed. Reduce Motion and large font scale were not checked (rows are a fixed 64 dp, like the React Native rows). A lead for the gesture slice, not changed here: `NativeLyricsView` claims the touch with the same `requestDisallowInterceptTouchEvent` call after the slop, so a drag down on lyrics that sit at their top may cancel the player's dismiss pan the same way; check it when the player gestures are migrated.

### 8. Song scrubber in Kotlin (app version 1.22.0) — BUILT, NOT DEVICE-VERIFIED

What it is. `views/NativeScrubberView.kt` (Expo view `NativeScrubber`, module `NativeScrubberModule`, JS wrapper `components/player/NativeScrubber.tsx`) draws Now Playing's song scrubber: the rounded track, the fill that swells (scaleY 1.6, spring `tactile`) and brightens under the finger, and the elapsed / length labels. `AppleSlider` + `TimeLabels` stay as the fallback for iOS, builds without the view, and Connect's remote player. The volume slider is not part of this slice (it still uses `AppleSlider`).

Contracts kept:

- One playback authority. The view reads the Media3 player's `currentPosition` (`IslandPlayback.watch`) only while `currentMediaItem.mediaId` is the song it was given (`localSongId`, passed only by `NowPlayingScreen`; Connect's remote player passes none and keeps its JavaScript clock). Otherwise it holds at `seedSec`. While playing and `live` (route focused) it ticks every 66 ms and redraws only when a pixel of fill or a label changed; frames run only during a drag, a settle or the swell. Paused and still, nothing runs.
- The view never seeks. A drag or tap hands the chosen seconds to `onCommit`; JavaScript runs the existing `seek` (`isSeeking`, `positionSV`, `handleScrub`: seek, then resume if it was playing). `seek(fraction)` was split into `seekSeconds(seconds)` + a fraction wrapper; the RN slider still calls the wrapper.
- Until the seek lands the view keeps showing the finger's value (as `settling` did), released when the player is within 1 s of the target or after 2 s.
- Gestures use the old slider's thresholds: a sideways drag past 4 dp claims the touch (and calls `requestDisallowInterceptTouchEvent`), a vertical one past 14 dp is yielded to the player's swipe to close, a short tap (500 ms, within the touch slop) jumps. A cancelled drag seeks nowhere. Only the 28 dp strip takes touches; the labels do not.
- Layout: the view is laid over an invisible React Native spacer (28 dp strip + the label row, from `scrubberLayout.ts`, the same numbers `NowPlayingControls` uses for the old labels), so the rows around it cannot move. The labels are drawn with the font's top..bottom (React Native keeps font padding), SF Pro semibold 13 sp, tabular figures, alpha 0.86.
- Accessibility: one node, a SeekBar named "Song position" with a range (0..length), a state description ("0:42 of 3:20") and a Set progress action. The React Native slider had a label and `adjustable` role but no value and no way to move it, so this is an addition.
- A bug the worklet-safety test caught before it shipped: `cleanSeconds` was called inside an animated reaction (it is not a worklet; on the UI thread that throws). It now runs on the JavaScript side of `runOnJS`.

Automated, passing: `ScrubberMathTest` (8), the whole `:app:testDebugUnitTest` (127), `nativeScrubberProps.test.ts` (3), `nativeModuleList.test.ts`, `workletSafety.test.ts`, `tsc --noEmit`, `eslint` (0 errors), `jest` (106 suites, 887 tests).

Code review (an Opus reviewer read slices 7's fixes and 8 against the React Native originals, 1.22.1; no blockers) led to: the scrubber's 66 ms tick now stops when the view is not visible (app in the background or screen off); queue covers decode at 4 x the slot and are centre-cropped and scaled to exactly the slot on the background executor (Media3 halves the decode until the longer side fits, so the earlier 1.5 x gave soft covers); both views size text with `TypedValue.applyDimension(COMPLEX_UNIT_SP)` like React Native (nonlinear font scaling on Android 14+); the scrubber's seed resets to 0 on a song change, its TalkBack range is float and a Set progress action announces. Left as is on purpose: neither view mirrors in right-to-left layouts (the lyrics view does not either), and a queue touch that yielded to the panel does not scroll if the finger reverses.

**Needs a device check:** open Now Playing and look at (1) the track and labels against the old ones: the strip's vertical centre, the label baseline and insets (4 dp), the track height 10 dp, the fill's brightness; (2) dragging: the bar swells and the fill follows the finger exactly, labels follow the finger, the song keeps playing and seeks on release; (3) a tap jumps; (4) a vertical swipe starting on the bar still closes the player; (5) the song changing: the bar resets with the title and shows the new length; (6) pausing: the bar holds still and nothing redraws; (7) Up next open: the scrubber rides up with the title and transport (it sits in the lifted block); (8) lyrics open (compact): the row slides as before; (9) Connect remote player still uses the React Native slider; (10) TalkBack: "Song position, seek control", the state, and Set progress. Not measured: no frame time or CPU number was taken.

### 9. Volume slider in Kotlin (app version 1.23.0) — BUILT, NOT DEVICE-VERIFIED

The scrubber's view gained `mode="volume"` (`NativeVolumeSlider` in `components/player/NativeScrubber.tsx`): the same track, swell and gestures over the system media volume, with no labels and no commit event. The speaker icons stay React Native on either side of it; `VolumeRow` in `NowPlayingControls` chooses it when the view exists and the phone has a media volume (`shouldUseNativeVolume`). Connect's `RemoteVolumeRow` (the playing device's volume, a JavaScript value) stays on `AppleSlider`.

Contracts kept: the stream is read and set exactly as `MainPlayerModule.getVolume/setVolume` do (index rounded down, no system UI, `ScrubberMath.volumeIndex`), and moves with the finger as the old `onChange` did; the hardware keys move the slider through the same `VOLUME_CHANGED_ACTION` broadcast, listened to only while the view is attached and visible. After a drag the slider shows the stream's own step again, as the old `onVolumeChanged` echo did. No JavaScript is involved per move, so the `onVolumeChanged` listener is not subscribed when the native slider is used. Accessibility: a SeekBar named "Volume", 0-100 percent, Set progress.

An Opus code review found no blockers and led to: the stream's step and range are cached (refreshed on attach, when the view becomes visible or live, and on each broadcast) so drawing and dragging make no AudioManager binder calls, and the stream is only set when the step changes; the key listener also stops when the route is not in front. Not done: hardware-key changes are not announced to TalkBack (the old slider did not either).

Automated, passing: `ScrubberMathTest` (9, new volume rules), the whole `:app:testDebugUnitTest` (128), `nativeScrubberProps.test.ts`, `tsc`, `eslint` (0 errors), `jest` (106 suites, 888 tests).

**Needs a device check:** Now Playing with the volume row showing (Settings: Hide volume slider off): (1) the track, its 6 dp height and the gap to the two speaker icons against the old slider; (2) dragging moves the real volume (the system volume panel is not shown) and the swell/brightening matches the scrubber; (3) a tap jumps; (4) the volume keys move the slider while the screen is up, and nothing happens to it when the app is in the background; (5) at minimum and maximum; (6) a vertical swipe starting on it still closes the player; (7) lyrics open: the row fades as before; (8) Connect's remote player still shows the React Native slider; (9) TalkBack: "Volume, seek control, N percent", Set progress.

### 10. Bottom row of Now Playing in Kotlin (app version 1.24.0) — BUILT, NOT DEVICE-VERIFIED

What it is. `views/NativePlayerFooterView.kt` (Expo view `NativePlayerFooter`, module `NativePlayerFooterModule`, JS wrapper `components/player/NativePlayerFooter.tsx`) draws the row under the volume slider: the queue button, the output / sleep timer segment and the lyrics button. The React Native row stays as the fallback (iOS, builds without the view). The view decides nothing: it emits `onAction` (`queue | output | timer | lyrics | lyricsLong`) and `NowPlayingControls.onFooterAction` runs the same handlers as before (the haptic tick, `onOpenQueue`, `onOutputPress` or the output switcher, `onOpenTimer`, the lyrics button's single / triple tap rules in `lyricsButtonTaps`, and the long press that opens the lyrics picker).

Geometry and feel ported from the styles and from `Tactile` (all in the JVM-tested `FooterGeometry.kt`): 44 dp buttons and row, the segment (halves at least 64 dp wide, 16 padding, 6 gap to the sleep label, a 22 dp divider one pixel wide, alpha 0.14 glass), `justifyContent: space-between` placement, the 10 dp hit slop on the two buttons (the native view is 10 dp larger than the row on every side through negative margins, so the layout around it is unchanged), later siblings winning where hit areas overlap, Pressable's 20 dp press retention, the 420 ms long press (a long press suppresses the tap), the `tactile` spring on press (scale 0.86, dim 14%, held at least 70 ms), the segment half's pressed highlight (alpha 0.12 inside the rounded rectangle), the lit lyrics button (white 0.9 with a `#15151a` icon). Accessibility: one virtual Button per control, the lyrics one with its hint and a long-click action.

Icons are the real font outlines, not hand-drawn: `scripts/extract-icon-glyphs.py` (needs `pip install fonttools` and `npm ci`) writes `views/IconGlyphs.kt` from `@expo/vector-icons`' Ionicons and MaterialCommunityIcons (list, ellipsis-vertical, heart, heart-outline, speaker, devices, timer-outline, comment-quote-outline, fullscreen, fullscreen-exit; the last five are ready for the title row and the fullscreen header). Each outline is on the fonts' 512 grid centred on the em square (the fonts centre it at y = 192, the middle of hhea ascent 448 and descent -64, so a glyph is centred where React Native centres its text box, to within 0.1 dp at these sizes). The outlines were rendered to an image to check the shapes before use.

Automated, passing: `FooterGeometryTest` (6), the whole `:app:testDebugUnitTest` (134), `nativeFooterProps.test.ts` (4), `nativeModuleList.test.ts`, `tsc`, `eslint` (0 errors), `jest` (107 suites, 892 tests).

**Needs a device check:** the bottom row against the old one, on a phone with the pill nav and with the classic bar: (1) the vertical and horizontal position of each icon inside its button and half (the glyph centring is derived from the font tables, not seen); the icon sizes; the INK_SOFT alpha; (2) the three items' spacing: the segment centred between the buttons, its width with and without a sleep timer running (the label's width changes it); (3) press feel on the queue and lyrics buttons (sink, dim, a quick tap still visibly pressed), the half highlight in the segment; (4) a tap on each does what it did (queue opens Up next, output opens the system output switcher or Connect's device picker, timer opens the sleep timer sheet, lyrics toggles); triple tap on lyrics switches letters/lines; long press on lyrics opens the picker and does not also toggle; (5) the 10 dp slop above and beside the buttons; (6) the lit lyrics button when lyrics are showing; (7) Up next open (the row fades) and lyrics open (the row stays); (8) Connect's remote player (devices icon lit); (9) TalkBack: four buttons in order with the right names, the lyrics hint and long-click action; (10) large font scale (the sleep label).

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

- **Cloud container recipe (worked 2026-10-21):** `cd apps/mobile && npm ci --ignore-scripts`; install the Android SDK with Google's command-line tools (`https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip`, then `sdkmanager --licenses "platforms;android-36" "build-tools;36.0.0" "platform-tools"`; the NDK is not needed for unit tests); export `ANDROID_HOME` and `ANDROID_SDK_ROOT`; run `gradle --no-daemon :app:testDebugUnitTest` from `apps/mobile/android` (JDK 21 works; the system Gradle 8.14.3 matches the wrapper). The first run takes many minutes and Maven Central answers some requests with **429** through the proxy: just rerun, Gradle keeps what it resolved (it took 8 tries); wrap it in a retry loop. Keep Gradle's output in a file: the Expo autolinking banner is long.

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
