# Island take-over: play here what another app is playing

The plan for "Play here": a song is playing in Spotify, YouTube Music, Apple Music or YouTube; one tap on the
LuvLyrics island finds the same song in LuvLyrics, starts it at the same moment, and stops the other app. No AI,
no audio fingerprinting: Android already tells us what the other app is playing and where it is.

The work is split in two so two coders can build it at once without touching the same files: **Part A** is the
Kotlin side, **Part B** the JavaScript side. They meet only at the contract below. The lead reviews both, runs
everything, fixes what is broken, and ships.

## How it works

1. **Read what plays elsewhere.** `MediaSessionManager.getActiveSessions(component)` lists every app's media
   session. Each `MediaController` gives the metadata (title, artist, album, length) and the `PlaybackState`
   (position, `lastPositionUpdateTime`, speed, state), and can `pause()` the app.
   Android only hands that list to an app that is an **enabled notification listener** (or holds
   `MEDIA_CONTENT_CONTROL`, system apps only). So LuvLyrics gets a small `NotificationListenerService` that reads
   no notifications: it exists only to unlock the session list.
   Sources: [MediaSessionManager](https://developer.android.com/reference/android/media/session/MediaSessionManager),
   [PlaybackState](https://developer.android.com/reference/android/media/session/PlaybackState),
   [androidx/media#3179](https://github.com/androidx/media/issues/3179) (no lighter permission exists yet).
2. **Show it on the island.** While another app plays and LuvLyrics does not, the island shows that song with a
   "Play here" button.
3. **Find it.** JavaScript cleans the title (no "(Official Video)", no "- Topic" channel names), asks
   `searchOfficial` for `title + lead artist`, and keeps a result only if the title and lead artist match and the
   lengths agree within 4 s. A miss opens the island's search drawer with the query typed in, so the listener
   picks.
4. **Hand over at the same moment.** The other app keeps playing while LuvLyrics searches and loads, so there is
   no silence. The song loads already positioned (`resumeNextLoadAt`) at the other app's live position plus a
   small lead for loading; the moment LuvLyrics plays, the other app is paused and one correcting seek fixes
   any drift over 0.4 s.

Live position = `position + (SystemClock.elapsedRealtime() − lastPositionUpdateTime) × speed` while
`STATE_PLAYING`, else `position`. Kotlin does this, so JavaScript never needs `elapsedRealtime`.

### Why not accessibility

The island's accessibility service could tap Spotify's buttons and read its screen, but that breaks with every
app update and needs `canRetrieveWindowContent`, which contradicts the island's disclosure ("It reads nothing on
your screen"). Not used. A second idea (take the session token from the media notification through
`TYPE_NOTIFICATION_STATE_CHANGED`) would skip the extra switch, but it is unproven on current Android and also
changes what the service reads. Not in this version.

### Limits we accept

- Android 13+ blocks the notification-access switch for sideloaded apps until "Allow restricted settings" (the
  island already explains this for its own switch; reuse that row).
- Play Protect may flag sideloaded apps holding notification access.
- A different upload can start a second or two earlier or later; we line up by timestamp, not by audio.
- Podcasts, ads and Spotify DJ are skipped (no artist, or a length under 30 s, or an episode media id).

## Contract (both parts build to exactly this)

Units: **seconds** everywhere JavaScript sees them (repo rule). Kotlin converts from ms.

### Native module `DynamicIsland` (Part A adds, Part B calls)

| Function | Returns | What it does |
|---|---|---|
| `takeOverStatus()` | `{ enabled: boolean, listenerEnabled: boolean }` | The pref, and whether Android has our listener on |
| `setTakeOverEnabled(on: boolean)` | `boolean` | Saves the pref, refreshes the island |
| `openTakeOverSettings()` | `boolean` | Our row in notification access (`ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS`, API 30+), else the list page |
| `outsideNow(packageName: string)` | `{ positionS: number, playing: boolean } \| null` | That app's live position right now; null if its session is gone |
| `pauseOutside(packageName: string)` | `boolean` | `transportControls.pause()` on that app |
| `takeOverDone(ok: boolean, message: string)` | `boolean` | The island leaves its "Finding…" state; `message` is shown briefly ("Playing in LuvLyrics", "Not found") |
| `showTakeOverSearch(query: string)` | `boolean` | The island opens its search drawer with `query` typed in (the existing `IslandLibrary.search` path) |

### Event `onIslandTakeOver` (Part A sends, Part B listens)

```ts
interface IslandTakeOver {
  packageName: string;   // 'com.spotify.music'
  appLabel: string;      // 'Spotify'
  title: string;         // raw, as the app published it
  artist: string;        // raw; may be '' or a channel name for YouTube
  album: string;         // may be ''
  durationS: number;     // 0 when unknown
  positionS: number;     // live position when the button was tapped
  playing: boolean;
}
```

Sent when "Play here" is tapped, after `IslandJsAwake.hold` (as picks and searches do). When no JavaScript
listens, the island opens the app instead (same rule as `onPick`).

## Part A: Kotlin (coder 1)

**Owns only these files** (create or edit):
- new `android/app/src/main/java/com/lyricflow/app/island/OutsideMedia.kt`: the `NotificationListenerService`
  subclass (`onNotificationPosted` etc. do nothing) plus an `object` that tracks sessions:
  `addOnActiveSessionsChangedListener`, a `MediaController.Callback` on each, and a `watch { }` API like
  `IslandPlayback.watch`. Picks the session to offer: state playing, not our own package, has a title, passes
  the skip rules above. Holds nothing when the pref is off or the listener is not enabled.
- new `android/app/src/main/java/com/lyricflow/app/island/OutsideMath.kt`: pure functions (live position,
  which session to offer, skip rules), so they are JVM-testable.
- new `android/app/src/test/java/com/lyricflow/app/island/OutsideMathTest.kt`.
- `island/IslandPrefs.kt`: `takeOver: Boolean`, default false.
- `island/IslandView.kt`, `island/IslandWindow.kt`: the outside song on the island and the "Play here" button
  (a new `Target`, drawn like the existing open-app pill, white like `BEST`). Show it only while LuvLyrics is not
  playing; the island counts it as something to show even when "Show when nothing is playing" is off. States:
  offer → "Finding…" (after the tap) → the `takeOverDone` message for ~1.5 s → normal. Follow the island's motion
  rules (transform and opacity, no fades swapping one thing for another).
- `modules/DynamicIslandModule.kt`: the functions and event above.
- `android/app/src/main/AndroidManifest.xml`: the service with
  `android.permission.BIND_NOTIFICATION_LISTENER_SERVICE` and the
  `android.service.notification.NotificationListenerService` intent filter, label from strings.
- `android/app/src/main/res/values/strings.xml`: label and description ("Lets LuvLyrics see which song another
  app is playing, so the island can play it here. It reads no notifications.").

**Done when:** `cd android && gradlew.bat :app:testDebugUnitTest` passes (the only Gradle run in the session;
`gradlew --stop` first), including `OutsideMathTest`, and `gradlew.bat :app:compileDebugKotlin` builds.

## Part B: JavaScript (coder 2)

**Owns only these files:**
- `src/services/NativeDynamicIsland.ts`: typed wrappers for every function above and `onIslandTakeOver(listener)`.
- new `src/services/takeOver/match.ts`: pure. `cleanOutside({ title, artist })` → `{ title, artist }`
  (strip `(Official Video|Audio|Lyric Video|Visualizer|HD|4K…)` and `[...]` tags, `- Topic`, `VEVO`; split
  `"Artist - Title"` when the artist is a channel; keep Remix, Live, Acoustic, Remastered),
  `takeOverQuery(cleaned)`, `pickTakeOver(cleaned, durationS, results)` → the `UnifiedSong` or null (title and
  lead artist match after normalising; lengths within 4 s when both are known; never a cover/lofi/slowed version
  the original title did not ask for).
- new `src/services/takeOver/match.test.ts`: real titles from Spotify, YouTube Music and YouTube.
- new `src/hooks/useIslandTakeOver.ts`: listens to `onIslandTakeOver`; searches (abortable, a time budget like
  the island search); on a hit plays it as a search pick through the playback routing
  (`services/connect/playbackIntents` / `pickRouter`, so `src/connectRouting.test.ts` stays green and a Connect
  session elsewhere is respected), with `resumeNextLoadAt(id, positionS + elapsed + LOAD_LEAD_S)`; when our
  player reports playing, `outsideNow` → correct by seek if off by > 0.4 s (seek pattern: capture `wasPlaying`,
  seek, resume), then `pauseOutside`; `takeOverDone(true, 'Playing in LuvLyrics')`. On a miss:
  `takeOverDone(false, 'Not found')` and `showTakeOverSearch(query)`. While another device plays through
  Connect, the song goes there and the other app is still paused.
- `src/components/settings/DynamicIslandSettings.tsx`: a "Play here from other apps" switch, and when the
  listener is off an `Action` that opens `openTakeOverSettings` with the disclosure text (reuse the restricted
  settings row).
- mount the hook where `useIslandLibrary` is mounted (one line, `RootNavigator` or wherever it is called).

**Done when:** `node_modules\.bin\tsc.cmd --noEmit`, `node_modules\.bin\eslint.cmd src index.ts` and
`node_modules\.bin\jest.cmd` pass in `apps/mobile`, including the new tests and `connectRouting.test.ts`.

## Rules for both coders

- One branch, `feat/island-take-over`, in the main checkout. **Neither coder commits**; the lead does. Touch no
  file the other part owns. Leave the unrelated working-tree changes alone (`.vercelignore`, `CLAUDE.md`,
  `convex/authRedirect.ts`, `tests/convex/authRedirect.test.ts`, `.planning/AUDIT-REMEDIATION-PLAN.md`,
  `apps/desktop/`).
- Follow `apps/mobile/CLAUDE.md` (no `console.log`, no `any`, the three playback invariants, the comment style
  of the file you are in) and edit with the Edit tool, not scripts.
- If the contract turns out wrong, stop and say so in the report; do not change it alone.
- Report: files changed, what was run and its output, anything unfinished.

## Lead: review, debug, ship

1. Read both diffs against this contract; run the Part A and Part B checks again myself.
2. Root checks: `npm run typecheck`, `npm run lint`, `npm test`; mobile `npm run ci` (or the `.cmd` binaries).
3. Fix what breaks between the two halves (names, units, event timing).
4. Bump `expo.version` in `app.json` 1.15.0 → 1.16.0 (feature). Add an "Island take-over" section to
   `docs/dynamic-island.md` and a row to the file map in `apps/mobile/CLAUDE.md`.
5. Stage only this feature's files (check `git diff --cached --name-only`; no `ggml-hexagon` `.so`), commit
   `feat(mobile): play another app's song from the island at the same moment`, push the branch, open a PR.
6. CI builds the APK; the real test is on a phone: Spotify, YouTube Music and YouTube, each tapped mid-song,
   checked for the same line of the song, the other app paused, and a miss opening the search drawer.

## Checklist

- [ ] Part A built and its Gradle tests pass
- [ ] Part B built and its jest, tsc, eslint pass
- [ ] Lead review and fixes
- [ ] Version bump, docs
- [ ] Pushed, PR open, CI green
- [ ] Checked on a phone with Spotify, YouTube Music, YouTube
