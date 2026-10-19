# Handoff: dynamic island fixes (2026-10-19)

Branch `fix/dynamic-island-audit`, cut from `main` at `deb4e0b` (pulled fresh the same day). Nothing is committed
yet: every change below sits uncommitted in the working tree. Read root `CLAUDE.md`, `apps/mobile/CLAUDE.md`,
`apps/mobile/docs/dynamic-island.md` and `apps/mobile/docs/enhance-dynamic-island.md` before touching anything.

Work through the **Todo** section top to bottom. Tick a box only after its check in **Testing** has passed.

Continuation evidence (2026-10-19): **T0 passed; T1 next.**
- TypeScript exit 0; ESLint exit 0 (78 existing warnings, 0 errors); Jest 97 suites / 825 tests passed (`C:/temp/allegra-island-t0-jest.log`).
- Release Kotlin, x86_64: passed after fixing `Surface(context)` to `Surface()` in `IslandLaunch.kt` (`C:/temp/allegra-island-t0-kotlin-retry.log`). This shell did not inherit `JAVA_HOME`; set it from the user-level Adoptium JDK 17 path before Gradle.
- Native unit tests: **72 passed, 0 failed, 0 skipped**, across 10 suites (`C:/temp/allegra-island-t0-native-tests-attempt3.log`). Added `IslandBudgetTest` and Robolectric-backed main-looper tests for partial/final search results and superseded queries. The first native run exposed Android Color/Uri JVM stubs; Robolectric fixes that test environment. One retry hit transient Maven Central DNS failure; an unchanged retry passed after DNS recovered. [Robolectric setup](https://robolectric.org/getting-started/).
- No device acceptance boxes have been ticked. `DynamicIslandModule.appShown` was already present; T1 still needs the JavaScript handshake and morph verification.
---

## 1. Everything the owner reported, and where each stands

| # | Owner's report | Root cause found | Status |
|---|---|---|---|
| R1 | Island search: offline results show fast, online results never appear, even after a minute | React Native (0.81, bridgeless) holds **every JS timer while the app is in the background** (`JavaTimerManager.onHostPause`). In bridgeless mode even `fetch` resolves through a zero-delay timer, so every network call made for the island waits until LuvLyrics is opened again. The island is only used over other apps ("Hide while LuvLyrics is open" is on by default). Also: `searchOfficial` waited for all 12 answers before showing any. | **Code done, not run on a device** |
| R2 | Downloads (left) play instantly; a playlist song (right) starts after ~40 s to 1 min; the old song keeps playing meanwhile | `onlineSongs.playList` awaited `resolveAll` of the **first 12 songs** (title searches, 4 at a time, each with a 25 s timeout plus a Gaana fallback) before playing anything. On top of that came R1's background stall. | **Code done, not run on a device** |
| R3 | Tapping the island to open the app: the morph is not iPhone-like and not smooth | `makeScaleUpAnimation` from an accessibility service is ignored or replaced by many ROMs. The island also collapsed while the app grew, and the app showed its last screen before Now Playing mounted. | **Half done** (see T1) |
| R4 | Must be cheap on old phones and use the power of new phones | — | **Partly done** (`IslandBudget`, see T1/T7) |
| R5 | After minutes or hours, swiping left/right and search stop working until the island is switched off and on | `IslandView.locked` (pages and search are shut while locked) only refreshed from screen/unlock broadcasts, reading the keyguard at that instant. A missed or early `USER_PRESENT` left it "locked" forever. | **Code done, not run on a device** |
| R6 | Lyrics come very late after the swipe; online songs in general start late | Same as R1 (lyrics are fetched by JS). | **Code done, not run on a device** |
| R7 | Title and artist scroll together in the island; it feels wrong. Pace them the way the industry does. | `IslandView` drives both marquees from one clock (`marqueeClock`). | **Not started** (T2) |
| R8 | The light behind the island's lyrics should move twice as fast | — | **Done** (`FLOW_TEMPO = 2f` in `IslandView`) |
| R9 | The phone's triple-tap letters ↔ lines lyrics switch should also change the island's lyrics (now always line by line) | The island only receives line times and texts (`setLyrics(songId, atMs, texts)`). It has no word timings and no highlight mode. | **Not started** (T3) |
| R10 | Option: when nothing plays (even with the app closed), tapping the empty island shows a suggested song with "tap to play", not "Open LuvLyrics" | — | **Not started** (T4) |
| R11 | The whole app is slow on old phones (playback, scrolling, navigation). Plan what to move to Kotlin, or rewrite it all. | Research report is in §6 | **Plan recorded; separate project** |

---

## 2. Inherited changes (uncommitted at handoff creation)

### JavaScript (apps/mobile/src)
- `services/islandJsAwake.ts` (new): headless task `IslandJsAwake` that just waits `ms`, which keeps RN timers running. Registered in `index.ts` (`registerIslandJsAwake()`).
- `services/dynamicIslandSetup.ts`: `islandAwakeMs` (bounds the wait) and `islandSearchRows` (downloads first, marked, then online rows). Tests added in `dynamicIslandSetup.test.ts`.
- `hooks/useIslandLibrary.ts`:
  - A new query aborts the previous one, and an island search is capped at 12 s (`SEARCH_BUDGET_MS`).
  - Answers stream in through `searchOfficial(..., onPartial)`, each send with `done` false/true.
  - Playlist and downloads snapshots go out without a timer while the app is in the background (`later()`).
- `services/stream/officialSearch.ts`: optional 5th argument `onPartial`.
- `services/ytmusic/resolver.ts`: `resolveMany(..., onProgress)` reports matches in order, only once every earlier song has settled, so the list only grows at its end. Test in `ytmusic.test.ts`.
- `services/sync/onlineSongs.ts`:
  - **`instantStreamSong`**: a tapped online song plays at once through Allegra's stream route `${ALLEGRA_API_URL}/api/stream/<id>` (Gaana uses the whole ref). That is the same route Connect plays refs through, and it is registered with `StreamService`. The rest of the queue still resolves in the background windows.
  - A missed lookup is now retried after 10 min (it used to be blocked until restart, because `searchMusic` returns `[]` offline too).
  - The `playRun` guard stops a slow fallback lookup from replacing a newer pick.
  - Tests in `onlineSongs.test.ts`.
- `services/NativeDynamicIsland.ts`: `setIslandSearchResults(query, json, done = true)`.

### Kotlin (apps/mobile/android/app/src/main/java/com/lyricflow/app)
- `modules/IslandJsAwake.kt` (new): starts the headless task (20 s, renewed) on the UI thread; it is a no-op while the app is resumed.
- `modules/DynamicIslandModule.kt`:
  - Each instance keeps its own `pick`/`search`/`wake` lambdas, and `letGo()` clears only its own (on stop and destroy). An old instance can no longer null the new one's callbacks.
  - `setSearchResults(query, json, done: Boolean?)`.
  - Every pick, search and wake keeps JS awake.
- `island/IslandLibrary.kt`:
  - `setSearchResults` parses on the JS thread and applies on the main thread (it used to race with typing).
  - `searching` stays true until `done`.
  - New `onWake` / `wakeJs()`.
- `island/IslandView.kt`:
  - `host.checkLock()` runs on `expand()` and on touch-down while locked (R5).
  - `IslandLibrary.wakeJs()` runs on song change and on expand (R6).
  - Back in the search field closes the drawer (`backFromSearch`).
  - `closeSearch` no longer re-posts a search.
  - Redraws:
    - one `tick` runnable instead of stacked `postInvalidateDelayed` chains;
    - the light's field is recomputed at `budget.flowFrameMs`;
    - `FLOW_TEMPO = 2f`;
    - Reduce Motion holds the bars, light and marquee still.
  - `launchLook()` + `snapshot()` picture the island for the morph, and `budget` comes from the host.
  - `Host.openApp(link, look: IslandLaunch.Look?)` — the host now collapses the island.
- `island/IslandWindow.kt`:
  - `checkLock()`, plus a keyguard re-read 900 ms after any screen/unlock broadcast.
  - `updateFlags` treats `hiddenForApp` as hidden: an invisible island no longer takes taps over the app.
  - `geometry` is reset when `addView` is refused.
  - Back key handling in the search field.
  - `budget` is re-read on screen-on and Battery Saver changes.
  - New `openApp` drives `IslandLaunch` (`startApp(link, morphed)` with `FLAG_ACTIVITY_NO_ANIMATION`); `appShown()`; launch cleanup on screen-off and destroy; `setAppInFront(true)` → `launch.appResumed()`.
- `island/IslandBudget.kt` (new): LOW / MID / HIGH from RAM, cores, API level, Battery Saver and the fastest refresh rate. It sets the tick rate, the light's frame rate and the `richLaunch` flag.
- `island/IslandLaunch.kt` (new): the morph overlay (full-screen accessibility overlay that takes no touches):
  - the first frame is the island's snapshot;
  - one spring grows the shape to the screen, easing into the screen's own corner radius;
  - the cover travels to Now Playing's hero, which is 65% of the height, center-cropped, and on rich phones melted out at its bottom via a `ComposeShader`;
  - the island's light sits behind it;
  - the app starts after the first frame, and the overlay fades out (220 ms) once the app says it has drawn — or 650 ms after resume, or at most 2.6 s.
- `island/IslandService.kt`: `appShown()`.

**Continuation verification:** T0 passed: TypeScript, ESLint, all 825 Jest tests, x86_64 release Kotlin, and all 72 native unit tests. Device acceptance remains pending.

### Housekeeping done this session
- `main` was pulled (fast-forward of 22 commits). A stale `.git/index.lock` from Oct 17 was deleted.
- `stash@{0}` holds stale edits from `feat/lyrics-sync-serve`: an `app.json` version of 1.9.0 (main is already 1.12.0) and line-ending-only changes. It is safe to drop.
- `apps/mobile/node_modules` was installed with `npm ci` **from PowerShell**. Git Bash's `tar` breaks llama.rn's postinstall.

---

## 3. Audit findings (subagent, read-only) and their status

Most severe first. The finding numbers follow the audit report.

| # | Finding | Status |
|---|---|---|
| K1 | Background JS timers and `fetch` stall (R1/R6) | Done (keep-awake), verify on device |
| K2 | `playList` waits on 12 lookups (R2) | Done |
| K3 | Morph (R3) | In progress (T1) |
| 1 | `updateFlags` ignored `hiddenForApp`: an invisible island inside the app took taps and swallowed header taps for 8 s | Done |
| 2 | An online song that failed once was blocked until restart | Done (10 min retry) |
| 3 | No pick generation token: a slow online pick replaced a newer one | Done in `playList` fallback; island pick handler unchanged (instant path makes it rare) |
| 4 | Stacked `postInvalidateDelayed` chains (bars ran at 60–120 fps) | Done |
| 5 | The light's field was recomputed every frame while a title scrolled | Done (budget) |
| 6 | Search field window swallowed Back | Done |
| 7 | With JS not listening, an online playlist pick falls back to the widget link, which plays the playlist's **first** song (`widget/useWidgetSync.ts:125-129` reads downloaded rows only); download and search picks just open Library or the player | Open (T5) |
| 8 | Module callbacks shared globally; an old instance nulled the new one's | Done |
| 9 | `setSearchResults` race with typing | Done |
| 10 | No abort of superseded searches; no minimum length; 220 ms debounce | Abort done; minimum 2 characters and ~350 ms debounce open (T5) |
| 11 | The picked song shows for at most 6 s, then the card reverts silently; JS never reports a failed pick | Open (T5) |
| 12 | Every like or playlist change re-reads and re-sends **all** playlists (up to 300 songs each) as one JSON, parsed on the JS thread; `onlineVersion` is a sum, so +1/−1 in the same tick is missed | Open (T5) |
| 13 | `IslandArt` / `IslandThumbs` thread pools never shut down (each toggle leaks 3 threads) | Open (T5) |
| 14 | Thumbs load first-in, first-out from `onDraw`; a failed cover never retries | Open (T6) |
| 15 | Reduce Motion: bars, light and marquee kept moving | Done (the caret still blinks) |
| 16 | Refused `addView` left the next view without geometry | Done |
| 17 | Text sizes not reapplied after a font scale or density change (and a font-scale-only change returns early in `measure`) | Open (T6) |
| 18 | `closeSearch` re-posted a search | Done |
| 19 | Per-frame allocations: `blendedColors()` per row, clock strings 30×/s, placeholder letters | Open (T6) |
| 20 | Every player event re-measures text and kicks the frame loop; `blobSpeed` and `colorMix` keep the pill redrawing 2–3 s | Open (T6) |
| 21 | TalkBack cannot pick rows; the "Show playlists" accessibility action works on the lock screen (bypasses the locked rule) | Open (T5: guard the action when `locked`) |
| 22 | Island transport drives the local player directly, bypassing Connect / Listen-together routing (as the media notification does) | Open, design question for owner |
| 23 | `MultiSourceSearchService`: `Promise.race` timeouts never abort the fetch, Gaana has no signal, a 25 s timer is left pending per call, and there are unguarded `console.warn` / `console.error` calls (repo rules 9 and 10) | Open (T5) |
| 24 | The size and shape sliders cannot be seen changing while hideInApp hides the island in Settings | Open (T6: show the island while Settings → Dynamic island is open) |
| 25 | `resetPages` keeps `songsOf`, so a long swipe lands on an old playlist | Open (T6) |
| 26 | `ACTION_CANCEL` commits a drag (the shade pull can open search or switch pages) | Open (T5: cancel springs back instead) |

---

## 4. Todo, in order

### T0 — Get the current code compiling and green
- [x] From `apps/mobile`: `node_modules/.bin/tsc --noEmit -p .`, then `node_modules/.bin/eslint src index.ts`, then `node_modules/.bin/jest`. Verified 2026-10-19: tsc exit 0; ESLint exit 0 (78 warnings, 0 errors); Jest 97 suites / 825 tests passed (`C:/temp/allegra-island-t0-jest.log`).
- [x] Kotlin: `cd apps/mobile/android; .\gradlew.bat :app:compileReleaseKotlin -PreactNativeArchitectures=x86_64`. Run it in PowerShell with JDK 17 (set this shell's `JAVA_HOME` to the user-level Adoptium 17 path). Verified 2026-10-19 with JDK 17; fixed Surface(context) → Surface(). Remaining suspected spots compiled successfully: imports in `IslandLaunch.kt` (`RoundedCorner` is API 31; `context.display` is API 30 and needs a guard or `wm.defaultDisplay`) and the `ReactContext` cast in `DynamicIslandModule`.
- [x] `.\gradlew.bat :app:testDebugUnitTest` (island geometry, library and motion tests). Verified 2026-10-19: 72 tests / 10 suites, no failures or skips; includes budget rules and Robolectric search completion/race checks.

### T1 — Finish the morph (R3, R4)
- [ ] `DynamicIslandModule.kt`: add `Function("appShown") { IslandService.appShown() }`. Already present in the working tree at continuation; leave this box open until the native build and morph checks pass.
- [ ] `src/services/NativeDynamicIsland.ts`: add `appShown?: () => void` to the module interface, and `export const notifyIslandAppShown = () => call(m => (m.appShown ? m.appShown() : false))`.
- [ ] `src/screens/NowPlayingScreen.tsx`: when `openedOpen` (route param `instant`), call `notifyIslandAppShown()` after two `requestAnimationFrame`s from a mount effect, so the frame is on screen.
- [ ] Check in `IslandLaunch` that the snapshot bitmap from `Bitmap.createBitmap(Picture, w, h, HARDWARE)` draws with paint alpha, and that `IslandView.draw()` into a `Picture` does not trip on `clipPath` or shaders. If it fails, fall back to a software `ARGB_8888` bitmap (that code already exists for API < 28).
- [ ] The notch style (`IslandGeometry.hanging`) draws its top corners off-screen. Check that the morph's first frame still matches it, and use `outline.top - radius` if not.
- [ ] Reduce Motion (animator scale 0) skips the overlay and opens the app plainly. Confirm.
- [ ] Update `docs/dynamic-island.md` (the "Tap the cover or title to open LuvLyrics" paragraph and "Native integration") and `docs/enhance-dynamic-island.md` item 11: the morph is ours now, not the compositor's.

### T2 — Title and artist scroll at their own pace (R7)
- [ ] Research how Apple Music, Spotify and YouTube Music pace two marquees. Use `mcp__firecrawl__firecrawl_search`, cite the sources in the doc, and show the owner the rule before building.
  - Expected industry pattern: constant speed in px/s (not constant duration), so a longer line takes longer.
  - Expected industry pattern: the second line starts after the first with a stagger of about 1–1.5 s.
  - Expected industry pattern: each line rests independently at its start.
- [ ] `island/IslandMotion.kt`: give the title and the artist separate phases. Either use two clocks, or offset the artist's clock by a stagger and use a distance-based loop period. Keep the 4 s rest and the glide-home on pause (`sendMarqueeHome`). Extend `IslandMotionTest.kt`.
- [ ] `IslandView.drawNowPlaying` / `scheduleTicks` (`marqueeWait` for both lines) follow the new phases.

### T3 — Letters ↔ lines lyrics in the island (R9)
- [ ] Read how the app stores word or letter timings (`src/components/SynchronizedLyrics.tsx`, the lyrics line type, and the `settingsStore.lyricsHighlight` that the triple tap flips; see `player/lyricsButtonTaps`).
- [ ] `src/hooks/useIslandLyrics.ts` + `dynamicIslandSetup.islandLyricsPayload`: also send per-line word start times and texts when they exist (flattened arrays, or JSON), and send the highlight mode. Subscribe to `lyricsHighlight` so a triple tap updates the island at once.
- [ ] Native: `DynamicIslandModule.setLyrics` takes the words (optional arguments, so the call shape stays backward safe); add `setLyricsHighlight(mode)`; `IslandLyrics` stores the words.
- [ ] `IslandView.drawLyricLine` / `drawFullLyrics`: in letters mode, sweep the sung line by word progress. Clip the text at the swept x with a soft edge; build the shader once and move it with a local matrix, with no per-frame allocation. Lines with more than 24 words light as a whole (same rule as `MAX_SWEEP_WORDS`). Unit-test the progress maths in Kotlin.

### T4 — Idle island suggests a song (R10)
- [ ] Settings → Dynamic island: a new switch, "Suggest a song when nothing plays" (default on). Add it to `IslandPrefs` and `DynamicIslandSettings.tsx`, and add `setSuggestWhenIdle` to the module, `parseIslandStatus` and its test.
- [ ] JS sends a suggestion snapshot (`setSuggestion(json)`: id, title, artist, cover, audioUri where known, and its source list): the last played song, else the first Quick pick. Persist it natively (SharedPreferences) so it survives the app being closed or the process restarting.
- [ ] Idle card (`hasSong == false`): the suggestion's cover, title and artist, with a play button, instead of "Open LuvLyrics". The compact idle pill stays empty, as today.
- [ ] Tap play:
  - if JS listens: `IslandLibrary.pick("island:suggestion", id)` plus keep-awake, and JS plays it like a pick;
  - if JS is not running: play natively without opening the app. Investigate `playback/PlayerResume.kt`, `services/PlaybackService.kt` and `QueueEngine` / `QueueSnapshot` (restore the saved queue and play). Starting a foreground service from the background has Android 12+ rules; test whether a Media3 controller started from the accessibility service can start it.
  - only if both fail: open the app with a play link.
- [ ] Docs and tests.

### T5 — Remaining audit fixes, the important ones
- [ ] #7: fallback links when JS is not listening. `widget/play` must load online playlist rows through `loadPlaylistSongs`; download and search fallbacks need a link that actually plays the song.
- [ ] #10: minimum query of 2 characters; `SEARCH_DEBOUNCE_MS` 220 → 350.
- [ ] #11: a pending state on the card until the picked song is the player's item; an `onIslandPickFailed` event when `playList` resolves false.
- [ ] #12: snapshot only the playlists that changed, or send songs lazily when a playlist is opened (a new `onIslandBrowse(playlistId)` event); replace the `onlineVersion` sum with a stable key.
- [ ] #13: `IslandArt.release()` / `IslandThumbs.release()` shut their executors down, called from `IslandWindow.destroy()`.
- [ ] #21: `performAccessibilityAction(island_playlists)` and `island_open_app` do nothing while `locked`.
- [ ] #23: `MultiSourceSearchService`: abort the fetch on timeout (`AbortController`), give Gaana a signal, clear the timers, and guard logs with `__DEV__`.
- [ ] #26: `ACTION_CANCEL` springs the drag back instead of committing it.

### T6 — Smaller audit fixes (time allowing)
- [ ] #14 thumbs: newest first, cancel off-screen loads, retry failures after a while.
- [ ] #17 font scale and density changes reapply text sizes.
- [ ] #19 per-frame allocations.
- [ ] #20 player events do less.
- [ ] #24 show the island while its settings are open.
- [ ] #25 `resetPages` drops `songsOf`.

### T7 — Wrap up
- [ ] Bump `expo.version` in `apps/mobile/app.json`: 1.12.0 → **1.13.0** (features). This is required for anything that rebuilds the APK.
- [ ] Update `apps/mobile/docs/dynamic-island.md`, and add a line to `.planning/LEARNING-LOG.md` about the background JS timer stall. That one will bite other background features.
- [ ] Commit in conventional-commit steps (`fix(mobile): …`, `feat(mobile): …`), with no AI attribution footers (apps/mobile/CLAUDE.md). Open a PR to `main`; the owner reviews it before merge.

---

## 5. Testing plan

### Automated, every step
```
cd apps/mobile
node_modules/.bin/tsc --noEmit -p .
node_modules/.bin/eslint src index.ts
node_modules/.bin/jest
cd android
.\gradlew.bat :app:testDebugUnitTest
```
New tests to keep or add:
- `onlineSongs.test.ts`: instant start, Gaana ref, the 10-minute miss retry.
- `ytmusic.test.ts`: `resolveMany` progress order.
- `dynamicIslandSetup.test.ts`: `islandAwakeMs`, `islandSearchRows`, and the lyrics payload with words (T3).
- Kotlin:
  - `IslandBudget.pick` rules: LOW for low RAM, Battery Saver or API < 29; HIGH for 120 Hz with 8 GB; MID for an M31's numbers;
  - marquee phases (T2);
  - word sweep progress (T3);
  - `IslandLibrary.setSearchResults` with `done`. Verified with Robolectric and a paused main looper: partial answers keep searching true until done; a queued answer for an old query is rejected after a new keystroke.

### Build and install on the emulator (an `emulator-5554`, Android 17, x86_64, is running on this PC)
```
cd apps/mobile/android
.\gradlew.bat :app:assembleRelease -PreactNativeArchitectures=x86_64
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" -s emulator-5554 install -r app\build\outputs\apk\release\app-release.apk
```
The release build is signed with the debug key (`build.gradle`), so it installs over the debug build already on the emulator (1.9.0). Then enable the service:
```
adb shell settings put secure enabled_accessibility_services com.lyricflow.app/com.lyricflow.app.island.IslandService
adb shell settings put secure accessibility_enabled 1
```
Check the exact component name in `AndroidManifest.xml`. In the app: Settings → Dynamic island → Show the island.

### Manual checks (emulator first, then the owner's phone)
Go Home before each one, so LuvLyrics is in the background: that is the case that broke.
1. **Search (R1).**
   - Pull down from the top of the open card and type a song.
   - Downloads show at once, the first online answers within ~2–4 s, and more join under them.
   - The footer says "Searching online…" until the last answer.
   - Type a new query mid-search: the old answers never show under it.
   - Logcat: `adb logcat | Select-String "IslandJsAwake|HeadlessJsTaskContext|LyrFlowIsland"`.
2. **Playlist pick (R2).**
   - Swipe left, open a playlist with online-only songs, tap one.
   - The old song stops within a fraction of a second, and the new one is audible in about 1 s on good Wi-Fi.
   - Skip next a few times: the following songs are in the queue.
   - Repeat with the app in front from the playlist page.
3. **Lyrics (R6).** In the background, let a song with synced lyrics advance to the next (or skip). Open the island and pull for lyrics: they are there within a few seconds, not only after opening the app.
4. **Stuck lock (R5).**
   - With "Show on the lock screen" on: lock, unlock with a PIN; lock, then wake and unlock quickly; lock, leave it 10 minutes, unlock.
   - Each time, swipe left/right and pull for search: both work.
   - Emulator: `adb shell input keyevent 26` to toggle the screen, `adb shell locksettings set-pin 1234`.
5. **Morph (R3).**
   - From the open card tap the cover, and from the closed pill long-press.
   - Expected: no flash of the old screen, no double island, the shape's corners end on the screen's corners, the overlay leaves cleanly over Now Playing.
   - Repeat with the app killed (`adb shell am kill com.lyricflow.app` while the island still shows), and with Animator duration scale 0 (Developer options), which should give a plain open.
   - Record: `adb shell screenrecord /sdcard/morph.mp4`.
6. **Performance (R4).**
   - `adb shell dumpsys gfxinfo com.lyricflow.app reset`, then open and close the island 10×, then `adb shell dumpsys gfxinfo com.lyricflow.app`. Compare janky frames and the 90th/95th percentiles against `main`.
   - Check the bars tick at the budget rate: with the pill showing and music playing, `dumpsys gfxinfo` frame counts over 10 s should be about 300 (MID), not 600+.
   - Turn on Battery Saver: the budget drops to LOW at the next screen-on.
7. **Marquee (R7).** A long title with a long artist: they start staggered, move at the same px/s, and rest independently. On pause both glide home.
8. **Letters ↔ lines (R9).** Triple-tap the lyrics button in the app: the island's lines change mode at once, and the sung line sweeps word by word in letters mode.
9. **Idle suggestion (R10).** Stop playback, swipe the app away from recents, tap the empty island: the suggestion card shows, and Play starts it without the app opening. Turn the setting off: the old behaviour returns.
10. **Regressions.**
    - The three playback invariants (root `CLAUDE.md`).
    - The Range rule is untouched (no API change).
    - Connect: a pick while another device plays still routes there.
    - TalkBack on the island.
    - Landscape hides it.
    - The probe script still passes: `apps/mobile/scripts/probe-dynamic-island.ps1 -Serial emulator-5554 -OutDir C:/temp/island-probe -Record`.

On the owner's Galaxy M31 (Android 12, 60 Hz), repeat 1, 2, 5 and 6. On the owner's phone, keyboard focus in the overlay, the morph and per-ROM behaviour can only be judged there.

---

## 6. Kotlin migration plan (R11)

A research subagent was launched in the session that wrote this file. It reads the app, maps where playback, scrolling and navigation lose time, and recommends one of three paths: (A) keep RN and fix the hot spots, (B) hybrid native screens, (C) a full Kotlin + Compose rewrite. Its report is appended below when it lands. If this section is still empty, rerun that research before starting any migration work. **It is a separate project from this branch**: do not mix migration work into `fix/dynamic-island-audit`.

### Research report (read-only; nothing measured on a phone, so every gain is an estimate)

**Verdict: don't rewrite.** Most of the slowness on an M31 comes from our own choices, not from React Native.
- Do **A** now (2–4 weeks).
- Do **B** for the player surface only, and only if the M31 still misses these targets after A:
  - under 5% janky frames scrolling Library (500+ songs) and Stream;
  - under 150 ms from tap to the first player-sheet frame;
  - under 300 ms from tap to audio for a download.
- **C**, a full Kotlin + Compose rewrite, is 6–9 months (Echo is about 277k lines of Kotlin). It would mean rewriting `packages/shared` and `packages/connect` in Kotlin and keeping them in step with the website.

**Hot spots, biggest first**
1. **The M31 counts as a `normal` phone.**
   - `src/utils/performanceTier.ts:20` sees 6 GB, 8 cores and API 31, so none of the low-end savings apply.
   - It gets the full-screen shader at 60 fps while playing (`utils/visualBudget.ts`), live blurs in every sheet (`allegra/Frosted.tsx:40`, `LiquidGlass.tsx:39`), the spinning pill disc (`PillPlayer.tsx:65`), and three copies per word in the lyrics sweep (`SynchronizedLyrics.tsx:361`).
   - The default looks (`settingsStore.ts:221-225`: `appBackground: 'shader'`, `miniPlayerBackground: 'glow'`) keep two Skia canvases redrawing on every tab while music plays.
2. **The player is a navigation route, rebuilt on every open.**
   - `RootNavigator.tsx:77-90`, opened by `navigation/playerSheet.ts:23`.
   - Each open mounts NowPlayingScreen, its controls, the lyrics, the Skia backdrop and five sheets.
   - At the same moment the tab underneath re-renders, because its focus flips.
   - Echo keeps its player sheet composed all the time. This is the likeliest cause of "navigation feels slow".
3. **`player/AppleBackdrop.tsx:52,91` runs a full-screen sigma-70 blur** on every redraw (cover swipe, hero fade, song cross-fade).
4. **`allegra/Artwork.tsx:133` always mounts `GeneratedArtwork` under a real cover**: about 15 native nodes per list row.
5. **Lists re-render whole screens.**
   - Library: inline header and `renderItem`, re-rendered on `isPlaying`, `currentSongId` and scroll crossings; it is a FlatList.
   - Stream: one 757-line page in a `ScrollView`, subscribed to the whole `currentSong`.
   - Search: the same pattern.
6. **A play tap waits behind React before the native player gets the command.**
   - `playerStore.ts:570`: `set()` re-renders subscribers before `pushQueue`.
   - `PlayerContext.tsx:73-74` adds a `setTimeout(0)` hop, which is about one frame in bridgeless mode and stalls in the background.
7. **Reanimated 4 is in its slow Fabric mode:** `ANDROID_SYNCHRONOUSLY_UPDATE_UI_PROPS` is off.
8. **Smaller items:**
   - the Hermes bundle is 6.2 MB, about 2.4 MB of it Sentry (replay code included though replay is off);
   - `settingsStore.updatePlaylistHistory` rewrites the whole settings blob on every song change;
   - the lyrics resume pill is a live blur over moving lyrics.

**Already good:** no synchronous SQLite; position updates are a shared value; `freezeOnBlur` is on; the queue engine is native.

**Order of work (separate branch, e.g. `perf/m31-hot-spots`)**
- **Phase 0 (2–3 days): baseline on the M31.**
  - Script it with `lyricflow://` links plus `adb shell input swipe`: scroll Library and Stream, open and close the player ×10, lyrics on, play from search.
  - Record `dumpsys gfxinfo` framestats, a Perfetto trace (`gfx view sched am`) and a Hermes profile.
- **Phase 1 (1–2 weeks): quick wins, in this order.**
  1. **Tier check:**
     - add the SoC or max CPU frequency to `StartupModule.deviceProfile`, or step down at runtime when the UI p90 frame time stays over 18 ms for 10 s;
     - add a Settings "Reduce effects" switch;
     - use the `glass`/`black` looks on the low tier.
  2. **Reanimated flag:** `"reanimated": { "staticFeatureFlags": { "ANDROID_SYNCHRONOUSLY_UPDATE_UI_PROPS": true } }` in `package.json`. It needs a native rebuild, and Pressable inside transformed views can drop `onPress`, so run the player probe.
  3. **Play before render:** call `pushQueue` before `set()` in `playerStore.ts:570-604`, and drop the `setTimeout(0)` in `PlayerContext.tsx:73-74`.
  4. **Cheap covers:** `Artwork` mounts `GeneratedArtwork` only with no URI or after a failure.
  5. **Lists:**
     - Library: memoised header, stable `renderItem`, `isPlaying` moved into GlassDeck, then FlashList v2.
     - Stream: select only the fields it reads, and memoised shelves.
  6. **Backdrop:** blur once per song into a small cached image.
  7. **Smaller:** trim Sentry's replay and feedback code out of the bundle; move or debounce `playlistHistory` out of the settings blob.
- **Phase 2 (2–3 weeks): the player stays mounted.**
  - Render NowPlaying permanently beside the mini player, driven by `navigation/sheetProgress.ts`, frozen while closed. Deep links map to "open sheet".
  - Files: `RootNavigator.tsx`, `navigation/playerSheet.ts`, `NowPlayingScreen.tsx`, `ConnectRemotePlayer.tsx`, `hooks/useDeepLinks.ts`.
- **Phase 3 (only if the targets are still missed): native player, step by step.**
  - First a native lyrics view (Compose or a custom View like the island's), fed straight from Media3's position. Then the backdrop and controls.
  - JS keeps queue, search, sync and Connect.
  - Expo UI `ExpoComposeView` is stable in SDK 56; the app is on 54. Watch expo#49964 (view ids collide with react-native-screens).
- **Separately:** an upgrade to RN 0.84+ (Hermes V1). Its gains are blog claims; unverified here.

**Unverified:** every gain percentage; whether Skia downsamples internally for a sigma-70 blur; worklets 0.7.4 with Reanimated 4.1.6; the M31's SoC model string; Convex Auth support on Kotlin.

**Sources:**
- [Reanimated feature flags](https://docs.swmansion.com/react-native-reanimated/docs/guides/feature-flags/)
- [Reanimated performance guide](https://docs.swmansion.com/react-native-reanimated/docs/guides/performance/)
- [reanimated#8250](https://github.com/software-mansion/react-native-reanimated/issues/8250)
- [RN 0.84 release](https://reactnative.dev/blog/2026/02/11/react-native-0.84)
- [Expo UI in SDK 55](https://expo.dev/blog/expo-ui-in-sdk-55-jetpack-compose-now-available-for-react-native-apps)
- [expo#49964](https://github.com/expo/expo/issues/49964)
- [Convex Android client](https://docs.convex.dev/client/android/overview)
- The local Echo clone at `C:\Users\nithy\Desktop\aclones\Echo music` (`MainActivity.kt:691`)
