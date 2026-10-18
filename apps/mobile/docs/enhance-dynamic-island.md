# Enhance Dynamic Island

The plan for the next version of LuvLyrics' system island (`android/.../island/`). The island is a native
Kotlin accessibility overlay drawn by hand on one canvas (see `dynamic-island.md` for how it works today).
This file records the owner's requests and the plan to build them. Tick a box only once the work is built
**and** checked in the screenshot harness (below).

Branch: `claude/dynamic-island-player-e765z5`. Nothing goes to `main` until the owner has reviewed the
screenshots and said it is good enough.

## What the owner asked for

Grouped and cleaned up from the owner's messages (2026-10-18).

1. **Shape and size**
   - The open island is too wide: make it 25% narrower.
   - It must be a floating **island pill** with all four corners round, a little below the top edge. It should
     never look like a notch hanging from the edge.
2. **Full lyrics.** Pull the open card down again and it grows into a full lyrics view: every line, the sung
   line bright, the list following the song, as the app's lyrics do.
3. **Moving light.** Behind the open card, the cover's colours flow, like the website's Now Playing. They move
   while the song plays and stop when it is paused (see item 13 for how it should look).
4. **Playlists.** Swipe the card **left**: all my playlists. Tap one and it opens full height with every song,
   scrollable. Tap a song: the island morphs back down to the small card and the song starts. A pull down from
   there shows its lyrics again.
5. **Downloads.** Swipe the card **right**: every downloaded song, for offline listening. Tap one: it plays
   offline, with its lyrics, and the island folds back into the card.
