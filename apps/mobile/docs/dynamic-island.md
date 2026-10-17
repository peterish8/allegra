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
4. Tap the island to expand, drag up or tap outside to close. It closes after eight seconds without
   interaction. Long-press the compact island to open LuvLyrics. Drag the progress bar to seek.

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
The compact bars use moderate, independent cycles; the card's cover-coloured light blooms from below
the controls into a black surface, with no continuous background animation.
