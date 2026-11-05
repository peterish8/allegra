# LuvLyrics (apps/mobile): UI review

**Audited:** 2026-11-04
**Baseline:** abstract 6-pillar standards, `apps/mobile/CLAUDE.md` design rules (owner decisions kept as given), heydamir/unslop checklist translated to React Native, plus a 7th section on motion, touch and continuity
**Screenshots:** not captured. This is a code-only audit with no device or emulator. Every finding comes from reading the source.
**Scope:** `src/screens/*`, `src/components/**` (PillPlayer, MiniPlayer, player/*, stream/*, library/*, settings/*, luvs/*, connect/*, about/*), `src/navigation/*`, tokens in `src/constants/allegraTheme.ts`, primitives in `src/components/allegra/motion.tsx`, haptics in `src/utils/haptics.ts`

Already fixed and not reported again: uppercase and tracked labels (no `textTransform` is left anywhere), haptics imported directly (every call goes through `utils/haptics`), the live blur under the dragged sheet, per-line lyric springs, the lyrics `exiting` row inside `NowPlayingControls`, and Android tab fades.

---

## Pillar scores

| Pillar | Score | Key finding |
|--------|-------|-------------|
| 1. Copywriting | 3/4 | Mostly specific, sentence-case copy. Leftovers: raw `e.message` in alerts, `song(s)`, an emoji in About, five "Unknown Artist" strings in title case, "Error" as a dialog title |
| 2. Visuals | 2/4 | The player is excellent. Your DJ is a cream light-theme screen inside a dark glass app, Playlist detail is still the old UI, and every playlist row has a ••• that does nothing |
| 3. Color | 2/4 | 453 inline `rgba()` values, about 12 white-alpha text levels, 6 different pressed tints, raw `#666`/`#ff4444`/`#1C1C1E`, and dark veils at 0.94–0.96 on chrome |
| 4. Typography | 2/4 | 28 font sizes (including 8, 10.5 and 12.5). `'500'` (9 uses) renders Regular and `'800'/'900'` (26) render Bold. `letterSpacing` appears in 6 places despite the rule |
| 5. Spacing | 2/4 | `Space` tokens appear 147 times against roughly 1,000 literal values. About 70 values are off the 4pt grid. Bottom clearance is worked out 7 different ways, and 3 screens end under the pill |
| 6. Experience design | 2/4 | 13 sheets are RN `Modal animationType="slide"` (the scrim slides up with the sheet, grabbers can't be dragged). Three different confirmation systems. Long press means different things on different screens. Settings uses a layout animation pattern that has crashed before |
| 7. Motion, touch and continuity | 2/4 | The player sheet physics are reference-grade. Elsewhere: about 110 bare `Pressable`s with snapped, opacity-only or no feedback, exits that drop flick velocity, lyrics fullscreen pops in and out, 29 animated files with no Reduce Motion branch, and about 80 durations not taken from tokens |

**Overall: 13/24 on the six standard pillars, 15/28 with Motion.**

To be fair to the player: the pill → Now Playing → lyrics → Up next path on its own would score 3.5 on Motion. The rest of the app hasn't caught up with it yet.

---

## Top 3 priority fixes

1. **About half of the app's taps get no tactile answer.** List rows, chips, sheet rows and header icons give either nothing or a one-frame background flash. That makes the app feel uneven next to the player. Fix: route them all through `Tactile`, and add a row variant (animated surface step, `MIN_PRESS_MS` hold) for list rows.
2. **Playlist rows have a ••• button with no `onPress`** (`components/PlaylistItem.tsx:154`). It also swallows taps. A song in a playlist has no actions menu at all. Fix: wire it, and a long press, to `useSongActions().open(song)`.
3. **Thirteen sheets don't behave like sheets.** RN `Modal` slides the dark scrim up with the content, there's no swipe-down, and the grabber is decoration. Fix: one glass sheet primitive (a generalised `PlayerSheet`) for every bottom sheet.

---

## Detailed findings

### Pillar 1: Copywriting (3/4)

The voice is mostly good: sentence case, specific errors ("These lyrics couldn't be drawn", `NowPlayingLyricsArea.tsx:297`), and toasts that say what happened ("Shuffled what plays next"). What's left:

- **WARNING** `hooks/useNowPlayingLogic.ts:102`: `Alert.alert('Error', 'Could not load audio file.')`. Generic title, robotic wording. Use "Couldn't play this song" with "The file on your phone can't be read. Try downloading it again."
- **WARNING** `screens/SettingsScreen.tsx:103,116,129`: raw `e.message` shown to the listener, with an 'Unknown error' fallback. This is the mobile version of root rule 4 ("error is user-facing copy"). Map errors to plain causes ("The file isn't a LuvLyrics backup") and log the raw message with `diag`.
- **WARNING** `screens/SettingsScreen.tsx:113,177`: `${n} song(s) imported successfully.`. Use `countOf(n, 'song')` (already used in `LibraryScreen.tsx:276`) and drop "successfully".
- **WARNING** `components/about/AboutSheet.tsx:137`: "Feel free to buy me a coffee 😉". An emoji in UI copy breaks the no-emoji rule (the row only shows once `UPI_ID` is set). Use "Buy me a coffee".
- **WARNING** "Unknown Artist" in title case at `components/MiniPlayer.tsx:97`, `components/PlaylistItem.tsx:142`, `contexts/PlayerContext.tsx:64,96,234`, while Up next and the player use "Unknown artist". The PlayerContext strings reach the notification and lock screen. Pick one: "Unknown artist".
- `screens/StreamScreen.tsx:648`: "Can't reach the catalog" uses a straight apostrophe. Everywhere else uses the curly one ("Couldn’t…"). Normalise.
- `screens/PlaylistsScreen.tsx:189`: "Create your first playlist to get started" is template copy. Say what a playlist does here, e.g. "Group songs you saved or streamed. They sync with Allegra on the web."
- `components/player/UpNextPanel.tsx:371`: one-line empty states end with periods ("Nothing queued after this song."). Unslop's rule is no period on single short lines.
- The feature has two names. The sheet title is "LuvLink" (`NowPlayingScreen.tsx:959`, 39 strings), but the header chip says "Listening together" (`NowPlayingHeader`). Name the feature once and use the other wording only as description.
- `screens/PlaylistsScreen.tsx:124`: "Are you sure you want to delete …?" Prefer "Delete “Name”? Songs stay in your library."

### Pillar 2: Visuals (2/4)

The focal points are strong. Now Playing (full-bleed cover, glow), the glass deck in Library and the Stream shelves each have one clear moment. The score is held down by surfaces that look like a different app:

- **BLOCKER** `components/PlaylistItem.tsx:154-157`: `<Pressable style={styles.moreButton} hitSlop={10}>` has **no `onPress`**. It's on every row of every playlist. It looks like an actions menu, does nothing, and catches the touch so the row's own tap doesn't fire in that area. A song in a playlist has no actions anywhere: `PlaylistDetailScreen.tsx:516-532` passes only `onDelete`. Project rule: "Don't ship a control that does nothing."
- **WARNING** `screens/DjScreen.tsx:413-441`: Your DJ (More → Your DJ) is a **light cream theme** (`#f7f6f2`, `#fffaf2`, white cards, brown shadows, `#30363c` buttons) inside a dark, cover-tinted glass app. It's the only screen without `DynamicAura`/`Signal`. It has a mascot with idle blink, float and bounce loops (`DjScreen.tsx:58-93`), plus 25 hex literals and 12 bare `Pressable`s. Either reskin it onto `Signal`/`Glass`/`Frosted`, or present it as a deliberate light card inside a dark sheet.
- **WARNING** `screens/PlaylistDetailScreen.tsx:686-725`: the header is the pre-Allegra style. Raw `#666`/`#fff` icons, no `accessibilityLabel` on search/add/••• (lines 697, 702, 711, 719, 813), and the **••• icon toggles edit mode** (`:719-725`) where every other ••• opens a menu. The edit toast is a raw `BlurView intensity={20}` (`:758`), not `Frosted`. Use a "pencil"/"Edit" control for edit mode and keep ••• for a menu sheet.
- **WARNING** The same transport action uses three glyphs: Now Playing `play-back`/`play-forward` (double triangle, `NowPlayingControls.tsx:619,631`), the tint/glow pill `play-skip-back/forward` (bar + triangle, `PillPlayer.tsx:333,352`), and the glass pill `play-forward` (`:293`). Pick one glyph per action across pill and player.
- **WARNING** One footer row mixes Ionicons and MaterialCommunityIcons (`NowPlayingControls.tsx:672-703`: `list` vs `devices`/`speaker`/`timer-outline`/`comment-quote-outline`), so stroke weight and optical size differ side by side. Keep one family per row.
- Blends, Blend, BlendJoin and Import use React Navigation's native header (`navigation/TabNavigator.tsx:51`, `BLEND_HEADER`). Every other tab page draws its own large title over the aura, so these four read as settings sub-pages from another app.
- `components/AuroraHeader.tsx:107-108`: the default aurora palette has rotating, scaling blobs (90 s and 20 s loops). It's only animated when `animated` is set (the Playlist detail call site doesn't set it), but the static fallback is still the "radial color blobs" slop sign when a playlist has no cover.
- An info-tour "i" sits beside every page title (Stream, Library, Search, Playlists, Blends). On first-run surfaces that's useful. Everywhere at once, it's chrome noise given the owner's "no clutter" taste. Consider showing it until the tour has been seen once.

### Pillar 3: Color (2/4)

The token set is good (`Signal`, `Glass`). Adoption is the problem: 192 `Glass.*` uses against **453 inline `rgba()` literals** in screens and components.

- **WARNING** Text-on-dark levels sprawl. White text appears at 0.45, 0.5, 0.55, 0.6 (19), 0.62, 0.68, 0.7, 0.72, 0.75, 0.8, 0.86, 0.9 and 0.92, beside `Signal.ink/inkSoft/inkMuted/inkFaint`. For example: `UpNextPanel.tsx:454,475` (0.6), `PillPlayer.tsx:391` (0.68), `NowPlayingControls.tsx:132-135` (`INK_SOFT` 0.62, `INK_META` 0.86). Add `Signal.onMedia = { primary: '#fff', secondary: 'rgba(255,255,255,0.86)', muted: 'rgba(255,255,255,0.62)' }` for over-artwork text and use only those three.
- **WARNING** Six pressed tints for the same "row pressed" meaning: 0.06 (`BrowseShelf.tsx:129`), 0.08 (`PlayerSheet.tsx:222`), 0.1 (`UpNextPanel.tsx:460`), 0.12 (`NowPlayingControls.tsx:775`), 0.14 (`PlayerMenu.tsx:146`, `ConnectDeviceSheet.tsx:195`), 0.16 (`LyricsPicker.tsx:113`, `PlayerExtras.tsx:104`), plus `Glass.fillPressed`. Use `Glass.fillPressed` only.
- **WARNING** Dark veils, against the owner's "no dark veils" taste:
  - `LibraryScreen.tsx:491`: the sticky play bar is an opaque `rgba(14,16,20,0.95)` slab.
  - `LibraryScreen.tsx:391`: the status scrim starts at 0.94.
  - `ModernPillTabBar.tsx:175`: the tab scrim runs to 0.96 over about 220pt.
  - `NowPlayingScreen.tsx:870`: Up next lays a 0.5→0.72 black gradient over the cover.
  - `PlayerSheet.tsx:203`: the sheet scrim is 0.45.
  - `AddListSheet.tsx:213`: 0.55.

  The sticky bar should be `Frosted` (tint ≈ 0.55) like other floating glass. The Up next shade can drop to about 0.35/0.5 now that the title sits on its own lifted row.
- **WARNING** Hard-coded colours outside the palette:
  - `PlaylistItem.tsx:111,146`: `#666`, `#ff4444`.
  - `SettingsScreen.tsx:714`: `#1C1C1E`, an iOS system grey.
  - `PlaylistDetailScreen.tsx`: 20 hex literals.
  - `DjScreen.tsx`: 25.

  Destructive red should be `Signal.accent` (or a toned `#e5484d` token), not `#ff4444`.
- Accent discipline is mostly right. `Signal.wave` marks play, progress, the selected sort chip and switches, and the player's chips use white glass instead of the accent, as specified. With 203 uses across 63 files it's worth one pass to check it never shows up as decoration (for example the chartreuse `headIcon` on every Settings section, `SettingsKit.tsx:62`, is seven accent dots on one page).

### Pillar 4: Typography (2/4)

Rule from `apps/mobile/CLAUDE.md`: SF Pro via `fontWeight` only, and only Regular/Semibold/Bold ship ("500 renders Regular, 800+ Bold").

- **WARNING** Weight values that can't render as written: `'500'` ×9 (all render Regular, so the intended "medium" is lost, e.g. `DjScreen.tsx:426` chipText) and `'800'` ×25 / `'900'` ×1 (render exactly like `'700'`, e.g. `AboutSheet.tsx:212,235`, `ArtistScreen.tsx:231`). Restrict the codebase to `'400' | '600' | '700'` and add a lint rule or a `Weight` type.
- **WARNING** `letterSpacing` still appears 6 times despite "no letterSpacing" (Android gets tracking from `sfTracking`, so these double it): `AboutSheet.tsx:212,235`, `SettingsKit.tsx:256` (-0.2 on 18pt), `ArtistScreen.tsx:231`, `DjScreen.tsx:424`, `LuvLinkPanel.tsx:182,191`. The room code (`letterSpacing: 5`) is the one case with a reason. Keep that one and comment it.
- **WARNING** 28 distinct font sizes: 8, 10, 10.5, 11, 12, 12.5, 13 … 44, 72, 132. Half-point sizes (`ModernPillTabBar.tsx:296` 10.5, two at 12.5) and sub-11 labels (`LibraryScreen.tsx:425` badge 10, `LuvsScreen.tsx:512` 10, `infoTours.tsx:386` 10, the tab label 10.5) fall below a readable floor on 1080p Android. Add a `Type` scale to `allegraTheme.ts` (11 meta, 13 secondary, 15 body, 17 row title, 22 player title, 28 page title, 34/42 display) and move screens onto it. Tab labels become 11.
- **WARNING** `NowPlayingControls.tsx:741`: `title: { ...PlayerType.title, fontWeight: '700' }` overrides the token's `'600'`. Either change the token or drop the override. Now the token is wrong for its main consumer.
- Tabular figures: `PlayerType.time` has them. The Up next row duration (`UpNextPanel.tsx:151`), the library meta, the badges and the countdowns don't, so digits shimmy as they change. Add `fontVariant: ['tabular-nums']` wherever a number updates live: the sleep timer label (`NowPlayingControls.tsx:686`) and download counts.

### Pillar 5: Spacing (2/4)

- **WARNING** Token adoption: `Space.*` appears 147 times. Literal padding, margin and gap values appear about 1,000 times. Distribution: 2(54) 3(19) 4(74) 5(7) 6(87) 7(14) 8(131) 9(9) 10(76) 11(6) 12(131) 13(7) 14(89) 15(7) 16(74) 17(1) 18(38) 20(43) 22(4) 24(26) 26(5). Off-grid values (3, 5, 7, 9, 11, 13, 15, 17 and so on) make up about 70. The worst offenders are `DjScreen.tsx` (gap 13/11/9, padding 15/17) and `UpNextPanel.tsx:470` (`paddingBottom: 15`). 14 and 18 are used so much that they're a de facto scale. Either add them to `Space` (as 14 = `sm2`) or snap them to 12/16.
- **WARNING** Bottom clearance is worked out 7 different ways. Rule: "Scrolling lists must clear both pills (~220pt)".
  - `hooks/useBottomClearance.ts`: correct, but only Library and Search use it.
  - `StreamScreen.tsx:436`: uses `CLASSIC_MINI_PLAYER_HEIGHT` (58) in pill mode, and pads even with no song.
  - `ArtistScreen.tsx:116`, `CollectionScreen.tsx:89`: `TAB_BAR_CLEARANCE + insets + 90`.
  - `SettingsScreen.tsx:251`: `150 + insets`.
  - `BlendsScreen.tsx:111`: `160`, no insets. On a 48pt gesture inset, the pill stack top is about 182pt, so **the last row sits under the pill**.
  - `ImportScreen.tsx:70`: `150`, no insets, so **under the pill**.
  - `DjScreen.tsx:346`: `max(insets, 32) + 128`, which touches or overlaps the pill.
  - `PlaylistsScreen.tsx:289,324`, `BlendScreen.tsx:246`: a fixed `220`.

  Use `useBottomClearance()` everywhere. Stream should use it too, with its `Space.lg` extra.
- Nested radius: `PlayerSheet` (radius 28, padding 16) holds rows at radius 12, which matches 28−16. Good. `UpNextPanel` chips use radius 17 on 34 (pill) inside a 28 panel. Fine.
- Same-thing-same-size: the round glass buttons come in 38 (`NowPlayingControls.tsx:743`, `LibraryScreen.tsx:428`), 40 (`LibraryScreen.tsx:495`), 42×44 (`PillPlayer.tsx:376`) and 44 (`NowPlayingControls.tsx:771`). Pick 40 (with hitSlop to 48) for secondary glass buttons and 44 for footer buttons.

### Pillar 6: Experience design (2/4)

State coverage is good on the main paths: the Stream skeleton plus the cached feed (`StreamScreen.tsx:635-650`), the Library empty card with a CTA (`LibraryScreen.tsx:364-375`), error boundaries with friendly copy (`App.tsx:282-285`, `NowPlayingLyricsArea.tsx:296`), and download states on one source. The interaction model is where it splits:

- **BLOCKER** The dead ••• on playlist rows (Pillar 2): a core task, acting on a song inside a playlist, can't be done.
- **WARNING (crash risk)** `components/settings/SettingsKit.tsx:71` puts `layout={LinearTransition}` on the Section, and `:92` puts a child with `exiting={FadeOut}` that unmounts when the accordion closes. This is the **same pattern `apps/mobile/CLAUDE.md` records as crashing Reanimated 4.1 on Android** ("exiting={FadeOut} row inside a layout={LinearTransition} box crashed the app"), and Reanimated here is `~4.1.1`. The CI smoke test only opens Settings, it doesn't toggle sections. Fix: drop `exiting` (unmount after a manual fade on a shared value) or drop `layout` and animate a measured height with transforms. `stream/DownloadsTray.tsx:21` stacks `entering`+`exiting`+`layout` on one view, which is lower risk but worth the same treatment.
- **WARNING** Thirteen bottom sheets are RN `<Modal animationType="slide" transparent>`:
  - `LibraryBottomSheet.tsx:55`: the Library long-press song actions, the most used of them.
  - `DownloadQueueModal.tsx:90`
  - `AddListSheet.tsx:111`
  - `PlaylistSelectionModal.tsx:63`
  - `SongVersionSearchModal.tsx:97`
  - `LanguagePickerModal.tsx:48`
  - `LuvsVaultModal.tsx:85`
  - `AboutSheet.tsx:111`
  - `ConnectDropdown.tsx:35`
  - `CoverArtSearchScreen.tsx:65`
  - `SettingsScreen.tsx:501,559`

  Three things go wrong with them:
  1. The scrim lives inside the modal, so **the dark overlay slides up from the bottom with the card** instead of fading in place (`LibraryBottomSheet.tsx:56,98`).
  2. There's no swipe-to-dismiss. Five of them draw a grabber (`styles.handle`) that does nothing: LibraryBottomSheet, DownloadQueueModal, SongVersionSearchModal, AddToPlaylistModal, CoverArtSearchScreen.
  3. The timing is native and fixed, with no velocity and no Reduce Motion.

  Meanwhile `PlayerSheet` already does all of this right. Promote it to `allegra/GlassSheet` (it needs a portal host at the root, as `MoreMenuHost` has) and migrate.
- **WARNING** Three confirmation systems: native `Alert.alert` (grey Material dialog, `PlaylistsScreen.tsx:122` delete playlist, `SettingsScreen.tsx` ×5, `BlendScreen.tsx` ×3), `ModernDeleteModal` (delete song), and `CustomAlert` (Settings, Luvs vault). Deleting a playlist and deleting a song look completely different. Use one glass `ConfirmSheet`.
- **WARNING** Long press means three things. In Library it opens the actions sheet (`LibraryScreen.tsx:101,113`). On Stream (`StreamScreen.tsx:399-403,532,594,609,616,621,722`) and Search (`SearchScreen.tsx:543`) it **silently queues "Play next"** with only a toast. On playlist rows it does nothing unless editing. Make long press = actions sheet everywhere and put "Play next" first in that sheet.
- **WARNING** Lyrics fullscreen is a hard cut. Entering sets `lyricsP` with no timing (`NowPlayingScreen.tsx:430`), unmounts the header (`:826`) and swaps `NowPlayingControls` for a different tree (`NowPlayingControls.tsx:424`). The transport vanishes and a top bar appears in one frame. The rest of the player is careful continuity, which makes this stand out. Keep both trees mounted and drive them from one `fullP` shared value: the transport slides down out of frame, the compact header fades and drops in from the top, and the `ROWS_MOVE` curve is reused.
- **WARNING** Loading feedback is mixed. The home feed gets a skeleton (`StreamScreen.tsx:637-643`), but search, a mood chip and a mood mix get a centred `ActivityIndicator` (`:554,662,700`). Then results replace the feed in one frame, with no `RiseIn` and no crossfade. Reuse the row skeleton for search, and wrap each section's first render in `RiseIn index={i}` (capped at 6).
- **WARNING** `PlaylistDetailScreen.tsx:728-756`: toggling edit mode swaps `AnimatedFlashList` for `AnimatedDraggableFlatList`. That remounts the whole list, **loses the scroll position** and re-runs the header. Keep one list and switch the row's controls (or use `react-native-reorderable-list` over FlashList).
- Tab re-tap: Library scrolls to top (`LibraryScreen.tsx:209`), Stream goes home on any tap (`StreamScreen.tsx:157-170`). Search, Settings, Playlists, Artist and Collection have no scroll-to-top on re-tap. Android listeners expect it. Generalise `registerLibraryScrollToTop` into a per-route registry.
- Destructive actions inside `PlayerMenu` (refetch, ringtone) and the queue's Shuffle act immediately. That's reasonable, but Shuffle can't be undone. Add "Undo" to the toast that `UpNextPanel.tsx:310` already shows.

### Section 7: Motion, touch and continuity (2/4)

**What is excellent and should be the template for everything else:**

- The player sheet (`NowPlayingScreen.tsx:67-89, 249-303`): critically damped springs (400 for a tap, 1500 for a flick, chosen by release speed), the finger's velocity handed to the spring, momentum projection deciding open or close (`projectMomentum`), a rubber band past the top, grabbing mid-flight continues from the current position, and the open is triggered mid-swipe from the pill (`PillPlayer.tsx:234-237`).
- `Tactile` (`motion.tsx:84-118`): one shared value for sink and dim, a 70 ms minimum press, it respects a caller's opacity, and it holds still under Reduce Motion.
- `MorphIcon`, `NudgeIcon` and `SwapText`: directional song changes.
- `GlassDeck` and `TasteExplorer`: flick velocity, one step per fling, rubber band (`TasteExplorer.tsx:198-215`).
- Up next: the title and transport are lifted by a measured transform, and the volume row is kept mounted.

**What breaks the feel:**

#### 7a. Press feedback: half the app skips `Tactile`

There are 112 `Tactile` uses against about 110 interactive bare `Pressable`s (backdrops excluded) and 5 `TouchableOpacity` (`LrcSearchModal.tsx`). The bare ones fall into three kinds:

- **No feedback at all.** These are a WARNING, the BLOCKER being the dead ••• in Pillar 2:
  - `PlaylistItem.tsx:102` (the whole playlist row), `:111`, `:146`
  - `PlaylistDetailScreen.tsx:697,702,711,719,813`
  - `UpNextPanel.tsx:358` (filter chips)
  - `LibraryScreen.tsx:319,327,333` (clear filter, artist chip, sort chips)
  - `NowPlayingHeader.tsx:49,53,59` (grabber, together chip, playing-on chip)
  - `NowPlayingControls.tsx:514` (dock thumbnail), `:520` (artist line)
  - `PlaylistsScreen.tsx:170,175,190`
  - `ModernDeleteModal.tsx:46,50`, `LanguagePickerModal.tsx:77,80`, `LibraryEditModal.tsx:56,59`
  - `PlaylistSelectionModal.tsx:50,71,84,98,114`
  - `VoiceSearchCard.tsx:207,211` (Play next and Download in the voice result)
  - `DjScreen.tsx` ×12, `BlendScreen.tsx`, `BlendsScreen.tsx`, `LuvLinkHost.tsx:71,74`
  - `CustomTabBar.tsx:54` (the classic tab bar: no feedback and no haptic)
  - `PillPlayer.tsx:270,298` (the pill body. The sheet answers fast, but a tap that misses the 14pt pan slop gets no acknowledgement until the spring starts)
- **A one-frame background or opacity snap.** These come from `style={({pressed}) => …}`, which isn't animated, and a tap shorter than one frame shows nothing, the exact problem `MIN_PRESS_MS` fixes:
  - `PlayerSheet.tsx:185,191` (sleep timer rows), `PlayerMenu.tsx:36,43` (every ••• menu row)
  - `NowPlayingControls.tsx:672,684` (output and timer segment)
  - `MoreMenu.tsx:205` (menu rows), `LibraryBottomSheet.tsx:30,86`
  - `BrowseShelf.tsx:31,49` (cards: opacity 0.8 + scale 0.98, snapped)
  - `StreamItems.tsx:57,84` (the RN fallback track row)
  - `SettingsKit.tsx:126` (Switch row, opacity 0.75)
  - `CollectionScreen.tsx:66,70`, `SearchScreen.tsx:647` (opacity 0.6), `AboutSheet.tsx:254`, `LuvLinkPanel.tsx:33`
- **A custom press that misbehaves.** `luvs/LuvControls.tsx:134-152` (`LuvButton`) sinks on `onPressIn` but has **no `onPressOut`**. Slide the finger off and the Luvs action button stays shrunk at 0.9 until the next press. Its release runs a 0.8 → 1.1 → 1 triple bounce (`:125-129`, damping 8, ζ≈0.22) on every button, not only the heart, and has no Reduce Motion branch.

**Fix:**
1. Add `TactileRow` to `motion.tsx`: the same shared value, but it animates a background overlay (`Glass.fillPressed` opacity 0→1) and a 0.985 scale, with the same 70 ms hold. List and sheet rows use it.
2. Replace every interactive bare `Pressable` with `Tactile`/`TactileRow`.
3. Give `LuvButton` an `onPressOut` that springs home, and keep the burst for the heart only.
4. Add a lint rule (`no-restricted-syntax` on JSX `Pressable` outside `allegra/` and full-screen backdrops).

#### 7b. Haptics

Compliance is clean: all 130 calls go through `utils/haptics`. The vocabulary isn't consistent, though:

| Action | Pill | Now Playing | Other |
|---|---|---|---|
| Play/pause | `selection` (`PillPlayer.tsx:121,282,338`) | `Medium` impact (`NowPlayingControls.tsx:625`) | |
| Next/previous | `selection` | `Light` impact (`:618,630`) | the cover swipe is `Medium` (`NowPlayingScreen.tsx:563`) |
| Library deck play | | | `Light` (`GlassDeck.tsx:174,177`) |
| Lyrics scan queued | | | `vibrate(50)`, a raw buzz (`useSongActions.tsx:66`) |

Long press opens the actions sheet with `Light` (`useSongActions.tsx:52`), but the Playlists long-press menu (`PlaylistsScreen.tsx:208`) and the Stream long-press queue-next do whatever their own code does.

**Fix:** a semantic layer in `utils/haptics.ts`: `tap()` (selection), `toggle()` (light), `commit()` (medium: play/pause, skip by gesture), `success()`, `refuse()` (warning). Map every call site onto it. Replace `vibrate(50)` with `success()`.

#### 7c. Gesture physics: velocity dropped on exits, no edge resistance

- **WARNING** `NowPlayingScreen.tsx:566`: a cover swipe that commits exits on `withTiming(dir*W, {duration: 160, easing: Easing.in(Easing.quad)})`. The finger may be moving at 2–3 k px/s, and the cover then **restarts from zero speed and accelerates** (ease-in). You see a hitch at release on every fast swipe. Use `withSpring(dir*W, { ...FLING_SPRING, velocity: e.velocityX })` (pass the velocity from `onEnd`), or a decelerating timing whose duration is `remaining / |v|` clamped to 120–220 ms.
- **WARNING** `NowPlayingScreen.tsx:583-586`: the cover follows the finger 1:1 even when `adjacentSong` is null. Only on release does it spring back with a Warning haptic (`:555-560`), which feels like a failure after a full-width drag. Apply the same rubber band the pill uses (`pillGive`, about 18–24pt) when `!swipePreviewAvailable.value`.
- **WARNING** `PlayerSheet.tsx:140`: the swipe-down close calls `onClose()` with no velocity, and the close runs `withTiming(0, {240ms, accelerate})` (`:104`). A flick decelerates and then speeds up again. The scrim (`:110`) also ignores `drag`, so the scrim stays fully dark while you drag the sheet halfway down. Make the exit `withSpring(0, { ...Motion.spring.sheet, velocity: -vy/travel })`, and make the scrim `opacity: shown * (1 - drag/travel)`. `travel` (`:111`) is a guess (520/900). Measure the sheet with `onLayout` so short sheets don't wait on invisible travel.
- `UpNextPanel.tsx:236,242` and `NowPlayingScreen.tsx:208,213,291`: these carry velocity correctly. Use them as the reference.
- `StreamHome.tsx:160-166`: the Quick picks pager has `snapToInterval` but no `disableIntervalMomentum`, so a strong flick skips 2–3 pages (YouTube Music moves one). Cover shelves (`StreamHome.tsx:193`, `BrowseShelf.tsx:91`) have no snap, so they stop mid-cover. Add `snapToInterval={COVER+gap}` with `decelerationRate="fast"` to match Apple Music and Spotify.

#### 7d. Springs and durations from tokens

Token adoption is partial. `Motion.spring.lyrics` and `breathe` have 0 uses, and `Motion.ackMs` has 0.

- Local springs: `SETTLE_SPRING` (`NowPlayingScreen.tsx:75`), `criticallyDamped` duplicated in `ConnectRemotePlayer.tsx:71`, `GlassDeck.tsx:44`, `TasteExplorer.tsx:61`, `GlassRoom.tsx:27`, and `MiniPlayer.tsx:124,224,375-376`.
- **Underdamped (bouncy):** `PILL_BOUNCE` (`PillPlayer.tsx:80`, stiffness 520 / damping 16 / mass 0.7, ζ≈0.42, so the pill wobbles about twice on every release), `LuvButton` (ζ≈0.22 and 0.37), and the MiniPlayer YouTube button (ζ≈0.5). This goes against the owner's rejection of bouncy motion for lyrics and unslop's "no bouncy springs on simple UI".
- About 80 literal durations and easings, for example:
  - `NowPlayingScreen.tsx:132,166` (200), `:432` and `NowPlayingControls.tsx:127` (`bezier(0.32,0.72,0,1)`, 460)
  - `NowPlayingLyricsArea.tsx:52,60,68` (340/220)
  - `Toast.tsx:17-18,73` (280/240, `Easing.out(cubic)`)
  - `CustomMenu.tsx:60-69` (150)
  - `AlphabetRail.tsx:67` (120/160)
  - `LuvControls.tsx:39,67-70,94-97`
  - `LuvsScreen.tsx:465` (400/300)
  - `AmbientMode.tsx:36,41`
  - `AppleBackdrop.tsx:206` (500)
  - `DownloadButton.tsx:83`, `SavedBadge.tsx:25` (260)

**Fix:**
- Add to `allegraTheme.ts`:
  - `Motion.spring.settle = {320, 34, 1, overshootClamping}`
  - `Motion.spring.open = criticallyDamped(400)`
  - `Motion.spring.fling = criticallyDamped(1500)`
  - `Motion.ease.morph = bezier(0.32,0.72,0,1)`
  - `Motion.duration.morph`
- Raise `PILL_BOUNCE` damping to about 26 (ζ≈0.68: one small settle, no wobble).
- Move every literal onto a token. Most map to `fast`/`base`/`slow`.

#### 7e. Transform and opacity only (root rule 5)

- **WARNING** `components/TimelineScrubber.tsx:225-230` animates `height` (3.5→14) and `borderRadius` per frame while scrubbing. It's still live: it's the **Luvs** scrubber (`LuvControls.tsx:22`) and the classic mini player's. `AppleSlider.tsx:105` already does the right thing (`scaleY`). Port that.
- **WARNING** `MiniPlayer.tsx:130-141` animates the skip buttons' `width`, and `:423` the classic shell's `height`, through the whole expand gesture (classic nav mode, a Settings option).
- **WARNING** `YtMiniPlayer.tsx:46-87` springs `width`/`height` with `useNativeDriver: false` and follows a PanResponder on the JS thread.
- `NowPlayingScreen.tsx:354-358` and `ConnectRemotePlayer.tsx:297` animate `borderTopLeft/RightRadius` on every frame of the sheet drag. Android rebuilds the clip path for each radius change. `MiniPlayer.tsx:430-436` already quantises the radius to whole pixels for this reason. Do the same here (`Math.round(corner)`), or animate a corner-mask overlay's opacity instead.

#### 7f. Reduce Motion (root rule 7: "collapses to opacity")

29 animated files have no Reduce Motion branch: `PillPlayer.tsx` (the disc keeps spinning, `PILL_BOUNCE` and the 24pt rise stay), `PlayerSheet.tsx` (slides 520–900pt), `UpNextPanel.tsx`, `Toast.tsx` (16pt slide), `DownloadButton.tsx`/`SavedBadge.tsx` (loops), `AlphabetRail.tsx`, `CustomMenu.tsx`, `LuvsScreen.tsx`, `MiniPlayer.tsx`, `PlaylistItem.tsx` (random equaliser loop), `AppleBackdrop.tsx`, `GlowBackground.tsx`, `AmbientMode.tsx`, `ImportTray.tsx`, `LuvLinkHost.tsx`, and others.

Where a branch exists, it often still translates:
- `NowPlayingScreen.tsx:131-133,165-167`: the sheet still slides over 200 ms and fades.
- `TasteExplorer.tsx:185`: a 220 ms translate.
- `GlassDeck.tsx:166`: a 160 ms translate, and the pan end at `:200` always springs.

**Fix:** under RM, set `sheetY` instantly and fade `opacity` 0→1 over `Motion.duration.base`. Same for PlayerSheet and UpNext. Stop the disc spin and use `withTiming` for the pill's return.

#### 7g. Continuity gaps between surfaces

- The pill → player → lyrics → Up next path is continuous. Lyrics fullscreen is not (Pillar 6).
- Sheet languages: the player sheets spring and drag. `AddToPlaylist` is a native `slide_from_bottom` route (`RootNavigator.tsx:122`). `CreatePlaylist` fades (`:115`). The 13 RN modals slide with their scrim. `CustomMenu` is an anchored fade dropdown (`PlaylistsScreen.tsx:226`, `PlaylistDetailScreen.tsx:764,772`), although the project rule says menus are sheets. One `GlassSheet` fixes all of these.
- Push direction: inside Library, Playlists slides from the right but PlaylistDetail rises from the bottom (`TabNavigator.tsx:79`), so the spatial model flips mid-drill-down. Use `slide_from_right` for PlaylistDetail (the folder → page continuity can come later as a shared cover transition).
- In-place swaps that pop:
  - Library sort and artist filter re-order the list in one frame (`LibraryScreen.tsx:333-344`).
  - Up next filter chips swap the list (`UpNextPanel.tsx:358-368`).
  - `SettingsKit.Choice` moves the selected fill from cell to cell with no sliding indicator (`SettingsKit.tsx:164-176`). A segmented control should slide one `translateX` indicator.
  - The lyrics button's white "on" fill snaps (`NowPlayingControls.tsx:698,772`).
  - The A–Z rail mounts and unmounts on `inList` with no fade (`LibraryScreen.tsx:406-412`).
  - The "Editing playlist" toast pops (`PlaylistDetailScreen.tsx:757`).

  Give each a 160–240 ms opacity crossfade (or `entering={FadeIn}` keyed on the value) and the segmented control a sliding indicator.

#### 7h. Scroll behaviour

- FlashList is used for Library, PlaylistDetail and Stream. Good. `PlaylistDetailScreen.tsx:733` still passes `estimatedItemSize`, which FlashList v2 (`^2.2.2`) ignores, and the `as unknown as React.FC<any>` cast hides that.
- FlatList is used for UpNext (with `getItemLayout`, good, and native on Android), Playlists (a 2-column grid, short), `AddToPlaylistModal`, `DownloadQueueModal`, `PlaylistSelectionModal`, `SongVersionSearchModal`, `LuvsVaultModal`, `BlendScreen`, `BlendsScreen`, and `CollectionScreen` (an album or playlist can hold 100+ songs). Move `CollectionScreen` and `AddToPlaylistModal` (the whole library) to FlashList.
- `scrollEventThrottle={1}` (`PlaylistDetailScreen.tsx:740,751`) sends every native scroll event. 16 is enough for the header fade.
- Pull to refresh only exists on Stream (`StreamScreen.tsx:748`). Library and Playlists refresh on focus, which is fine.

---

## Top 10 fixes, ranked by how much a listener would feel them

| # | Fix | Where | Effort |
|---|-----|-------|--------|
| 1 | **Every tap answers the finger.** Add `TactileRow` (animated surface step + 0.985 sink, 70 ms hold) and move about 110 bare `Pressable`/`TouchableOpacity` onto `Tactile`/`TactileRow`, starting with the most-touched: player menu and sleep rows, UpNext chips, Library chips, playlist rows and header, Now Playing chips and segment, More menu rows, BrowseShelf cards, the voice card buttons. Fix `LuvButton`'s missing `onPressOut`. Add a lint rule | §7a | M |
| 2 | **Wire or remove the dead ••• on playlist rows**, and give playlist songs the same long-press actions as Library (`useSongActions().open`) | `PlaylistItem.tsx:154`, `PlaylistDetailScreen.tsx:516-532` | S |
| 3 | **Carry flick velocity into every exit and make scrims track drags.** Cover swipe exit as a spring with `velocityX`. `PlayerSheet` close springs with velocity, its scrim fades with `drag`, and `travel` is measured | `NowPlayingScreen.tsx:566`, `PlayerSheet.tsx:104,110-112,140` | S |
| 4 | **One glass sheet for the whole app.** Promote `PlayerSheet` to `allegra/GlassSheet` with a root host. Migrate the 13 RN `Modal slide` sheets (song actions first) so the scrim fades in place and the grabber drags. Replace `CustomMenu` dropdowns and native `Alert` confirmations with sheets | Pillar 6 list | L |
| 5 | **Lyrics fullscreen as one motion.** Keep header and transport mounted and drive them from a `fullP` shared value on `ROWS_MOVE` instead of swapping trees | `NowPlayingScreen.tsx:430,826`, `NowPlayingControls.tsx:424` | M |
| 6 | **Rubber band where there is nothing to go to.** Cover swipe with no neighbour, the GlassDeck ends. Tame `PILL_BOUNCE` to damping about 26 and drop the 0.8→1.1→1 bounce from non-heart Luvs buttons | `NowPlayingScreen.tsx:585`, `PillPlayer.tsx:80`, `LuvControls.tsx:125-129` | S |
| 7 | **Remove the Settings layout-animation crash pattern** (`layout=LinearTransition` parent + `exiting` child, Reanimated 4.1) before a listener finds it by collapsing a section | `SettingsKit.tsx:71,92`, `DownloadsTray.tsx:21` | S |
| 8 | **Content always clears the pills.** Use `useBottomClearance()` on every scrolling screen. Blends, Import and Your DJ end under the pill today | `BlendsScreen.tsx:111`, `ImportScreen.tsx:70`, `DjScreen.tsx:346`, `StreamScreen.tsx:436`, `SettingsScreen.tsx:251`, `PlaylistsScreen.tsx:289`, `ArtistScreen.tsx:116`, `CollectionScreen.tsx:89` | S |
| 9 | **Reduce Motion collapses to opacity everywhere.** The player sheet (and Connect's) fades instead of sliding. Add an RM branch to PillPlayer (no spin, no bounce), PlayerSheet, UpNext, Toast and the loops | §7f | M |
| 10 | **Motion and look tokens, then a consistency pass.** Add `Motion.spring.settle/open/fling`, `Motion.ease.morph` and a `Type` scale. Move about 80 literal durations onto tokens. Animate `scaleY` in `TimelineScrubber` (Luvs) instead of `height`. One haptic vocabulary (`tap/toggle/commit/success/refuse`). One pressed tint. Three over-media text roles. Restrict weights to 400/600/700. Remove the 6 `letterSpacing` uses. Reskin Your DJ onto the dark glass | §3, §4, §7b, §7d, §7e | L |

### Further recommendations (minor)

- `PlaylistDetailScreen.tsx:728-756`: keep one list through edit mode so the scroll position survives. Use an edit icon, not •••, for the toggle.
- Make PlaylistDetail `slide_from_right` (`TabNavigator.tsx:79`) so drilling down keeps one direction.
- Snap cover shelves, and add `disableIntervalMomentum` to Quick picks (`StreamHome.tsx:160-166,193`; `BrowseShelf.tsx:91`).
- Add scroll-to-top on tab re-tap for Search, Settings, Playlists, Artist and Collection.
- Search, chip and mood loading: reuse the row skeleton instead of a spinner, and `RiseIn` the first results.
- Fix the copy items listed in Pillar 1. Unify "LuvLink" / "Listening together".
- Round the sheet corner radius per frame (`NowPlayingScreen.tsx:354`, `ConnectRemotePlayer.tsx:297`).
- Add `tabular-nums` to live numbers (sleep label, counts, Up next durations).
- `CollectionScreen` and `AddToPlaylistModal` → FlashList. Drop `estimatedItemSize` and set `scrollEventThrottle` to 16 in PlaylistDetail.
- Remove the BlurView inside the pill tab bar (`ModernPillTabBar.tsx:203`). On Android it's a flat tint without `experimentalBlurMethod`, so it's dead weight, and the rule forbids a live blur there anyway.
- Show the info-tour "i" only until the tour has been seen.
- `ModernPillTabBar.tsx:112,116` and similar `.catch(console.error)` in press handlers: use `diag` (root rule 10).

---

## Registry safety

Not applicable: no `components.json` / shadcn in a React Native app.

---

## Files audited

`apps/mobile/CLAUDE.md`, `CLAUDE.md`; the unslop `SKILL.md` and `references/signs.md`, `effects.md`, `tokens.md`;
`src/constants/allegraTheme.ts`, `src/components/allegra/motion.tsx`, `src/utils/haptics.ts`, `src/hooks/useBottomClearance.ts`, `src/navigation/tabs.ts`, `TabNavigator.tsx`, `RootNavigator.tsx`;
`src/screens/NowPlayingScreen.tsx`, `LibraryScreen.tsx`, `StreamScreen.tsx`, `PlaylistDetailScreen.tsx`, `PlaylistsScreen.tsx`, `SearchScreen.tsx`, `SettingsScreen.tsx`, `DjScreen.tsx`, `LuvsScreen.tsx`, `ArtistScreen.tsx`, `CollectionScreen.tsx`, `BlendScreen.tsx`, `BlendsScreen.tsx`, `ImportScreen.tsx`, `LyricsEditorScreen.tsx`, `CoverArtSearchScreen.tsx`;
`src/components/PillPlayer.tsx`, `MiniPlayer.tsx`, `NowPlayingControls.tsx`, `NowPlayingHeader.tsx`, `NowPlayingLyricsArea.tsx`, `ModernPillTabBar.tsx`, `CustomTabBar.tsx`, `MoreMenu.tsx`, `Toast.tsx`, `PlaylistItem.tsx`, `AuroraHeader.tsx`, `TimelineScrubber.tsx`, `YtMiniPlayer.tsx`, `LibraryBottomSheet.tsx`, `CustomMenu.tsx`, `ModernDeleteModal.tsx`, `CustomAlert.tsx`, `VoiceSearchCard.tsx`, `LrcSearchModal.tsx`;
`src/components/player/PlayerSheet.tsx`, `UpNextPanel.tsx`, `PlayerMenu.tsx`, `PlayerExtras.tsx`, `AppleSlider.tsx`, `AmbientMode.tsx`, `LyricsPicker.tsx`;
`src/components/stream/StreamHome.tsx`, `StreamItems.tsx`, `DownloadsTray.tsx`, `DownloadButton.tsx`, `SavedBadge.tsx`, `AddListSheet.tsx`;
`src/components/library/GlassDeck.tsx`, `AlphabetRail.tsx`, `useSongActions.tsx`;
`src/components/settings/SettingsKit.tsx`; `src/components/luvs/TasteExplorer.tsx`, `LuvControls.tsx`; `src/components/connect/ConnectRemotePlayer.tsx`, `ConnectDeviceSheet.tsx`; `src/components/about/AboutSheet.tsx`; `src/components/browse/BrowseShelf.tsx`; `src/components/luvLink/LuvLinkPanel.tsx`;
plus repo-wide counts: press primitives, `Modal` animation types, literal durations and springs, `rgba`/hex literals, font sizes and weights, spacing values, Reduce Motion coverage, haptic call sites and animated layout properties.
