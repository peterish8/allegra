# V6 verification matrix

Branch `fix/mobile-v6-verification`, PR https://github.com/peterish8/allegra/pull/59, version 1.38.0.
Baseline reproduced on the `probe` emulator (Android 16 image, 720×1440 px, density 2 = 360×720 dp, font 1.0)
with the published 1.37.1 APK (manifest commit 473c4d8). Surfaces are kept apart: **source** (code + unit tests),
**emulator**, **device** (a physical phone), **audible**, **install**. "Pending" means not executed.

## Owner-reported corrections

| ID | Finding (reproduction) | Cause found | Fix | Tests | Retest |
| --- | --- | --- | --- | --- | --- |
| UI-01 P0 | 1.37.1 emulator, Stream with a song: chips at y 104–152 dp, "Jump back in" heading from 120 dp, so it overlaps the chips by 32 dp. | FlashList 2.2.2 places item 0 from the header offset it measured; the chip row was `ListHeaderComponent`. | Chips became the feed's first item. | `StreamScreen.layout.test.ts` feed-measurement guards | Emulator on the PR APK: pending |
| UI-02 P0 | Owner capture: Up next rows over All/Familiar/Discover. | `NativeQueueListView.onDraw` painted rows partly above its own top, and React Native parents don't clip children. | `canvas.clipRect` to the view's own frame; filters are one `Segmented`. | Kotlin compiled by CI; no JVM test for drawing | Emulator: pending |
| UI-03 P1 | 1.37.1 emulator: a one-row grid (2 items) followed by a 108 dp blank before Quick picks. | Stale cell size: tiles sized as 50% of a cell whose width FlashList doesn't enforce until measured, plus Reanimated `entering` inside recycled cells. | Definite tile widths from the window; no `RiseIn` in feed cells. | `shortcutGrid.test.ts`, layout guards | Emulator: pending |
| UI-04 P0 | Owner capture "Day Of Sun   An" beside the actions. | Marquee loop in a lane narrowed by three buttons, inside a fixed 30 dp `overflow: hidden` box. | Title wraps to 2 lines with an ellipsis, no marquee; lines use `minHeight`. | `nowPlayingTitle.test.ts` | Emulator, 200% text: pending |
| UI-05 P1 | Tile titles truncated tightly ("Monica (From "Coolie") (Ta..."). | 15 pt regular, 2 lines, beside a 56 dp cover. | Board layout: 13 pt semibold, 2 lines, plus the artist on 1 line; one column from 130% text. | `shortcutGrid.test.ts` | Emulator: pending |
| UI-06 P1 | Dropdown/menu review. | Connect dropdown is a `Sheet` (48 dp+ trigger, Back closes, closes on blur/rotation/sign-in change). **F-6a:** a closing modal `Sheet` keeps its native Modal window until the close spring rests, so taps on the page are swallowed for that time. | F-6a not changed yet: measure the close duration on a device first. | None | Pending |
| UI-07 P1 | Sheet, scroll and gesture review. | `Sheet`: list-at-top drag, flick, settle and reopen-while-closing are all handled; the Up next pan fails on handles and scrolled lists. | No change needed found in source. | Existing sheet tests | Device gestures: pending |
| UI-08 feature | Requested animated header glow. | — | `ui/HeaderGlow`, `ui/headerGlowMath`, `hooks/useHeaderGlow`; Stream + Library. | `headerGlowMath.test.ts`, Stream binding guard | Emulator clip, frame timing on hardware: pending |
| UI-09 P1 | Owner: mini player and nav too tall. 1.37.1 emulator: seek 24 + row 56 + nav 64 + inset 24 = 168 dp (23% of 720 dp). | — | 16 + 48 + 56 = 120 dp above the inset (−24 dp of list); 40 dp cover; native bar 56 dp. | `v6Shell.test.ts` | Emulator before/after: pending |
| UI-10 P1 | Owner: restore left/right song swipes. | `PillPlayer` ignored `onPrevious` and had no horizontal skip gesture. | `playback/miniSwipe` thresholds; Race with the open pan; TalkBack actions. | `miniSwipe.test.ts` | Emulator slow drag/flick/cancel: pending |

## Broader smoke (mobile-smoke.yml)