6. **Search.** Pull down starting in the **top 40%** of the open card: a search drawer slides open and the
   keyboard comes up by itself. Results arrive as you type (the app's own search, which combines its catalogs).
   The best match is shown large with a play button. Other matches are a smaller list underneath. A tap plays a
   song, and the queue fills with songs of a similar vibe (the app's existing radio).
   - A pull down starting in the **middle or bottom 60%** of the card still opens full lyrics (item 2).
7. **Scrolling titles.** Long song titles and artist names scroll slowly right to left so the whole name can be
   read, then rest, then scroll again.
8. **Scrubber.** No round knob. A thick line with round ends, as in the app's Now Playing. It gets thicker
   under the finger and goes back to a normal line when let go.
9. **Cover art bug.** The island sometimes shows the previous song's cover or colours. A downloaded song shows
   a grey tile for about 20 seconds before its cover appears. A cover stored on the phone must show at once.
10. **Hide inside the app.** A setting: when on, the island goes away while LuvLyrics itself is on screen and
    comes back when you leave the app.
11. **Opening the app from the island.** When a song or the card opens LuvLyrics, the app should grow out of
    the island in one smooth motion, like the iPhone. It must stay smooth on older phones such as the Galaxy
    M31.
12. **Continuity, not fades.** Every transition should feel continuous, like one object changing shape, the way
    iOS moves between states. Nothing should simply fade out while something else fades in. The result should
    feel clean and polished.
13. **Premium light, not blobs.** The light behind the island must not look like round blobs or a cheap
    gradient. It should be one smooth, flowing field of the song's own colours, pooling along the bottom, Apple
    Music style, and feel part of the island.
14. **Two lyric lines optional.** A setting to show or hide the two lines of lyrics on the open card.
15. **Marquee rhythm.** After each loop, the title and artist rest 4 s with the start showing, then loop again
    smoothly. On pause they glide back to the start of the name. On play they loop again from there.
16. **Proof.** Run it in a cloud emulator and send screenshots of every state (open, close, playlists, songs,
    downloads, search, lyrics) for review. Push to `main` only after approval.

## Gesture map (open island)

| Gesture | Where it starts | Result |
|---|---|---|
| Tap / pull down | the pill | the card opens |
| Pull down | top 40% of the card | search drawer and keyboard |
| Pull down | lower 60% of the card | full lyrics |
| Push up | full lyrics | back to the card |
| Push up | the card | the island closes |
| Swipe left | the card | playlists, then a tap shows that playlist's songs |
| Swipe right | the card | downloads |
| Swipe back toward the card | any side page | one page back |
| Tap a song | songs, downloads, search | it plays, and the island folds back into the small card |
| Tap the cover or title | the card | LuvLyrics opens, growing out of the island |
| Tap outside | — | the island closes |

Horizontal pages, left to right: **Downloads (−1) · Card (0) · Playlists (1) · Songs (2)**. Every drag moves
with the finger: the page or height follows it directly, and on release a spring takes over with the finger's
speed. The springs use the island's Apple-like tuning: stiffness 170, damping 0.86.

## Research: opening the app from the island

- Android can launch an activity so that its window grows out of a rectangle on screen:
  `ActivityOptions.makeScaleUpAnimation(source, x, y, w, h)` or `makeClipRevealAnimation(...)`. The rectangle
  is in the source view's coordinates
  ([ActivityOptions](https://developer.android.com/reference/android/app/ActivityOptions),
  [ActivityOptionsCompat](https://developer.android.com/reference/androidx/core/app/ActivityOptionsCompat)).
  The **system compositor** runs this animation, not the app. That is why it can stay smooth on an old phone:
  nothing in our process draws or lays out during it.
- Plan: the source view is the island view, which is attached to its own overlay window. The source rectangle
  is the card's current outline, and the app reveals from the island's exact shape. At the same moment the
  island collapses to its pill on its own spring, so the two look like one motion. The link mounts Now Playing
  already open (no second sheet slide inside the app).
- Fallback: if a ROM ignores options from an overlay window, the launch is a plain start with the island's
  collapse. That still works, it is just less pretty.
- Third-party island clones (dynamicSpot) only open the target app without a morph, and reviewers note their
  stutter ([MobileSyrup](https://mobilesyrup.com/2022/09/22/android-app-dynamicspot-mimics-dynamic-island/)).
  Apple's version is part of the system's animation layer
  ([iMore](https://www.imore.com/iphone/android-is-already-copying-the-dynamic-island)). The compositor-run
  reveal is the closest an app can get.

## Research: continuity

- Apple's *Designing Fluid Interfaces* (WWDC18, session 803) describes fluid motion as responsive,
  interruptible and redirectable: motion follows the gesture, springs settle naturally, resistance signals a
  limit, and the gesture's speed carries into the animation
  ([talk](https://developer.apple.com/wwdc18/803),
  [demos in code](https://github.com/nathangitter/fluid-interfaces)). SwiftUI's `matchedGeometryEffect`
  applies the same idea to views that exist in both states: one shared identity, and its frame is interpolated
  ([write-up](https://sarunw.com/posts/a-first-look-at-matchedgeometryeffect/)).
- Material's motion system names four patterns. A **container transform** is used when a persistent element
  (a list row, a card) changes size and shape into the next screen, keeping a visible connection between the
  two. **Shared axis** is used for places that sit next to each other. **Fade through** and **fade** are only for
  things with no relationship
  ([Material motion](https://material.io/design/motion/the-motion-system.html),
  [MaterialContainerTransform](https://developer.android.com/reference/com/google/android/material/transition/MaterialContainerTransform)).

How the island uses this. One rule: whatever exists before and after a change **moves** there. It is never
faded out in one place and in at another.

| Change | Continuity |
|---|---|
| Pill ↔ card | The island's outline morphs (container). The pill's little cover **grows into** the card's cover. The level bars give way to the controls. |
| Card ↔ full lyrics | The two sung lines under the controls **become** lines in the full list: each moves and grows from its place in the strip to its place in the list. The scrubber slides down to the bottom edge. The controls sink away. |
| Card ↔ search | The cover-and-title row **stretches into** the search field. The answers rise in under it. |
| Card ↔ playlists / downloads, playlists ↔ songs | Places side by side: they slide with the finger (shared axis), and the island's height follows. |
| Tap a song in a list or a search answer | The tapped row's cover, title and artist **fly into** the card's cover, title and artist while the list folds away and the island shrinks. The card shows the picked song from the first frame and does not wait for the app to start it. |
| Card → app | The app's window grows out of the island's outline (system compositor). |
| Pause / play | The light eases to a stop and starts again. A title caught mid-loop glides home to its start. |

## Research: the cover bug (item 9)

- `IslandArt` loads covers on `DataSourceBitmapLoader.DEFAULT_EXECUTOR_SERVICE`, a single thread that Media3
  shares with the media session's notification artwork. One slow https cover (network timeouts are 8 s each)
  holds up every cover queued behind it, including a file on the phone. That matches "about 20 seconds".
- When the song changes, the island clears the cover but keeps the **old colours** until the new cover
  arrives. So a slow load shows the previous song's colours.
- Plan: give the island its own small loader pool, so files never wait behind the network. Read `file://` and
  `content://` covers first. Keep a small cache of covers and colours keyed by address, so going back to a song
  is instant. Prefetch the next song's cover. If no cover has arrived within 600 ms, fade the old colours to
  neutral. Reload when the song's embedded artwork shows up later.

## Todo

- [x] 1. Card 25% narrower; pill and card float with round corners (`IslandGeometry`)
- [x] 2. Full lyrics on pull down (finger-following, gliding list, tap a line to play from it)
- [x] 3. Cover light flowing behind the card, clock runs only while playing (`IslandGlow`, `IslandMotion`)
- [x] 4. Playlists page (swipe left), songs page, pick folds back into the card and plays (`IslandLibrary`, JS `useIslandLibrary`)
- [x] 5. Downloads page (swipe right), offline play with lyrics
- [x] 6. Search drawer: top-40% pull, focusable input window with keyboard, live results from JS, best match large, play + similar-vibe queue (keyboard focus in the overlay: check on the phone)
- [x] 7. Marquee titles and artists
- [x] 8. Knob-less scrubber that swells under the finger
- [x] 9. Cover bug: own loader pool, cache, prefetch, neutral fallback, embedded-art reload
- [x] 10. Setting "Hide while LuvLyrics is open" (native pref + Settings row; window-level, check on the phone)
- [x] 11. App opens out of the island (compositor reveal + island collapse; Now Playing mounted open; system animation, check on the phone)
- [x] 12. JS bridge: playlists, downloads and search snapshots, pick and search events (`DynamicIslandModule`)
- [x] 13. Continuity morphs: pill cover ↔ card cover, lyric strip ↔ full lyrics, cover row ↔ search field, picked row → card
- [x] 13a. Light from the cover itself: tiny blurred cover, lifted colours, three slowly turning layers pooled at the bottom (`IslandGlow`)
- [x] 13b. Setting "Two lines of lyrics on the card"
- [x] 13c. Marquee: eased loops, 4 s rest, glides home on pause, loops again on play
- [x] 14. Tests: geometry, library parsing, marquee/blob math, JS payload builders
- [x] 15. Screenshot harness run: every state plus a motion video, sent for review
- [x] 16. Docs (`dynamic-island.md`), version bump (1.11.0), typecheck/lint/jest, push the branch
- [ ] 17. After the owner approves: merge to `main`

## How it is checked here

The cloud container has no KVM, so an Android emulator cannot boot, and Google's Maven is not reachable. The
screenshot harness (kept outside the repo) compiles the **real** island sources against Robolectric's Android
framework jar and renders `IslandView` with Robolectric's native graphics, which is Android's own Skia canvas
on the JVM. It drives the view with real touch events (taps, drags, swipes) and steps its own frame loop at
60 fps. Only Media3's player and AndroidX's colour helpers are stubbed. It saves PNG stills and an MP4 of the
whole flow.

On a real phone, also check: keyboard focus in the overlay, the app-open reveal, and per-ROM behaviour.
