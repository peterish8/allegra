> New correction/verification work order: [PLAN-V6-VERIFICATION.md](PLAN-V6-VERIFICATION.md),
> [detailed handoff](HANDOFF-2026-11-06-v6-verification.md) and [starter](STARTER-PROMPT-v6-verification.md).
> Includes owner screenshots, overlapping UI/title clipping, interaction polish, animated scroll-linked Stream/Library
> headers, compact mini-player clearance and restored horizontal song swipes. These corrections are pending.

> 2026-11-06 continuation: the owner approved all V6 defaults and requested the complete source
> migration, tests, GitHub APK build and merge. The target is now 1.37.1, combining pending polish
> and V6. See [IMPLEMENTATION-STATUS.md](IMPLEMENTATION-STATUS.md) for implemented scope and exact
> evidence. Physical phone checks remain deferred by the owner; static/unit checks do not replace them.

# LuvLyrics frontend polish plan

Written 2026-11-04. Source: the code audit in [MOBILE-UI-REVIEW.md](MOBILE-UI-REVIEW.md) (13/24 on the six
pillars, 2/4 on motion and touch), checked against the code before this plan was written, and the
[heydamir/unslop](https://github.com/heydamir/unslop) checklist (upstream `skills/unslop`, CC BY 4.0, Damir Sokolovsky).

The goal in the owner's words: every button, touch, swipe, scroll, movement and transition feels
finished, and the app reads as one designed thing. The player path (pill → Now Playing → lyrics → Up next)
is already close to that bar. This plan brings the rest of the app up to the player.

## How to read a spec

Every item has the same five parts:

- **Now**: what is wrong, with `file:line` as of commit `1b72928`. Line numbers drift; search for the quoted code.
- **Change**: what to change, and the code shape when it is not obvious.
- **Result**: what a listener feels afterwards, with numbers where there are numbers.
- **Test**: the automated check (it has to fail before the change) and the check on a phone.
- **Size**: S (under an hour), M (half a day), L (a day or more).

Every item in a wave ships in one PR off `main`. Each PR bumps `expo.version` in `apps/mobile/app.json`
(patch) and passes `npm run ci` inside `apps/mobile`.

## What does not change

These are owner decisions recorded in `apps/mobile/CLAUDE.md` and memory. No item here reverses them.

- Clear frosted glass and subtle cover glows stay. No dark veils, no flat redesign.
- Sentence-case copy, no uppercase or tracked labels, no emoji, SF Pro through `fontWeight` only.
- The Echo / Apple / YouTube Music player gestures and the sheet physics in `NowPlayingScreen`.
- Lyrics glide as one block. No per-line springs, staggers or overshoot.
- No live blur on the tab bar or under the dragged player sheet.
- Motion: springs for anything a finger can interrupt, 200–400 ms for state changes, transform and opacity only.

## Direction (unslop, polish mode)

The audit found light slop: a designed product with leftovers, not a vibecoded one. Unslop's rule for
that case is polish mode: fix what the audit found, keep the palette, type, layout and visual, and
take the direction from the brand that exists.

- **Product.** Plays your songs and the catalog's, with lyrics that move with the voice, on your phone and across your devices.
- **Character.** Night-time, close, unhurried.
- **World.** A dark room lit by the record that is playing. The cover is the only light source.
- **Moments.** The cover (full-bleed, its glow, the canvas video) and the sung lyric line. Nothing else gets colour.
- **Signature.** The cover's own two tones tinting the glass it sits under. Used on the player, the pill and its sheets. Nowhere else.

What that means for every spec below: chrome is quiet glass and white text in three steps, the
chartreuse `Signal.wave` marks only play, progress and the current selection, and every moving thing
moves like the player sheet already does.

---

## Wave 0: shipped

### 0.1 Stack overflow in the listen tracker (1.35.4, done)

- **Now:** `services/sync/listenTracker.ts` `finish()` reported a listen before clearing it. The radio's
  `rerank` writes the player store from that report, which re-entered `observe` → `finish` until
  `RangeError: Maximum call stack size exceeded` (the "Copy details" crash).
- **Change:** close the session first, then report.
- **Result:** pausing, skipping or hiding the mini player during a search radio no longer crashes the app.
- **Test:** `listenTracker.test.ts` "reports a listen once when the report itself triggers another
  observation" fails on the old code (re-enters 50 times) and passes on the new. Phone: start a Stream
  search radio, pause, open and close Now Playing ten times, skip twice.
- **Size:** S.

---

## Wave 1: foundations

Everything later builds on these. Ship this wave first, with no visible change except where noted.

### 1.1 Motion tokens and one physics module

- **Now:** `criticallyDamped` is written four times (`NowPlayingScreen.tsx:72`, `ConnectRemotePlayer.tsx:71`,
  `GlassDeck.tsx:44`, `TasteExplorer.tsx:61`), plus `GlassRoom.tsx:27` and `MiniPlayer.tsx:124,224,375`.
  `rubberBand` and `projectMomentum` are copied between `NowPlayingScreen.tsx:80` and
  `ConnectRemotePlayer.tsx:78-85`. The morph curve `bezier(0.32,0.72,0,1)` is a literal in
  `NowPlayingScreen.tsx:432` and `NowPlayingControls.tsx:127`. About 80 durations are literals.
  `Motion.spring.lyrics`, `breathe` and `Motion.ackMs` are unused.
- **Change:**
  1. In `constants/allegraTheme.ts` add:
     ```ts
     export const criticallyDamped = (stiffness: number) =>
       ({ stiffness, damping: 2 * Math.sqrt(stiffness), mass: 1, overshootClamping: true }) as const;

     Motion.spring.open   = criticallyDamped(400);   // a tap opens or closes something
     Motion.spring.fling  = criticallyDamped(1500);  // a flick past 800 px/s
     Motion.spring.settle = { stiffness: 320, damping: 34, mass: 1, overshootClamping: true };
     Motion.ease.morph    = Easing.bezier(0.32, 0.72, 0, 1);
     Motion.duration.morph = 460;
     ```
     Delete `lyrics` and `breathe` if they still have no users after Wave 5.
  2. New `components/allegra/physics.ts` (pure, worklet-safe, no outside defaults per the worklet rule):
     `rubberBand(overshoot, dimension)`, `projectMomentum(velocity)`, `flingSpring(velocity)` (returns
     `Motion.spring.fling` with `velocity` when |v| > 800, else `Motion.spring.open`), and
     `exitDuration(remainingPx, velocity)` = `clamp(remaining / |v| * 1000, 120, 220)`.
  3. Import them in the six files above and delete the local copies.
- **Result:** no visible change. One place decides how everything springs.
- **Test:** `physics.test.ts`: `rubberBand` is monotonic, never exceeds `dimension`, and is 0 at 0;
  `flingSpring(1200)` carries the velocity; `exitDuration` clamps both ends. `workletSafety.test.ts`
  must still pass (it walks every UI-thread function).
- **Size:** M.

### 1.2 `TactileRow`, and `Tactile` for long presses

- **Now:** `Tactile` (`allegra/motion.tsx:84`) sinks to 0.94, which is right for a button and too much
  for a full-width row. Rows fall back to `style={({ pressed }) => …}`, which snaps for one frame and
  shows nothing on a tap shorter than a frame (`PlayerMenu.tsx:36,43`, `PlayerSheet.tsx:185,191`,
  `MoreMenu.tsx:205`, and others in Wave 3).
- **Change:** add `TactileRow` to `motion.tsx`. Same `pressed` shared value, same 70 ms hold
  (`MIN_PRESS_MS`), same Reduce Motion rule, but:
  - scale `1 → 0.985` instead of 0.94,
  - no dimming; instead an absolutely-filled `Animated.View` behind the children whose opacity goes
    `0 → 1` with `pressed`, coloured `Glass.fillPressed`, radius inherited from `style.borderRadius`,
  - `onLongPress` passes through, and the long press fires `Haptics.toggle()` (1.3) before the handler.
  ```tsx
  const overlay = useAnimatedStyle(() => ({ opacity: pressed.value }));
  const lift = useAnimatedStyle(() => ({ transform: reduce ? [] : [{ scale: 1 - 0.015 * pressed.value }] }));
  <Pressable …><Animated.View style={[style, lift]}>
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: Glass.fillPressed, borderRadius }, overlay]} />
    {children}
  </Animated.View></Pressable>
  ```
- **Result:** a row lights up under the finger and settles back in about 120 ms, even on the quickest tap.
- **Test:** `motion.test.tsx` (react-native testing library, already in devDependencies if present, else
  add `@testing-library/react-native`): pressIn sets the overlay's target to 1, pressOut within 20 ms still
  holds it for 70 ms. Phone: tap a ••• menu row as fast as you can; the highlight is always visible.
- **Size:** S.

### 1.3 One haptic vocabulary

- **Now:** play/pause is a selection tick on the pill (`PillPlayer.tsx:121,282,338`) and a Medium knock
  in the player (`NowPlayingControls.tsx:625`); next is selection on the pill and Light in the player;
  the cover swipe is Medium; the lyrics scan is a raw `vibrate(50)` (`useSongActions.tsx:66`).
- **Change:** add semantic calls to `utils/haptics.ts`, keeping the old exports for now:

  | Call | expo-haptics | Use it for |
  |---|---|---|
  | `tap()` | `selectionAsync` | chips, choices, tabs, any selection change |
  | `toggle()` | `impactAsync(Light)` | like, switch, long press opening a sheet, a drag picking up |
  | `commit()` | `impactAsync(Medium)` | play/pause anywhere, a skip by gesture, a sheet thrown shut |
  | `success()` | `notificationAsync(Success)` | download done, lyrics saved, queue added |
  | `refuse()` | `notificationAsync(Warning)` | nothing to skip to, an action that can't run |

  Map all ~130 call sites onto these five. Replace `vibrate(50)` with `success()`. When nothing imports
  `ImpactFeedbackStyle` any more, stop exporting it.
- **Result:** the same action feels the same on the pill, in the player and on the lock-screen-adjacent
  widgets. Play/pause is one firm knock everywhere.
- **Test:** `haptics.test.ts`: each call is silent when `hapticsEnabled` is false. A source guard in the
  same file fails if any file outside `utils/haptics.ts` calls `Vibration.vibrate` or `impactAsync` with
  a style argument (so new code uses the vocabulary). Phone: play/pause from the pill and from the player
  feel identical.
- **Size:** M.

### 1.4 Look tokens: text roles, pressed tint, type scale, weights

- **Now:** 13 white text levels (0.45 to 0.92) beside `Signal.ink*`; six pressed tints (0.06 to 0.16);
  28 font sizes including 10, 10.5 and 12.5; `fontWeight: '500'` ×9 renders Regular and `'800'/'900'`
  ×26 render Bold; `letterSpacing` ×6 despite the rule. Details in the review, pillars 3 and 4.
- **Change:** in `allegraTheme.ts`:
  ```ts
  Signal.onMedia = { primary: '#fff', secondary: 'rgba(255,255,255,0.86)', muted: 'rgba(255,255,255,0.62)' };
  // Glass.fillPressed stays the one pressed tint.
  export const Type = {
    meta: 11, secondary: 13, body: 15, row: 17, playerTitle: 22, page: 28, display: 34, hero: 42,
  } as const;
  export type Weight = '400' | '600' | '700';
  ```
  Then a lint rule in `apps/mobile/.eslintrc.js` (`no-restricted-syntax`) that fails on
  `fontWeight: '500' | '800' | '900'` literals and on any `letterSpacing` property outside an allowlist
  of one: the room code in `LuvLinkPanel.tsx` (comment why). Migrating existing values is Wave 7; this
  item only adds the tokens and the guard, with existing violations listed in `// eslint-disable-next-line`
  comments so the guard stops new ones from day one.
- **Result:** no visible change yet.
- **Test:** `npm run lint` fails on a scratch file using `fontWeight: '800'`; passes on the tree.
- **Size:** S.

### 1.5 `GlassSheet`: one sheet for the whole app

- **Now:** `components/player/PlayerSheet.tsx` is the one good sheet: springs open, drags down, hands
  scroll to its list. Even it drops the flick on close (`:104` runs a 240 ms ease-in with no velocity,
  `:140` calls `onClose()` bare), its scrim ignores the drag (`:110`), and its travel is a guess
  (`:111`, 520 or 900). Thirteen other sheets are RN `<Modal animationType="slide">` (Wave 4).
- **Change:** move `PlayerSheet` to `components/allegra/GlassSheet.tsx` (keep a re-export at the old path
  so the player sheets don't change in this PR) and fix it:
  1. **Measured travel.** `onLayout` on the card stores its height in a shared value; `travel` = height
     + 24. A short sheet no longer waits on invisible distance.
  2. **The close keeps the flick.** On a swipe close, fold the drag into `shown` (`shown = 1 - drag/travel`,
     `drag = 0`) on the UI thread, then `shown = withSpring(0, { ...flingSpring(vy), velocity: -vy / travel })`
     and call `onClose` from the spring's end callback. A button close (`visible` → false) uses
     `Motion.spring.open` with no velocity, so it decelerates instead of accelerating away.
  3. **The scrim follows the finger.** `opacity: shown.value * (1 - drag.value / travel.value) * SCRIM`.
  4. **Reduce Motion.** `translateY` stays 0; `shown` drives opacity only, over `Motion.duration.base`.
  5. **A portal host.** Add `GlassSheetHost` at the root of `RootNavigator` (next to `MoreMenuHost`) so a
     sheet opened from any screen draws above the tab bar and the pill. Keep in-place rendering as the
     default for the player's own sheets (they must stay inside the player for the drag stacking rule).
  6. **Props.** `visible, onClose, title?, tall?, palette?` (cover tint for player sheets, neutral
     `Frosted` otherwise), `children`. The grabber is drawn by the sheet and is the drag handle.
- **Result:** every sheet opens on the same spring, follows the finger down with the scrim fading as it
  goes, and leaves at the speed it was thrown. A slow drag past halfway closes; a quick flick from
  anywhere closes; anything else springs back.
- **Test:** keep `navigation/sheetClose.test.ts` for the close decision; add `glassSheetMath.test.ts` for
  the drag-to-shown fold and the scrim formula (pure functions extracted from the component). Phone:
  open the sleep timer, flick it shut hard, then drag it halfway and let go slowly; the first leaves fast
  with no pause, the second settles back, and the scrim lightens as you drag in both.
- **Size:** L.

---

## Wave 2: the things a listener feels most

Six fixes, each small, each on a path used every day. This is the PR to ship right after Wave 1.

### 2.1 The dead ••• on playlist rows, and long press means one thing

- **Now:** `PlaylistItem.tsx:154-157` draws a `Pressable` ••• with no `onPress`: it does nothing and eats
  taps on that part of the row. Songs in a playlist have no actions at all
  (`PlaylistDetailScreen.tsx:516-532` passes only `onDelete`). Long press opens the actions sheet in
  Library (`LibraryScreen.tsx:101,113`) but silently queues "Play next" on Stream
  (`StreamScreen.tsx:399-403` and six more call sites) and Search (`SearchScreen.tsx:543`).
- **Change:**
  1. `PlaylistItem` takes `onMore` and wires both the ••• (`Tactile`, `accessibilityLabel="More for <title>"`,
     `hitSlop` 12) and the row's `onLongPress` to it.
  2. `PlaylistDetailScreen` passes `onMore={() => songActions.open(song)}` from `useSongActions()`, the same
     sheet Library uses, with "Remove from this playlist" added to the sheet's rows when opened from a playlist.
  3. Stream and Search long press open the same actions sheet. "Play next" is the first row of that sheet.
- **Result:** every song row in the app answers a long press with the same sheet, and the ••• on a
  playlist row opens it.
- **Test:** `PlaylistItem.test.tsx`: pressing the ••• calls `onMore`; long-pressing the row calls `onMore`.
  A source guard (`src/longPressGuard.test.ts`) fails if any `onLongPress` in `screens/` or `components/stream/`
  calls `playNext` directly. Phone: long press a song in Library, Stream, Search and a playlist; the same
  sheet opens each time.
- **Size:** S.

### 2.2 Remove the layout-animation crash pattern from Settings

- **Now:** `SettingsKit.tsx:71` puts `layout={LinearTransition}` on a section, and `:92` puts an
  `exiting={ExitFade}` child inside it that unmounts when a section collapses. `apps/mobile/CLAUDE.md`
  records this exact pattern crashing Reanimated 4.1 on Android; the app is on `~4.1.1`. The smoke test
  never collapses a section. `stream/DownloadsTray.tsx:21` stacks `entering` + `exiting` + `layout` on one view.
- **Change:** in `SettingsKit.Section`, drop `layout` and `exiting`. The body stays mounted while it fades:
  an `open` shared value drives `opacity` (`Motion.duration.base`) and the body unmounts from the timing's
  end callback, the same way `NowPlayingControls` keeps its volume row. In `DownloadsTray`, keep `entering`,
  drop `layout`, and replace `exiting` with the same fade-then-unmount.
- **Result:** collapsing and expanding Settings sections can't take the app down. Visually the same fade.
- **Test:** a source guard added to `workletSafety.test.ts` (or its own `layoutAnimationGuard.test.ts`):
  fail when a JSX element with a `layout=` prop has a descendant in the same file with an `exiting=` prop.
  It must fail on today's `SettingsKit.tsx`. Phone and CI: extend `.github/scripts/mobile-player-probe.sh`
  (or the navigation probe) to open Settings and tap every section header twice.
- **Size:** S.

### 2.3 The cover swipe keeps the finger's speed, and stretches when there is nowhere to go

- **Now:** `NowPlayingScreen.tsx:566`: a committed swipe exits on `withTiming(dir * windowW, { duration: 160,
  easing: Easing.in(Easing.quad) })`. The finger may be at 2–3 k px/s; the cover restarts from zero and
  accelerates, a visible hitch at release. `:583-586`: with no next or previous song the cover still follows
  the finger 1:1, then springs back with a warning buzz, which feels like failure after a full-width drag.
- **Change:**
  1. Exit: `stageX.value = withSpring(dir * windowW, { ...Motion.spring.fling, velocity: e.velocityX }, done => …)`.
     `overshootClamping` ends it the moment it reaches the edge, so the existing done-callback logic stays.
     Pass `e.velocityX` from `onEnd` into the commit function (it currently takes only `dir`).
  2. Edge: in `onUpdate`, when `!swipePreviewAvailable.value` (or no adjacent song in that direction),
     `stageX.value = rubberBand(e.translationX, 120)` from `physics.ts` instead of `e.translationX`. The
     `refuse()` haptic fires once, when the stretch passes 24 pt, not on release.
- **Result:** a fast flick throws the cover off-screen in one continuous motion. Pulling toward a song that
  isn't there gives about 20 pt of stretch that resists harder the further you pull, then eases home.
- **Test:** `physics.test.ts` covers `rubberBand`. Phone, 60 Hz and 120 Hz if available: flick the cover hard
  ten times with Settings → About → Frame rate on; no frame below 55 fps on the UI line during the exit, and no
  pause at release. On the last song of a queue with repeat off, drag left: the cover moves only a little.
- **Size:** S.

### 2.4 Calm the bouncy springs

- **Now:** `PILL_BOUNCE` (`PillPlayer.tsx:80`, stiffness 520 / damping 16 / mass 0.7, damping ratio about 0.42)
  wobbles the pill twice on every release. `LuvControls.tsx:125-129` runs 0.8 → 1.1 → 1 (ratio about 0.22) on
  every Luvs button, and `:134-152` has no `onPressOut`, so a finger sliding off leaves the button shrunk at 0.9.
- **Change:**
  1. `PILL_BOUNCE` → `{ stiffness: 520, damping: 26, mass: 0.7 }` (ratio about 0.68: one small settle, no wobble).
  2. `LuvButton` becomes a `Tactile` (`pressScale={0.9}`, `haptic="select"`), so press-in and press-out are
     handled. The burst (`PulseRing`) and a single 1 → 1.12 → 1 pop on `Motion.spring.settle` stay for the
     heart only, when `on` turns true.
- **Result:** the pill lands like a held object. Luvs buttons press like every other button; liking still feels
  like an event.
- **Test:** `physics.test.ts`: a helper `dampingRatio(spring)` and an assertion that every spring exported from
  `allegraTheme.Motion.spring` and `PILL_BOUNCE` has a ratio ≥ 0.6. Phone: press a Luvs button, slide off, let go;
  it returns to full size.
- **Size:** S.

### 2.5 Every scrolling screen clears the pills

- **Now:** `hooks/useBottomClearance.ts` is right but only Library and Search use it. Blends (`BlendsScreen.tsx:111`,
  160, no insets), Import (`ImportScreen.tsx:70`, 150) and Your DJ (`DjScreen.tsx:346`) end under the pill. Stream
  (`StreamScreen.tsx:436`) uses the classic mini player's height. Settings (`:251`), Artist (`:116`), Collection
  (`:89`), Playlists (`:289,324`) and Blend (`:246`) each compute their own number.
- **Change:** all of them use `const bottom = useBottomClearance(extra)`; Stream passes `Space.lg`. Delete the local math.
- **Result:** the last row of every screen sits above the pill with the same breathing room, with or without a song.
- **Test:** `bottomClearanceGuard.test.ts`: fail on `paddingBottom:` with a numeric literal ≥ 100 in any file under
  `screens/`. Phone: with a song playing, scroll to the bottom of each of the ten screens; the last row is fully visible
  and tappable.
- **Size:** S.

### 2.6 Lyrics fullscreen as one motion

- **Now:** entering fullscreen sets `lyricsP` with no timing (`NowPlayingScreen.tsx:430`), unmounts the header
  (`:826`) and swaps `NowPlayingControls` for a different tree (`NowPlayingControls.tsx:424`). The transport vanishes
  and a top bar appears in one frame, in the middle of a player that is otherwise one continuous motion.
- **Change:**
  1. Add `fullP` (0..1), driven by `withTiming(target, { duration: Motion.duration.morph, easing: Motion.ease.morph })`.
     `lyricsP` keeps its own timing; fullscreen no longer forces it.
  2. Keep the header and both control layouts mounted. With `fullP`: the transport block translates down by its
     measured height and fades over the first 60%; the compact fullscreen header fades and drops 12 pt into place over
     the last 60%; the lyric list's top inset interpolates between the two layouts (transform on a wrapper, not padding).
  3. `pointerEvents` on whichever layout is hidden is `'none'` (set from React state when the timing ends, so a tap
     mid-morph still lands on what you can see).
  4. Reduce Motion: opacity crossfade only, no translate.
- **Result:** going fullscreen, the controls slide away and the lyrics take the space, in about half a second, and
  coming back reverses it. Nothing pops.
- **Test:** a source guard in `NowPlayingControls.test.ts` (or a render test) that both layouts exist in the tree
  while `lyricsFullscreen` is true. Phone: toggle fullscreen lyrics five times quickly, including mid-morph; the
  transport is never missing when fullscreen is off, and nothing flashes.
- **Size:** M.

---

## Wave 3: every tap answers the finger

- **Now:** 215 bare `<Pressable>` and 5 `<TouchableOpacity>` against 112 `<Tactile>`. About 110 of the bare ones
  are interactive (the rest are sheet backdrops). Some give no feedback, some snap for one frame. The list by
  surface is in the review, section 7a.
- **Change:** migrate in this order, one commit per group, using `Tactile` for buttons and chips and `TactileRow`
  for rows and cards:
  1. Player: `PlayerMenu.tsx:36,43`, `PlayerSheet.tsx:185,191`, `NowPlayingControls.tsx:514,520,672,684`,
     `NowPlayingHeader.tsx:49,53,59`, `UpNextPanel.tsx:358`, `PillPlayer.tsx:270,298` (the pill body: a
     `Tactile` with `pressScale={0.98}` so a tap that misses the pan slop still shows).
  2. Library and playlists: `LibraryScreen.tsx:319,327,333`, `PlaylistItem.tsx:102,111,146`,
     `PlaylistDetailScreen.tsx:697,702,711,719,813`, `PlaylistsScreen.tsx:170,175,190`.
  3. Menus and shelves: `MoreMenu.tsx:205`, `BrowseShelf.tsx:31,49`, `StreamItems.tsx:57,84`,
     `CollectionScreen.tsx:66,70`, `SearchScreen.tsx:647`, `VoiceSearchCard.tsx:207,211`, `AboutSheet.tsx:254`.
  4. Modals (most get replaced in Wave 4; migrate only what survives it): `ModernDeleteModal`, `LanguagePickerModal`,
     `LibraryEditModal`, `PlaylistSelectionModal`, `LuvLinkHost.tsx:71,74`, `LrcSearchModal` (the 5 TouchableOpacity).
  5. The rest: `DjScreen.tsx` ×12, `BlendScreen`, `BlendsScreen`, `CustomTabBar.tsx:54`, `SettingsKit.tsx:126`,
     `LuvLinkPanel.tsx:33`.

  Every icon-only control gets an `accessibilityLabel` as it moves. Then turn on the guard.
- **Result:** every tappable thing in the app sinks and lights under the finger for at least 70 ms and comes back
  as fast; nothing is dead to the touch.
- **Test:** `pressableGuard.test.ts`: walks `src/` and fails on a JSX `<Pressable` or `<TouchableOpacity` outside
  `components/allegra/` unless the element has `accessibilityElementsHidden`/`importantForAccessibility="no"` (backdrops)
  or a `// press-ok: <reason>` comment on the line above. Ships with an allowlist that shrinks with each group above and
  is empty when the wave is done. Phone: run through each screen tapping every control once, quickly.
- **Size:** M (mechanical, but many files).

---

## Wave 4: one sheet language

### 4.1 Move the thirteen RN modal sheets onto `GlassSheet`

- **Now:** `<Modal animationType="slide" transparent>` in `LibraryBottomSheet.tsx:55` (the song actions, the most used),
  `DownloadQueueModal.tsx:90`, `AddListSheet.tsx:111`, `PlaylistSelectionModal.tsx:63`, `SongVersionSearchModal.tsx:97`,
  `LanguagePickerModal.tsx:48`, `LuvsVaultModal.tsx:85`, `AboutSheet.tsx:111`, `ConnectDropdown.tsx:35`,
  `CoverArtSearchScreen.tsx:65`, `SettingsScreen.tsx:501,559`, and `AddToPlaylistModal`. The dark scrim slides up with
  the card, nothing swipes down, five draw a grabber that does nothing, and none respect Reduce Motion.
- **Change:** each becomes a `GlassSheet` rendered through `GlassSheetHost`. Lists inside use `SheetScrollView` /
  `SheetScrollable` so the sheet's drag yields to a scrolled list. Text inputs inside (AddListSheet, search modals) keep
  the keyboard: the sheet lifts by `useAnimatedKeyboard().height` (transform). Order: `LibraryBottomSheet` first (it also
  serves 2.1), then the rest in the order above.
- **Result:** every sheet in the app opens, drags and closes the same way as the player's sheets, and the scrim fades in
  place instead of sliding.
- **Test:** a source guard fails on `animationType="slide"` anywhere in `src/`. Phone: open each sheet, drag it halfway,
  release, then flick it shut. On the search sheets, type with the keyboard up and check the field stays visible.
- **Size:** L.

### 4.2 Menus are sheets; one confirmation

- **Now:** `CustomMenu` anchored dropdowns (`PlaylistsScreen.tsx:226`, `PlaylistDetailScreen.tsx:764,772`) although
  the rule says menus are sheets. Three confirmation styles: native `Alert.alert` (`PlaylistsScreen.tsx:122`,
  `SettingsScreen.tsx` ×5, `BlendScreen.tsx` ×3), `ModernDeleteModal`, `CustomAlert`.
- **Change:** `CustomMenu` uses become `GlassSheet` lists of `TactileRow`s. Add `allegra/ConfirmSheet`
  (`title`, `body`, `confirmLabel`, `destructive?`, `onConfirm`): a short `GlassSheet` with two buttons, the destructive
  one in `Signal.danger` (a new toned red, `#e5484d`, replacing `#ff4444`). Replace every `Alert.alert` that asks a
  question and both custom modals with it. Alerts that only inform become toasts.
- **Result:** deleting a playlist, deleting a song and leaving a blend all ask the same way.
- **Test:** a source guard fails on `Alert.alert(` with more than one button, and on imports of `CustomMenu`,
  `ModernDeleteModal` or `CustomAlert` once they are deleted. Phone: delete a playlist, then a song.
- **Size:** M.

---

## Wave 5: continuity and scrolling

Each item is S unless marked.

| # | Now | Change | Result | Test |
|---|---|---|---|---|
| 5.1 | `SettingsKit.Choice` (`:164-176`) moves the selected fill from cell to cell in one frame | One indicator view behind the cells, `translateX` to the chosen cell's measured x on `Motion.spring.open` | The highlight slides between options | Phone: switch Player background three ways |
| 5.2 | Library sort/filter (`LibraryScreen.tsx:333-344`) and Up next chips (`UpNextPanel.tsx:358-368`) swap the list in one frame | Key the list container on the filter and fade it in over `Motion.duration.fast`; the list itself never remounts | The new order fades in | Phone: switch sort twice quickly |
| 5.3 | The lyrics button's white "on" fill snaps (`NowPlayingControls.tsx:698,772`); the A–Z rail mounts with no fade (`LibraryScreen.tsx:406-412`); "Editing playlist" pops (`PlaylistDetailScreen.tsx:757`) | Opacity on a shared value, `Motion.duration.fast`, element stays mounted | Each fades | Phone |
| 5.4 | Inside Library, Playlists slides in from the right but PlaylistDetail rises from the bottom (`TabNavigator.tsx:79`) | `animation: 'slide_from_right'` for PlaylistDetail | Drilling down keeps one direction | Phone: Library → Playlists → a playlist → back twice |
| 5.5 (M) | Edit mode swaps `AnimatedFlashList` for `AnimatedDraggableFlatList` (`PlaylistDetailScreen.tsx:728-756`): the list remounts and loses its scroll; ••• toggles edit mode where every other ••• opens a menu (`:719-725`) | One list (`react-native-reorderable-list` over FlashList, or keep the draggable list in both modes with drag handles hidden); a pencil button toggles edit mode, ••• opens a playlist actions sheet | Entering edit mode keeps your place | Phone: scroll halfway, edit, finish; same position |
| 5.6 | Quick picks pager (`StreamHome.tsx:160-166`) has no `disableIntervalMomentum`, so a hard flick skips 2–3 pages; cover shelves (`StreamHome.tsx:193`, `BrowseShelf.tsx:91`) stop mid-cover | `disableIntervalMomentum` on the pager; `snapToInterval={COVER + gap}` + `decelerationRate="fast"` on shelves | One page per flick; shelves rest on a cover edge | Phone |
| 5.7 | Only Library scrolls to top on a tab re-tap | Generalise `registerLibraryScrollToTop` into `navigation/scrollToTop.ts` (`registerScrollToTop(routeKey, fn)`) and register Search, Settings, Playlists, Artist, Collection | A re-tap scrolls any tab page to the top | `scrollToTop.test.ts` for the registry; phone |
| 5.8 | Search, mood chips and mood mixes show a centred spinner (`StreamScreen.tsx:554,662,700`), then results replace it in one frame | Reuse the feed's row skeleton; wrap each section's first render in `RiseIn index={i}` (capped at 6) | Loading looks like the page it becomes | Phone on a throttled network |
| 5.9 | `CollectionScreen` (100+ song albums) and `AddToPlaylistModal` (the whole library) are FlatList; `PlaylistDetailScreen.tsx:733` passes `estimatedItemSize` (ignored by FlashList v2) under an `as any` cast; `scrollEventThrottle={1}` (`:740,751`) | FlashList for both; drop `estimatedItemSize` and the cast; throttle 16 | Long lists scroll without blank frames | Phone: fling a 200-song album |
| 5.10 | `TimelineScrubber.tsx:225-230` animates `height` and `borderRadius` per frame (Luvs and the classic mini player); `MiniPlayer.tsx:130-141` animates skip-button `width`, `:423` the classic shell `height`; `YtMiniPlayer.tsx:46-87` springs `width/height` on the JS thread | Port `AppleSlider`'s `scaleY` track; skip buttons fade and translate; YtMiniPlayer moves to a Reanimated pan with `transform` (M) | Rule 5 holds everywhere; Luvs scrubbing is smooth on low-end phones | `transformOnlyGuard.test.ts`: fail on `height:`/`width:` returned from a `useAnimatedStyle`; phone with the frame rate readout |
| 5.11 | Sheet top corners animate per frame (`NowPlayingScreen.tsx:354-358`, `ConnectRemotePlayer.tsx:297`), rebuilding the clip path each frame | `Math.round(corner)` as `MiniPlayer.tsx:430-436` already does | Fewer path rebuilds during the drag | Phone: frame rate readout while dragging the player |
| 5.12 | Up next Shuffle can't be undone | "Undo" action on the toast `UpNextPanel.tsx:310` already shows, restoring the previous order through `updateQueue` | A mistaken shuffle is one tap back | `UpNextPanel` store test: shuffle then undo restores ids in order |

---

## Wave 6: Reduce Motion collapses to opacity

- **Now:** 29 animated files have no Reduce Motion branch, among them `PillPlayer` (the disc keeps turning, the bounce
  and 24 pt rise stay), `PlayerSheet`, `UpNextPanel`, `Toast` (16 pt slide), the download spinners, `AlphabetRail`,
  `CustomMenu`, `LuvsScreen`, `MiniPlayer`, `PlaylistItem` (random equaliser loop), `AppleBackdrop`, `GlowBackground`,
  `AmbientMode`, `ImportTray`, `LuvLinkHost`. Where a branch exists it often still translates: the player sheet slides
  200 ms (`NowPlayingScreen.tsx:131-133,165-167`, and Connect's copy at `ConnectRemotePlayer.tsx:131,152`),
  `TasteExplorer.tsx:185`, `GlassDeck.tsx:166,200`.
- **Change:** one rule, applied file by file: under `useReducedMotion()`, every position, scale and rotation is set
  instantly and only opacity animates, over `Motion.duration.base`. Loops (disc spin, equaliser, spinners) stop and show
  a still state; a spinner becomes a static arc that pulses opacity once a second (the one loop allowed, because it means
  "still working"). Features never turn off: the sheet still opens, the deck still pages.
- **Result:** with Android's "Remove animations" on, the app fades between states and nothing slides, spins or bounces.
- **Test:** `reduceMotionGuard.test.ts`: every file under `components/` and `screens/` that imports `withSpring`,
  `withTiming`, `withRepeat` or a layout animation must also reference `useReducedMotion` (allowlist with a reason for the
  rare pure-opacity file). Phone: Settings → Accessibility → Remove animations on, then pill → player → lyrics → Up next →
  a sheet → back. CI emulators run with animations off, so the existing smoke and player probe already exercise this path;
  check their screenshots for half-moved states.
- **Size:** M.

---

## Wave 7: one look

Polish mode: these keep the palette, type and layout and only make them consistent.

### 7.1 Colour

- Text over artwork or glass uses only `Signal.onMedia.primary/secondary/muted`. Replace the 13 levels (review, pillar 3).
- One pressed tint: `Glass.fillPressed` (the six others go with Wave 3).
- No dark veils: the Library sticky play bar (`LibraryScreen.tsx:491`, opaque 0.95) becomes `Frosted` at tint 0.55;
  the Up next shade over the cover (`NowPlayingScreen.tsx:870`) drops from 0.5→0.72 to 0.35→0.5; the Library status scrim
  (`:391`) and the tab scrim (`ModernPillTabBar.tsx:175`, 0.96) end at 0.8.
- `#666`, `#ff4444`, `#1C1C1E` and the hex in `PlaylistDetailScreen` (20) move onto `Signal`/`Glass`.
- The chartreuse Settings section icons (`SettingsKit.tsx:62`, seven accent dots on one page) become `Signal.onMedia.secondary`
  glyphs in a glass disc; the accent stays on the switches, which are the selection.
- **Test:** `colorGuard.test.ts`: count `rgba(` and `#xxxxxx` literals under `screens/` and `components/` (excluding
  `allegra/` and theme files) and fail if the count rises above the number recorded when the wave lands. Phone: compare
  before/after screenshots of Library, Up next and Settings.

### 7.2 Type

- Every `fontSize` comes from `Type`. Sub-11 sizes go to 11 (tab labels 10.5 → 11, badges 10 → 11).
- Weights only `'400' | '600' | '700'`: `'500'` → `'400'` or `'600'` by intent, `'800'/'900'` → `'700'`.
- Remove the five unjustified `letterSpacing` uses.
- `NowPlayingControls.tsx:741` stops overriding `PlayerType.title`'s weight; fix the token to `'700'` instead.
- `fontVariant: ['tabular-nums']` on every live number: sleep timer label (`NowPlayingControls.tsx:686`), Up next durations
  (`UpNextPanel.tsx:151`), download counts, Library meta.
- **Test:** the lint rule from 1.4 with its allowlist emptied. Phone: watch the sleep timer count down; digits don't shift.

### 7.3 Spacing

- Snap off-grid values (3, 5, 7, 9, 11, 13, 15, 17) to the 4 pt grid; 2 stays for nudges inside small controls.
  Worst: `DjScreen.tsx` (gap 13/11/9, padding 15/17), `UpNextPanel.tsx:470` (15).
- 14 and 18 are used 127 times: snap them to 12/16 in rows and chips; keep 14 only as `Space` gains a named step if a
  screen genuinely needs it.
- Round glass buttons: 40 (hitSlop to 48) for secondary, 44 for the player footer. Today 38, 40, 42×44 and 44 coexist.
- **Test:** an `offGridGuard.test.ts` counting odd padding/margin/gap literals, failing above the recorded baseline.

### 7.4 Icons and copy

- One glyph per transport action across pill and player: `play-skip-back` / `play-skip-forward` (the pill already uses
  these; `NowPlayingControls.tsx:619,631` and the glass pill `PillPlayer.tsx:293` change).
- One icon family per row: the player footer (`NowPlayingControls.tsx:672-703`) moves to MaterialCommunityIcons
  throughout (`format-list-bulleted` for the queue) so stroke weights match.
- Copy fixes from the review, pillar 1: plain error messages instead of raw `e.message` (`SettingsScreen.tsx:103,116,129`,
  logged with `diag`), `countOf(n, 'song')` instead of "song(s)", "Buy me a coffee" without the emoji
  (`AboutSheet.tsx:137`), "Unknown artist" everywhere (including the notification strings in `PlayerContext.tsx`),
  curly apostrophes, no trailing period on one-line empty states, "Delete “Name”? Songs stay in your library."
- **Test:** `copyGuard.test.ts`: fail on `'Unknown Artist'`, `(s)` in a string literal, emoji in `.tsx` string
  literals, and `Alert.alert('Error'`. Phone: trigger the Settings import with a bad file.

### 7.5 Screens that look like another app (decide first, see below)

- **Your DJ** (`DjScreen.tsx:413-441`) is a light cream screen with a blinking, floating mascot inside a dark glass app.
  Proposed: reskin onto `DynamicAura` + `Frosted` + `Signal`, keep the mascot still except when it is speaking (L).
- **Playlist detail header** (`PlaylistDetailScreen.tsx:686-725`): `#666`/`#fff` icons, no labels, a raw `BlurView`.
  Move to the Library header's glass buttons and `Frosted` (M, with 5.5).
- **Blends, Blend, BlendJoin, Import** use React Navigation's native header (`TabNavigator.tsx:51`, `BLEND_HEADER`)
  where every other page draws its own large title over the aura. Draw the same title header (M).
- `AuroraHeader`'s static fallback (`AuroraHeader.tsx:107-108`) is coloured blobs when a playlist has no cover: use the
  playlist's generated artwork tones instead (S).

---

## Testing: how the whole plan is proven

1. **Automated, every PR.** `npm run ci` in `apps/mobile` (check-secrets, lint, typecheck, jest). New tests from this
   plan are of two kinds: pure-math tests for anything with numbers (`physics.test.ts`, `glassSheetMath.test.ts`), and
   source guards that read `src/` and fail on the pattern a wave removed (pressable, slide modals, layout+exiting,
   reduce-motion, transform-only, colour and copy guards). A guard is written first and must fail on the tree before
   the wave's changes. Guards with a baseline (colour, off-grid) record the count when the wave lands and only allow it
   to fall.
2. **On an emulator, in CI.** `mobile-player-probe.sh` and `mobile-navigation-probe.py` already drive the release
   build through `lyricflow://` links. Extend the navigation probe to: collapse every Settings section (2.2), open each
   migrated sheet and send a swipe down with `adb shell input swipe` (4.1), and toggle lyrics fullscreen (2.6). The
   `launch-check` release gate stays as it is.
3. **On a real phone, per wave.** The owner's mid-range Android phone with Settings → About → Frame rate on. Each
   wave lists its phone checks; the bar for "smooth" is no UI-thread frame under 55 fps during the gesture in question
   and no JS-thread drop below 45 during a sheet or player open. Run every wave once more with Battery Saver on (the
   low tier) and once with Remove animations on.
4. **Before/after screenshots.** For waves 5 and 7, the same five screens (Stream, Library, a playlist, Now Playing
   with Up next open, Settings) captured before and after through the smoke test's screenshot step, attached to the PR.

## Order and size

| Wave | What | Size | Depends on |
|---|---|---|---|
| 0 | Crash fix | done (1.35.4) | |
| 1 | Foundations: tokens, physics, `TactileRow`, haptics, `GlassSheet` | L | |
| 2 | Six fixes a listener feels daily | M | 1.1, 1.2 |
| 3 | Every tap answers the finger | M | 1.2, 1.3 |
| 4 | One sheet language | L | 1.5 |
| 5 | Continuity and scrolling | M–L | 1.1 |
| 6 | Reduce Motion | M | 1.5, 3 |
| 7 | One look | L | 1.4, 4 |

Waves 3 and 5 touch different files and can run at the same time on separate branches; everything else goes in order.

## Decisions for the owner

These change what the app looks or behaves like beyond polish, so they wait for a yes:

1. **Your DJ:** reskin onto the dark glass (proposed), or keep it as a deliberate light card?
2. **Long press:** make it open the actions sheet everywhere (proposed, 2.1), which removes the quick "long press to
   play next" on Stream and Search?
3. **One name:** the feature is "LuvLink" in its sheet (39 strings) and "Listening together" on the header chip. Which one?
4. **The info "i"** beside every page title: show it only until that page's tour has been seen once?
5. **Settings section icons:** drop the chartreuse discs for neutral glass (7.1)?