| Run | Result | Reading |
| --- | --- | --- |
| 41306254650 (main 1b72928, pre-V6) | C rounds 2–5 and D failed (12 checks) | Already red before V6. |
| 42126270194 (main 473c4d8, 1.37.1) | C rounds 2–5, D and E failed (15 checks) | Diag: `register 1 → consume 1 → unregister 1`, then `no focused handler`; round-2 screenshot shows the launcher. The probe reopens by tapping `Now playing:.*`, but V6's label was `<title> by <artist>. Open player`, so no reopen happened and the next Back left the app. E reads the same label. |
| 42177973408 (this branch) | Running | Decides whether C/D pass with the label restored; D (screen-off media keys) was red pre-V6 too and stays open until this run is read. |

## Device, accessibility, performance, install

| Check | Status |
| --- | --- |
| Physical phone playback, media keys, Connect/LuvLink audible ownership | Pending: no phone attached (`adb devices` lists only the emulator) |
| 200% text at 360/393/430 dp | Pending |
| TalkBack order, mini-player Next/Previous actions, sheet focus return | Pending |
| Header glow frame timing (drift + scroll) on representative hardware | Pending |
| Playlist load timing baseline | Pending; no optimisation made without numbers |
| Old signed build → in-app download → install 1.38.0, data kept | Pending |

## Round 7 (1.40.0, owner approved the canvas boards on 2026-11-06)

