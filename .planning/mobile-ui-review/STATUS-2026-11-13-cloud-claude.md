# Status 2026-11-13: cloud session (integration, menu, playlist header, scan, cover)

Branch `claude/dreamy-mccarthy-eo1bl1` (PR 90, stacked on PR 89). Backup of `main` before any of this:
branch `backup/pre-kotlin-migration-2026-11-12` (= `e2699dc`). Nothing below touches `main`.

## What changed, by slice

| Slice | Version | PR | Evidence in hand | Not proved |
|---|---|---|---|---|
| Album and artist screens | 1.53.0 | 89 | tsc 0, eslint 0 errors, jest 187 suites / 1491 tests, CI green incl. Kotlin unit tests, APK build, emulator launch gate | the new screens on a screen |
| Discovery polish merged onto 89 | 1.54.0 | 90 | jest, tsc, eslint locally; CI | the Kotlin native transport compiles in CI (see below) but its behaviour is unseen; Quick Picks, Daily Discovery, search categories on a screen |
| One song menu | 1.55.0 | 90 | `songActionRows.test` (model, 12), `MiniSongMenu.test` (presenter), jest | the sheet from a playlist row, a search row, the mini player, Now Playing ellipsis |
| Playlist header | 1.56.0 | 90 | `findReveal.test`, source guards | the pull-down on a device (Android overscroll, FlashList scroll restore, short lists) |
| Scan result card | 1.57.0 | 90 | `scanFlow.test`, `scanResolve.test`, `sharedCache.test` | a real scan of an app-made code; the animation |
| Classic bar skip buttons on the main thread | 1.59.0 | 90 | `miniPlayerSurface.test`, jest | a tap on a device |
| Mini player swipe skips in Kotlin (setting, off by default) | 1.60.0 | 90 | `MiniSwipeTest.kt` and `nativeSwipeSkip.test.ts` on the same cases, jest, CI | a swipe on a device; double skip or missed skip |
| Finger-tracked cover and deck | 1.58.0 | 90 | `coverGesture.test` (rules), source guards, worklet-safety test | gesture feel; 60 fps; interrupting mid-turn |

## Decisions taken (owner defaults from the brief)

- The song menu is a bottom sheet (same look as the old mini-player menu), not a dropdown.
- One model (`components/player/songActionRows.ts`), one presenter (`MiniSongMenu`). Library actions come in as a
  `LibrarySongHandlers` bag from `useSongActions`. `LibraryBottomSheet` and `PlayerMenu` are deleted.
- The mini player opens the sheet by long press (the album branch's decision, "no ••• on the mini player"); Now
  Playing's ••• opens the same sheet. If the owner wants a ••• on the mini player again it is one line in `PillPlayer`.
- Pull-down reveal also focuses the input. It uses the list's own scroll (rests past the bar, a pull scrolls it into
  view), not a custom gesture, so it is finger-tracked and interruptible for free.
- Scan result does not auto-save; the card has Save and Open (Play for a song). A playlist saves a copy to the
  account; a song downloads. A resolved playlist is cached for a minute so Open does not ask the server again.

## Things that were wrong and are fixed

- Four tests were already stale on `feat/discovery-polish` (play button names, feed section names, Stream save
  action, design-guard baseline).
- `CatalogAlbum` was registered twice after the merge; the in-Stream search sections moved out with discovery.

## Kotlin: what was and was not verified

Two local Gradle attempts in the cloud container stopped at dependency resolution (HTTP 429 from Maven Central), so
they proved nothing. CI did compile it: on PR 90 at `93bbdaa` the workflows CI, Mobile CI (Kotlin unit tests) and
Mobile APK (Build APK, then "Opens on an emulator", the launch gate) all passed. That covers the discovery branch's
`NativeTransport*` files compiling and the app launching on an emulator. It does not show any screen working.

## Owner device checklist (CI APK from PR 90, "LuvLyrics-apk" artifact)

1. Song menu: long press a row in Library, in a playlist, in Search, in Stream; tap Now Playing's ellipsis; long press the
   mini player. Same sheet each time, Download is the big first button, categories read in order, Delete is last.
   From a playlist the sheet has "Remove from this playlist".
2. Playlist header: open a playlist. No find bar, back arrow and ellipsis are plain icons. Pull down: the bar slides in
   with the finger; let go past halfway and the search opens with the keyboard. A short playlist still hides the bar.
3. Scan: Search, camera. Scan a code from Share. The frame locks, a card shows the name, Save and Open work. Try a
   dead code (message, scanner rearms) and Airplane mode.
4. Cover: double tap the playlist cover, and drag across it sideways. It turns under the finger and springs. Swipe the
   deck, flick it, grab it mid-spring. Reduce Motion on: the turn is a fade.
5. Native transport controls on the mini player and Now Playing (HEVC canvas video, release build) as before.
6. Settings, Playback, "Native mini player swipes": switch it on, swipe the mini player left and right (it should skip once
   per swipe, the title follows the finger), swipe up (still opens the player), long press (song menu), tap (opens
   the player). Switch it off and compare. If it double-skips or misses, turn it off and tell me which.

## Full-Kotlin request

See `docs/` and the reply to the owner: the repo already migrates screens to native Kotlin one vertical slice at a time
(`.planning/performance-kotlin/HANDOFF-ANDROID-NATIVE-UI.md`, 16 slices). A big-bang rewrite of every screen cannot be
proved without a device, so it was not attempted; the backup branch above exists so a rewrite can start safely.
