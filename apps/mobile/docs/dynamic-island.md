# System Dynamic Island

The island is a native Kotlin accessibility overlay, outside the React Native activity. It stays
over other apps and opens into cover artwork, song information, elapsed/remaining time, a seek bar,
and previous/play-pause/next controls. The Settings screen only configures the native feature.
It controls LuvLyrics playback; other apps' media sessions are not collected.

## Set it up

1. Install a build containing the island.
2. Samsung Galaxy M31 / Android 12: open Android **Settings → Accessibility → Installed apps**
   (or **Installed services**) **→ LuvLyrics island → On**, then accept Android's confirmation.
3. In LuvLyrics, open **Settings → Dynamic island**. Enable **Show the island**. Leave
   **Show when nothing is playing** on to keep a tappable island around the camera while idle.
4. Tap the island or pull it down to open the card. It floats a little below the top edge, a pill with every corner
   round, three quarters as wide as the room it could take. On the open card:
   - **Pull down from its lower part** for the full lyrics (the two lines under the controls grow into the list,
     which follows the song; tap a line to play from it). Push up to go back, push up again to close.
   - **Pull down from its top part** (the cover and title) for search: the row stretches into a field and the
     keyboard comes up. The best answer shows large with Play, the rest under it. A tap plays it with similar songs
     queued after it (Stream's search pick, `StreamService.playFromSearch`).
   - **Swipe left** for your playlists, tap one for its songs. **Swipe right** for your downloads (offline).
     A tapped song's cover and title fly into the card while the list folds away, and it plays.
   - Tap the cover or title to open LuvLyrics: Android grows the app's window out of the island
     (`ActivityOptions.makeScaleUpAnimation`, run by the system compositor), onto Now Playing already open
     (`lyricflow://player?instant=1`). Long-press the closed pill to open it too. Drag the scrubber to seek: the
     line has no knob and swells under the finger.
   Without timed lyrics or with **Two lines of lyrics on the card** off, the card closes by itself after eight
   seconds without a touch (twenty while browsing); otherwise it stays until it is pushed up or tapped outside.
5. Settings → Dynamic island → **Width** and **Height** size the island (80–125% and 85–130%; the pill never
   gets smaller than the camera). **Show on the lock screen** keeps it there for playing, skipping, seeking and
   lyrics; playlists, downloads, search and opening the app wait until the phone is unlocked.
6. Settings → Dynamic island → **Hide while LuvLyrics is open** (on by default) puts the island away while the app
   is in front (`MainActivity` resume/pause → `IslandService.setAppInFront`).

The plan, requests and continuity rules behind this are in [`enhance-dynamic-island.md`](enhance-dynamic-island.md).

If a sideloaded app's accessibility switch is blocked on Android 13+, open Android **Settings → Apps
→ LuvLyrics → three-dot menu → Allow restricted settings**, then enable the service again.
The app includes shortcuts to both pages. See [Google's restricted-settings instructions](https://support.google.com/android/answer/12623953).

No separate "Display over other apps" permission, notification access, or root is required.
Android binds the service after the listener enables it. If a Samsung device repeatedly stops it,
check **Battery → Background usage limits → Never sleeping apps**. Force-stopping the app explicitly
stops its services; reopen it afterward. Device-vendor behaviour still needs physical-device testing.

Phones recognised as having a system island leave ours off. **Use the LuvLyrics island anyway**
overrides that decision. Detection uses vendor ROM properties, not a universal Android capability:
unknown ROMs may need the listener to turn **Show the island** off manually.

## Position and visibility

`IslandWindow` reads the current display/window bounds, density, status-bar insets and actual cutout
rectangles. Insets, configuration and display changes trigger remeasurement. A small centred camera
gets a pill enclosing its real bounds. A waterdrop touching the screen edge gets an attached pill.
Wide notches get a centred pill below the obstruction; corner cameras use the centre of the screen.
The expanded card clears the cutout and respects the safe side insets. With no cutout, the pill uses
the central status-bar area. These rules avoid a table of phone models or a fixed top offset.

Landscape, screen-off and keyguard hide the island and stop its redraw ticks. The island remains
available in portrait fullscreen apps: accessibility-window insets cannot reliably report another
app's status-bar visibility without requesting additional screen-observation access.
The drawing surface keeps a fixed horizontal frame so Android cannot move it sideways while its buffer
resizes at the end of a close. While closed it passes touches through; a small transparent native input
window follows the pill, so the status shade remains reachable on either side. Expanded input is enabled
only while the card is open or moving. Both windows hide and become non-touchable on lock/rotation.
Hardware holes themselves cannot receive touch; tap the black area beside/below the camera.

## Native integration

- `android/app/src/main/java/com/lyricflow/app/island/`: service, window, custom Canvas view,
  pure geometry/springs, artwork palette, preferences and vendor detection.
- `PlaybackService` attaches its session player to `IslandPlayback`, and detaches before release.
  No controller binding starts an idle playback service. Commands use the same forwarding player
  as Android's notification, so queue skips work when JavaScript sleeps.
- `playback/PlayerResume.kt` shares idle reprepare and audio-focus resume with `MainPlayerModule`.
- `DynamicIslandModule` exposes preferences and Android settings shortcuts. It never draws the island.
- Lists and search: `hooks/useIslandLibrary.ts` (mounted in `RootNavigator`) sends the playlists with their songs
  (`services/playlistSongs.ts`, local and online), the downloads, and search answers as JSON snapshots;
  `IslandLibrary` holds them. A pick or a typed query comes back as `onIslandPick` / `onIslandSearch` and plays the
  way the app's own screens do. With JavaScript not running, a pick opens the app through the widget's play link.
- The light behind the open card is a flowing mesh of the cover's colours (`IslandFlow`: a domain-warped field
  with weights that sum to one, computed at 40×56 px and drawn filtered, so no circles or edges). Android 12 has no
  app GPU shaders, which is why it is computed. Its clock runs only while music plays. Titles that do not fit loop with eased starts and 4 s rests, and glide home on pause.
- Covers load on the island's own two threads, never behind the media notification's network loads, and are
  cached with their colours and light; the next song's cover is decoded ahead (`IslandArt`).
- Lyrics: `hooks/useIslandLyrics.ts` (mounted in `RootNavigator`) sends the playing song's timed lines
  once per song through `setLyrics` (`islandLyricsPayload` applies the app's lyrics delay); `IslandLyrics`
  holds them keyed by song id and the view finds the sung line from the player's own position, so they
  keep moving while JavaScript sleeps. Plain (untimed) lyrics are not sent.
- Smoothness: the springs are Apple's feel (stiffness 170 at damping 0.86 ≈ SwiftUI's 0.5 s response,
  0.825 damping). Window animations are off and the window only grows ahead of a move and fits at rest,
  never per frame (an overlay resized every frame fights the system's own layout and flickers). Shaders
  are built for the target size and each lyric line is measured once, so no frame allocates.
- Accessibility XML requests no screen content, events, gestures or screenshot capability.

Android's [window documentation](https://developer.android.com/reference/android/view/WindowManager.LayoutParams#TYPE_ACCESSIBILITY_OVERLAY)
defines accessibility overlays as belonging to a connected accessibility service. Ordinary
application overlays sit below critical system windows including the status bar.

## Verify

From `apps/mobile/android`, with a supported JDK and Android SDK:

```powershell
.\gradlew.bat :app:testDebugUnitTest
.\gradlew.bat :app:assembleDebug -PreactNativeArchitectures=x86_64
```

From `apps/mobile`: `npm run ci`. Geometry tests cover waterdrop, floating hole, corner, wide notch,
no cutout, safe edges and tablet layouts across densities and widths. On an emulator, enable the
service, play music, go Home, tap the camera area, seek and skip, remove the task while playing,
pull down the shade beside the island, rotate, lock and unlock. Repeat with Developer options'
display-cutout simulations and changed display density. A passing simulator is not proof of every OEM.

For the closing-motion regression, run this from the repo root against an enabled debug build:

```powershell
apps/mobile/scripts/probe-dynamic-island.ps1 -Serial emulator-5554 -OutDir C:/temp/island-probe -Record
```

The probe reads the actual camera geometry, opens and closes the card three times, checks that it
really expands and returns to compact height, and asserts that the drawing window's x and width
never change. It saves the measured frames, an expanded screenshot and an optional motion recording.
The compact bars use moderate, independent cycles. The card's light moves only while music plays.
