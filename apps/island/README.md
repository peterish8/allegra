# LuvLyrics island (optional add-on)

The music island round the camera, over every app, as its own small Android app (`com.lyricflow.island`).

It is separate from LuvLyrics on purpose. The island is an **accessibility service**, and Google Play Protect's
fraud protection blocks sideloaded apps that declare one, while Google Pay pauses payments on phones that have a
non-Play accessibility service switched on. Kept out of LuvLyrics, the app everyone installs has neither problem;
only listeners who choose the island install it and see Android's accessibility step.

## How it works

- `IslandService` is the accessibility service. It draws the island (`IslandWindow`, `IslandView`) and reads no screen content.
- `IslandPlayerLink` connects a Media3 `MediaController` to LuvLyrics' media session (`PlaybackService`). A controller
  is a `Player`, which is what the island already listened to and commanded (`IslandPlayback`).
- LuvLyrics tells the island whether its own screen is in front with one data-free explicit broadcast
  (`apps/mobile/.../addon/IslandAddon.kt` → `IslandAppStateReceiver`), so the island can step aside.
- `IslandSettingsActivity` is the add-on's one screen: the accessibility step and how the island looks.
- Signed with the same key as LuvLyrics (CI: `.github/workflows/mobile-apk.yml`), published as `LuvLyricsIsland.apk`
  on the `apk-latest` release beside `LuvLyrics.apk`.

## Not here yet

The island's playlists, downloads, search, lyric strip and "Play here" were fed by JavaScript inside LuvLyrics. They
need a bridge between the two apps (custom media-session commands) and are not connected yet, so those parts of the
island show nothing for now. Playback, the pill, transport, scrubber and the open card work from the media session.

## Build

`./gradlew testReleaseUnitTest assembleRelease` in this folder (JDK 17, Android SDK 36). The island's typefaces are
copied from `apps/mobile/assets/fonts` at build time.