Boards: canvas page "Round 7: revision brief (for approval)" (https://claude.ai/artifact/UGiYJ1UaRjWA66qTFjsmHT).
Owner: "do all together … version bump minor", so items 1–9 ship in one change instead of one PR each.
Source gate in a cloud session: `npm ci` + `npm run ci` in `apps/mobile` (Jest in band): 140 suites, 1,111 tests, lint
0 errors. No emulator or phone in that session: every runtime cell below is **pending** until checked on a CI APK.

| Item | Source change | Tests | Emulator / device |
| --- | --- | --- | --- |
| 5 Playlists background | Embedded `PlaylistsScreen` renders a transparent `View`, not its own `AppScreen` | `PlaylistsScreen.layout.test.ts` | Pending |
| 9 + lists rule | One row: 56 tall, 44 cover, 6dp corners, title and artist one line each; Browse rows use it; Up next native row 56/44/6 | `ui/round7.test.ts` | Pending (incl. 200% text) |
| 9 Download | Restored beside ⋮ on Stream (Quick picks, results) and Search; own 48dp target, no slop | `ui/round7.test.ts` | Pending: tap Download never plays the row |
| 8 Bottom surface | Mini player + nav share one `ShellMaterial` (no seam), translucent tint, opaque fallback | `shellMaterialMath.test.ts` | Pending: look over scrolling rows, Reduce Transparency, Battery Saver |
| 3 Navigation | Selected tab = foreground only (Kotlin `drawV6` + JS fallback); D-pad focus ring | `ui/round7.test.ts` | Pending: keyboard focus ring |
| 1 Chips | Frosted capsule, check on chosen, pressed state, focus ring | `ui/round7.test.ts` | Pending |
| 4 Play / Shuffle | Filled Play + compact (40 in 48) Shuffle on artist, playlist, album | `ui/round7.test.ts` | Pending: 360dp, 200% text |
| 2 Menus | `SheetIdentity` + `SheetDivider` + chevron rows on stream/library song sheets and the mix sheet | `ui/round7.test.ts` | Pending: drag/scrim/Back/× dismissal, TalkBack focus return |
| 6 Voice | Mic + listening panel in the Search field; gesture copy; Cancel/Stop; top match; problems stay in the field | `voiceFieldCopy.test.ts`, `voiceSearchStore.test.ts` | Pending: hold vs tap, permission flow, Reduce Motion |

### Round 7 CI and release (main `666ac0a`, PR #63)

| Check | Result |
| --- | --- |
| PR #63: Mobile CI (Jest + Kotlin unit tests), CI, Mobile APK build, "Opens on an emulator" launch gate | All passed |
| main: Mobile CI, CI, Mobile APK (build, launch gate, publish) | All passed |
| `apk-latest` | **LuvLyrics 1.40.0**, built from `666ac0a`, published 2026-11-06 17:11 UTC |
| Mobile smoke test 42256072092 (main `666ac0a`) | A (cover) and B (lyrics) all ok; **15 failed**: C rounds 2–5 (player not reopened, 0 app nodes), D (screen-off media keys), E (restored queue). The same 15 failed on 1.39.0 (run 42182112546) and 1.37.1 (42126270194): existing failures, not new in Round 7. Open: C's reopen after round 1 and D/E |
| Emulator screenshots of the Round 7 screens, device, TalkBack, 200% text | Pending (no emulator or phone in the cloud session) |

## 1.41.0 owner requests (2026-11-06)

Source gate in the cloud session: `npm ci` + `npm run ci` in `apps/mobile` (Jest in band): 147 suites, 1,157 tests,
lint 0 errors. No emulator or phone: every runtime check below is **pending**.

| Request | Source change | Tests | Device / emulator |
| --- | --- | --- | --- |
| Widget: 4 pinned playlists, tap plays in the background | Playlists widget grid; `PLAY_PLAYLIST` in the headless task → native queue engine (`widget/playPinned`) | `widget/pinnedPlaylists.test.ts` | Pending: tap with the app closed starts playback and the media notification |
| Hold Library 2 s → chosen playlist | Kotlin `NativeTabBarView` hold timer + `onTabLongPress`; JS fallback `delayLongPress` | `pinnedPlaylists.test.ts` (tabHold) | Pending |
| Library opens on a chosen tab | `libraryStartTab` setting | `pinnedPlaylists.test.ts` | Pending |
| Offline playlist download | `services/offlinePlaylist(Plan)`, `songs.playlist_only`, dedupe in `BackgroundDownloader` | `offlinePlaylistPlan.test.ts`, `downloadQueueMerge.test.ts`, `database/offlinePlaylistQueries.test.ts` (real SQLite) | Pending: download, airplane mode playback, remove download |
| Green accent removed | JS, widget and Kotlin views → V6 whites | grep clean | Pending visual |
| Up next capsules | `Segmented` frosted capsule; Shuffle compact capsule | — | Pending |
| Island narrower | width 40–150% (`IslandGeometry.compactFloor`) | `IslandGeometryTest` (JVM, CI) | Pending |
| Full-row press | `SongRow` row-wide pressed layer | — | Pending |
| Mini player: 12dp band, Apple-style scrub, glow background | `MiniScrubber` (UI thread), `MiniPlayerGlow` | `miniScrub.test.ts`, `round7.test.ts`, `v6Shell.test.ts` | Pending: feel on a phone |
| Luvs closed the app / nothing on return | Native pool capped (3, 1 on low RAM), released on memory pressure, coroutine guard; empty feed retried on every visit | `LuvsWarmPoolTest` (JVM), `luvsLanes.test.ts` | Pending: the original crash had no log; confirm on the phone that showed it |
| Memory and performance | LRU caches, `getPlaylistSongs` 2 queries (was 2 per song), lighter widget sync | `lruMap.test.ts`, real-SQLite test | Pending: memory profile on a device |
| Scrolling song lines | Now Playing title full size, slow scroll, 5 s rest; artist 16pt, 3 s rest; mini player one line "Song • Artist" | `nowPlayingTitle.test.ts`, `playerMarquee.test.ts` | Pending: look on a phone |

## 1.41.1 canvas tap crash (owner report, 2026-11-07)

| Finding | Cause found | Fix | Tests | Device |
| --- | --- | --- | --- | --- |
| Apple Music style, song with a canvas: tapping the full canvas down to the card closes the app on some phones | `useVideoPlayer(source)` rebuilds the player when the source changes and releases the old one during render while the mounted VideoView's TextureView still draws it; the tap set the source to null (the same path ran on lyrics open and song changes). No crash log from the phones; the cause is read from expo-video 3.0.16's source, not from a log | `CanvasVideoLayer` keeps one player (`createVideoPlayer(null)`), switches clips with `replaceAsync`, clears a gone clip only after the view unmounted, releases the player 1 s after the layer unmounts | `canvasPlayer.test.ts` | Pending: tap full ↔ card repeatedly with a canvas, open/close lyrics, skip songs, on the phones that crashed |

## 1.41.2 island gone after a restart (owner report, 2026-11-07)

| Finding | Cause found | Fix | Tests | Device |
| --- | --- | --- | --- | --- |
| After the phone restarts the system island is gone; switching it off and on in the app brings it back | Android re-binds `IslandService` after boot, often while the keyguard is still leaving. `IslandWindow` read "locked" while being built and registered its unlock receiver only afterwards, so an unlock in between was never heard (hidden for the lock until rebuilt); a window refused that early was never retried ("try again on the next refresh", which only the app's toggle sent). Read from the source; no log from the phone | Window re-reads the lock 0.3/0.9/2/5 s after it is built and on every app refresh; the service listens for unlock / user-unlocked / screen-on itself and retries a refused or failed window with backoff (`IslandRecovery`) | `IslandRecoveryTest` (JVM, CI) | Pending: restart the phone with the island on (with and without a PIN), unlock, check it shows without opening the app |

## 1.41.2 audit: playback stopping, accessibility, backend (2026-11-07)

| Finding | Cause found | Fix | Tests (CI) | Device |
| --- | --- | --- | --- | --- |
| Music stays stopped after the connection drops (lift, tunnel) | `PlaybackService` retried a network error 4 times (~15 s) then paused for good; JS's own retry needs the app awake and a connection | Native resume when Android reports a network again within 10 min, unless play/pause was pressed or the song changed (`playback/ResumeOnline.kt`) | `ResumeOnlineTest` (JVM), `nativeRegressions.test.ts` | Pending: airplane mode mid-stream for 1 min, then off |
| Widget / island tap with the app closed could do nothing | `awaitEngine` called a bare `startService`, which Android 8+ refuses from the background (IllegalStateException, uncaught) | Falls back to binding the service (allowed from the background); Media3 promotes it to foreground once it plays | `nativeRegressions.test.ts` | Pending: swipe the app away, tap a pinned playlist on the widget |
| TalkBack read "Button" for the classic mini player's cover, previous, play/pause, next, like, video buttons, the video player's buttons and the lyrics search's close; dialog scrims read as nameless buttons; menu items had no role | No labels / roles | Labels, roles and states; scrims hidden from TalkBack (Back closes) | `accessibilityNames.test.ts` (compiler walk over every screen: fails on any unnamed pressable) | Pending: TalkBack pass |
| Spotify sign-in "failed" with no reason; a phone sign-in that failed landed on the website | The API callback swallowed every error (no log) and always redirected to the website on failure | Logs status/reason; redirects with `reason=not_allowed\|expired\|unavailable\|failed` back to where it started; website and app explain it (`spotifyFailureMessage`) | `spotifyCallback.test.ts` (API, supertest), `spotifyFailure.test.ts` (shared) | Pending: connect a Spotify account not on the allowed list |

## 1.41.3 mini player and navigation (owner, 2026-11-07)

| Request | Change | Tests (CI) | Device |
| --- | --- | --- | --- |
| Mini player background opaque, the cover's glow, not transparent | `MiniPlayerGlow` on an opaque `#050505` base, glow at full strength, soft blurred cover, light scrim; still glow (no animation) on low-end / Battery Saver; plain solid only with no cover (`miniPlayerSurface`) | `miniPlayerSurface.test.ts` | Pending: look over a scrolling page |
| Scrubber on the top edge, no gap | Band padding removed, line edge to edge on the shell's top edge, thickens downward; 10dp grab room above | `miniPlayerSurface.test.ts` | Pending: drag feel |
| Controls feel and accessibility | Next tap slides the song like a swipe (light haptic); native nav tabs announce as "Tab" | `miniPlayerSurface.test.ts`, `accessibilityNames.test.ts` | Pending: TalkBack |

## 1.42.0 Spotify positions, step 1: tabs, Create sheet, profile menu (owner, 2026-11-07)

Plan: https://claude.ai/artifact/PUmVFqesXNjCtST8Ntaeqx (built from the owner's Spotify screenshots).

| Change | Tests (CI) | Device / emulator |
| --- | --- | --- |
| Tabs Stream, Search, Library, Create (native `NativeTabBarView` v6 + JS fallback); Create raises a sheet above the bar (Luvs, Playlist, Blend, LuvLink) and becomes a white close disc | `shellNavigation.test.ts` | Pending: tap Create, pick each row, Back closes |
| Profile menu from your picture at the top left of Stream, Search, Library (About and updates first, then the You rows); update dot on the picture; You tab and Stream's LuvLyrics mark removed | `shellNavigation.test.ts`, `StreamScreen.layout.test.ts` | Pending: TalkBack order, swipe the menu closed |
| Release gate reaches About through "Profile and settings" → "About LuvLyrics" | `shellNavigation.test.ts` (script guard); the gate itself runs on the PR | Emulator gate on the PR |

## 1.43.0 Spotify positions, step 2: mini player card

| Change | Tests (CI) | Device |
| --- | --- | --- |
| Floating rounded card inset from the edges; Devices, heart, play on the right (Next by swipe and TalkBack action); Connect's mini player gets Devices | `miniPlayerSurface.test.ts` | Pending: look and touch on a phone |
| Liked songs: no cover, forest-green wash from the top into black, big left title, count, download + sort left, round Play right, "Add to this playlist"; back arrow in a disc | `round7.test.ts` | Pending: look on a phone |
| Mini player: title bold with the artist under it; saved mark ✓ / ⊕; progress line stays on the top edge (owner) | `round7.test.ts`, `miniPlayerSurface.test.ts` | Pending |
| Navigation: no slab; the page fades to black under the bar, from 40dp above it | `round7.test.ts` | Pending: rows scrolling under it |

## 1.44.0 Playlist page, sharing, LuvLyrics codes, island after a restart

| Change | Tests (CI) | Device |
| --- | --- | --- |
| Playlist page in Spotify's layout (owner's three screenshots): back and ⋮ in discs, Find in playlist, 62% cover over a calm wash of its colour, name left, length, download + share left, shuffle + round Play right, chips Add / Edit / Name and details / Sort | `round7.test.ts` (order guard), `share.test.ts` (playlistPage rules) | Pending: look on a phone |
| Double tap the cover: it turns into song cards; swipe and the card it rests on plays; follows the playing song; double tap turns it back; TalkBack: one stop, swipe up/down steps | `share.test.ts` (deck rules) | Pending: feel of the turn and the swipe |
| Share links `/song/<source>/<id>?t=&a=`, `/song/find`, `/shared/<code>` open LuvLyrics (Android App Links, `assetlinks.json` with the build's certificate) or the website; pasted in a browser they stay on the website, which offers Open in LuvLyrics on Android | `packages/shared/shareLinks.test.ts`, `share.test.ts` (manifest, app.json, assetlinks), `useDeepLinks.test.ts`, web `routes.test.ts` | Pending: tap a link in a chat with and without the app; Settings → Apps → LuvLyrics → Open by default shows the host verified |
| Share sheet: song (⋮ → Share) and playlist (page, ⋮) show the LuvLyrics code plus Share link / Copy link; a playlist not on the account shares as a list | `share.test.ts`, `playerMenuActions.test.ts` | Pending |
| LuvLyrics codes: 25 bars, 8 heights, Gray-coded, whitened, CRC-16, one-bar repair; read from synthetic photos (blur, noise, ±4° tilt, upside down, portrait, dark on light, clutter) | `packages/shared/luvCode.test.ts`, `share.test.ts` | Pending: scan a code on another phone's screen and on paper, in dim light with the torch |
| Scanner (Search → camera): expo-camera stills every ~0.35 s read on the phone, or Choose a photo | `share.test.ts` (source guards), `nativeModuleList.test.ts` | Pending: permission prompt, scan speed |
| Island after a restart (owner: still gone on their sister's phone): a boot-time service rebuilds its window at 8 s and 30 s, the first unlock or screen-on rebuilds it, a dropped window is rebuilt, every recheck measures the screen again; never while the island is open | `IslandRecoveryTest.kt` (restart, screen off/on, dropped, refused, in hand, switched off, reconnect), `nativeRegressions.test.ts` | Pending: restart that phone with the island on, wait for unlock, check it is there without touching the app |
| Owner polish: mini player full width, borderless, faint-white track; Devices / saved / play at one size in even slots; profile menu true black, spring open, slide-out close, swipe shut; Liked songs premium diagonal forest wash, smaller title and controls, 48dp Play (also on playlists) | `miniPlayerSurface.test.ts`, `round7.test.ts` | Pending: look and feel on a phone |

## 1.45.0 Listening stats

| Change | Tests (CI) | Device |
| --- | --- | --- |
| Every listen (signed in or not) is logged on the phone (`listen_log`), paused by Settings `listeningStats` | `listeningStats.test.ts` (log row), `statsWiring.test.ts` | Pending: play songs signed out, open stats |
| Stats for This week / 4 weeks / 6 months / This year / All time: minutes and change, plays, songs, artists, daily average, top 5 artists and songs, on repeat with total time, 24-hour clock and persona, week, day by day, streaks, finished / skipped, new songs and artists | `listeningStats.test.ts` | Pending: look and feel, TalkBack |
| Tempo: Deezer's BPM when it has one, else measured on the phone (`TempoModule` → `TempoMath`), kept per song | `tempo.test.ts`, `TempoMathTest.kt` (click tracks 76–172 BPM, noise, silence, drone) | Pending: tempos for real songs, data use |
| Profile menu → Listening stats (Spotify's place); Keep counting switch and Clear listening stats | `statsWiring.test.ts` | Pending |
