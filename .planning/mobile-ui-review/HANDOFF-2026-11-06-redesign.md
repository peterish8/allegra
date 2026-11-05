# Handoff: LuvLyrics (Android) redesign, paused 2026-11-06

Read this together with the owner's new UX prompt. The new session does not inherit the previous conversation.
Everything it needs is listed here, with where to find it.

## 1. Project context

- The owner calls the app "radioOutcome". In the code it is **LuvLyrics**, an Android music app at `apps/mobile`
  inside the **Allegra** monorepo `C:\dev\allegra` (git; branch `feat/mobile-frontend-polish`).
- Stack: Expo SDK 54, React Native 0.81.5, React 19.1, Reanimated ~4.1.1 (CLAUDE.md wrongly says 3), Gesture Handler
  ~2.28, expo-blur ~15, expo-haptics ~15, Zustand, React Navigation, FlashList, expo-sqlite. Playback is native Kotlin
  (Media3) with a native queue engine. The Android tab bar is drawn in Kotlin
  (`apps/mobile/android/app/src/main/java/com/lyricflow/app/views/NativeTabBarView.kt`) with the Ionicons font.
- Rules to read first: `apps/mobile/CLAUDE.md`, `apps/mobile/DESIGN.md` (§0 = the component library in
  `apps/mobile/src/ui`), repo root `CLAUDE.md`. Key rules: three playback invariants; animate only transform/opacity;
  motion values from tokens; no `letterSpacing`; sentence-case copy; `src/designGuards.test.ts` guards; bump
  `apps/mobile/app.json` version for anything reaching `main`.
- Design tool: one claude.ai **Design canvas** artifact, https://claude.ai/artifact/UGiYJ1UaRjWA66qTFjsmHT .
  Open it with the Artifact tool (`action: "read"`, `url`, `path: "project/canvas.json"` or any
  `project/<board>.dc.html`), not a browser. Each board is one `.dc.html` file under `project/`; `project/canvas.json`
  is the index of boards and pages.
- Boundary: the redesign exists **only as mockups**. No redesign code is in the app. Implementation needs the owner's
  explicit approval.

## 2. Confirmed decisions, in order

1. **Direction: B "Glass deck"** (layout, components, controls, navigation) with **A "Apple glass"'s background only**:
   near-black ground, at most one soft artwork glow at the top.
2. **Accent: white** (lime, cover-derived and coral were rejected). White marks only the primary action and selected
   states; colour comes from artwork.
3. Owner critiques of round 3 (the 21 screens), all accepted: too big and childish and template-like (oversized
   headings, cards, artwork, gaps); crowded header and category controls; too many pill/capsule containers; bright
   white rims; the mini-player and bottom navigation looked like two floating pills squeezed together; "Recently
   added" looked like plain text, not a control; overall "vibe-coded with AI", not production.
4. Owner critique of round 4: screens look like separate design exercises. Build one system first (one song-row
   component, one playback/navigation shell, consistent backgrounds and icons). Priority: Playlist, then song rows,
   then shell, then Search, then Now playing. Every control must reflect real supported behaviour.
5. Structural rules adopted:
   - Header: plain icons, no capsules; Android top bar with a ← back arrow.
   - Category tabs: text tab row, thin underline on the selected tab, one divider below.
   - Bottom: one opaque surface anchored to the bottom edge; mini-player on top with progress along its top edge;
     navigation below, separated by a 6% white divider. Mini-player shows title and artist, not a lyric line.
   - Sort: a visible button (icon + label + chevron) opening a **half-screen bottom sheet** (owner's request) with
     only supported sorts.
   - Playing row keeps its artwork plus a small badge. ⋮ on every row; long press opens the same sheet.
   - Touch targets 48dp minimum (Android guidance). Photographic-looking covers, not flat shapes.
6. Proposed, **not approved** (open product calls): five tabs Stream, Luvs, Library, **Search**, **You** (today:
   Stream, Luvs, Library, •••, optional mic); mic moves into the Search field; Playlists folds into Library's tabs;
   "Jump back in" leaves Library for Stream; "Add to playlist" and "Go to artist" join the Library song sheet; sort
   choice persists; Undo after removing a song from a playlist; icons switch from Ionicons to Material Symbols
   Rounded (needs a new font in the app and the Kotlin tab bar).

## 3. Artifacts: current vs superseded

Canvas, as published. Page ids do not match names (pages were renamed):

| Page id | Page name | Boards | Status |
|---|---|---|---|
| `accent` | "Refined: review these 6" (first) | `V4-Library`, `V4-LibrarySort`, `V4-Playlist`, `V4-Search`, `V4-NowPlaying`, `V4-SongActions` | Round 4, superseded by the last critique. `V4-LibrarySort` (half-screen sheet) and `V4-Playlist` are the newest of these |
| `v2` | "Glass deck v3 (21 screens, older)" | `V3-*` (21) | Superseded (oversized, pills). Use as the screen inventory |
| `v4` | "Accent options (white chosen)" | `AC-Lime`, `AC-White`, `AC-Cover`, `AC-Coral` | Decision record |
| `v3` | "Pick a direction (A / B)" | `V2-LibraryA`, `V2-LibraryB` | Decision record; B is the direction reference, A's background only |
| `current` | "Current app" | 12 boards drawn from the code (`Main`, `Playlists`, `PlaylistDetail`, `SongActions`, `Stream`, `Search`, `NowPlaying`, `Luvs`, `Settings`, `Dj`, `Blends`, `Artist`) + an empty "Artboard 1" | Reference for today's app |
| `redesign` | "Redesign v1 (flat)" | `RD-*` (14) | Rejected |

Uploaded cover images (canvas assets, referenced as `/_blob/<id>`):

| Cover | Asset id |
|---|---|
| low-tide | `02316c7dda6de4813b5e72088faae3cf` |
| golden-hour | `16f9f309d813cf2399715dd3c34f6d9a` |
| paper-lanterns | `0dc4f7bf0bc5a28e32fa4938e355182c` |
| static-rain | `74f23f1848c6d7e932d5d628b033f576` |
| small-hours | `80224f83fc614ceab8ebe2fc0d545939` |
| night-drive | `434b7a8267d07e303d359e48e3568765` |
| mira-vale (artist photo) | `fd73afff29511e822acce85d9fb77dc8` |
| baarish | `a28a4910c4101fff1cdaca12e592f638` |
| fade | `ea11274cd3d13d724014f84d61a8c141` |
| daily-mix | `4df23e692f869f66f7cb10047bdc6679` |

Newest work (round 5), **not published**, saved in the repo at
`C:\dev\allegra\.planning\mobile-ui-review\design-drafts\`:
- `V5-System.dc.html`: design-system board (1240×844).
- `V5-Playlist.dc.html`, `V5-Library.dc.html`: built only from that system.
- `canvas.unpublished.json`: an unpublished index that adds the V5 boards to page `accent`, moves V4 to a new page
  `v4old`, and lists V5-Search, V5-NowPlaying, V5-SongActions, V5-Sort, **which were never created**. Do not publish it
  as is (blank boards).
- `make_covers.py`: regenerates the cover images.
- To publish a draft: place it at `<folder>/project/<name>`, then publish with the canvas `url`, `root: <folder>` and
  the files. Read `project/canvas.json` from the canvas first; the owner may have edited it.

Docs in `C:\dev\allegra\.planning\mobile-ui-review\`:
- `REDESIGN-V3-GLASS-DECK.md`: 20 decisions with sources, journeys, audit. Accessibility and navigation reasoning still
  valid; scale and visual decisions superseded by rounds 4 and 5.
- `REDESIGN-2026-11-05.md`: round 1 (flat), superseded.
- `HANDOFF-2026-11-04.md`, `FRONTEND-POLISH-PLAN.md`, `MOBILE-UI-REVIEW.md`: the earlier code-polish plan and audit.

## 4. Screen and state inventory

"Complete" means a board exists. Nothing has owner sign-off except the direction and the accent.

| # | Screen / state | V5 (current system) | Older boards |
|---|---|---|---|
| 0 | Design-system board | Drafted, not reviewed (repo draft) | n/a |
| 1 | Playlist | Drafted (repo draft) | V4, V3 |
| 2 | Library · Songs (list-first, filter, sort, Shuffle all) | Drafted (repo draft) | V4, V3 |
| 3 | Sort sheet (half screen) | Not started in V5 | V4-LibrarySort (accepted pattern) |
| 4 | Search (idle) | Not started | V4, V3 |
| 5 | Search: typing + keyboard, grouped results, scopes | Not started | none |
| 6 | Search: no results / offline | Not started | V3 |
| 7 | Now playing | Not started | V4, V3 |
| 8 | Song actions sheet (⋮ and long press) | Not started | V4, V3 |
| 9 | Library · Playlists tab (incl. New playlist) | Not started | V3 |
| 10 | Library · Artists / Albums tabs | Not started | none |
| 11 | Add to playlist sheet | Not started | V3 |
| 12 | Lyrics full screen | Not started | V3 |
| 13 | Up next (queue) | Not started | V3 |
| 14 | Stream (home) | Not started | V3 |
| 15 | Luvs | Not started | V3 |
| 16 | You (proposed hub) | Not started | V3 |
| 17 | Settings | Not started | V3 |
| 18 | Your DJ | Not started | V3 |
| 19 | Blends | Not started | V3 |
| 20 | Artist | Not started | V3 |
| 21 | States: empty library, loading, empty playlist, small phone + 200 % text | Not started | V3 (large text at ~130 % only) |

Never drawn in any round:
- Screens: CollectionScreen (album/playlist collection), ImportScreen, LyricsEditorScreen, CoverArtSearchScreen,
  BlendScreen (single blend), BlendJoinScreen, LuvLinkScreen, create-playlist flow.
- Sheets and overlays: player ••• menu (PlayerMenu), sleep timer, Connect devices picker, About sheet, download queue,
  voice search card, ConfirmSheet dialogs (delete song, remove from playlist, delete playlist), toasts.

## 5. Design system (V5 draft, unreviewed)

- Colour: base `#0B0D10`; raised `#17191E` (shell, sheets, fields); control `#22252C`. Text primary `#F4F4F5`,
  secondary `#A3A5AE`, tertiary `#6F727B` (non-essential only). Dividers white 6%. Destructive `#FF6B61`. White fill
  only on the one primary action per screen.
- Backgrounds by screen type: browse roots flat; detail pages a faint artwork tint at the top; Now playing an
  immersive artwork glow.
- Type: title 28/700, section 18/600, row title 15/500 (600 when playing), row meta 13/400, button 15/600, nav 12
  (500 rest, 600 active). Mockups use Inter as a stand-in; the app ships bundled SF Pro.
- Spacing 4, 8, 12, 16, 24, 32; gutter 16. Radii: artwork 8, large artwork 12, controls 12, sheets 16. Targets 48×48.
- Song row (one component everywhere): 64 tall, 48 artwork, title + meta, ⋮ with its own 48 target, separator inset
  to the text. States: default; playing (artwork kept, `graphic_eq` badge, bold title, "Playing"); long title (one
  line, ellipsis, full name in the accessibility label); downloaded (`download_done` in meta); no artwork
  (placeholder). Row tap plays; ⋮ and long press open the same sheet.
- Buttons: primary (white, 48, radius 12), secondary (`#22252C`), text, icon (48 target).
- Icons: Material Symbols Rounded, outline; filled only for selected/active. Not approved for the app.
- Shell: one opaque `#17191E` surface: 2px progress line, mini-player (64: 44 art, title + artist, pause, next),
  divider, nav (64 + 16 safe area). Lists pad their end by the shell height. Active tab: filled icon + white + 600.
- Undecided: full motion spec (planned: transform/opacity only; Reduce Motion → opacity; no idle loops; mini-player →
  player as one continuous expansion); keyboard rule (today the mini-player does not hide for the keyboard; proposal:
  hide the shell while the keyboard is up in Search); responsive Now playing artwork on short screens; Now playing
  deck peeks; final tab set and names; icon family; buffering, error and offline UI.

## 6. Code facts the designs must respect (read-only audit, 2026-11-06)

- Tabs: Stream, Luvs, Library, plus the native ••• (Your DJ, Search, Playlists, Settings); optional mic overlay.
- Library header: no "+" and no catalogue search. Buttons: Blends, Import from Spotify, Download queue, Playlists.
  Inline "Filter your songs" field.
- Library sorts: Recently added, A–Z, By artist. No direction, no Downloaded filter, not persisted.
- Playlists: create, rename, delete (with confirmation), add songs, reorder ("Edit order"). Removing a song asks for
  confirmation; no Undo.
- Library song sheet: Play next, Find lyrics, Another language or version, Share the audio, cover options, Edit title
  and artist, Remove from this playlist (playlist context only), Hide, Delete (with confirmation). No Add to playlist.
- Opening song actions: Library rows long press only; Playlist rows long press and ⋮; Stream and Search a smaller
  sheet (Play next, Save to library, Go to artist); the player's ••• opens PlayerMenu.
- Search: recent searches (up to 10) with Clear; scopes All / On this phone / Online; results playlists, songs,
  artists (no albums); field auto-focuses after 250 ms.
- Player: shuffle only reshuffles what's coming up; repeat is repeat-one only; seek, double-tap ±5 s, reorderable
  queue, sleep timer, output picker, lyrics, like all exist. Buffering and errors are not shown anywhere in the UI.
- Downloads are real local files; no offline indicator or NetInfo.

## 7. Code-side state (separate from the redesign)

About 80 uncommitted changes on `feat/mobile-frontend-polish`; `apps/mobile/app.json` still 1.35.4. They include:
tap feedback (about 57 bare Pressables onto the shared press component), 11 sheets onto `src/ui` Sheet, removal of
decorative effects (veils, vignette, grain, red YouTube glow, two dead files), a sheet-scroll fix (`SheetScrollable`
wires the offset; `useSheetScroll` no longer exported), and a refreshed design-guard baseline. Last check: tsc 0,
eslint 0 errors, jest 1019/1019. Not done: phone build/install (phone was not on adb), commits, version bump to
1.36.0. Device checks needed: pill swipe still opens the player; sheet text fields stay above the keyboard; dragging a
sheet's scrolled list scrolls it. Committing and building need the owner's go-ahead.

## 8. Remaining work, prioritised

1. Read this handoff with the new UX prompt; name and resolve conflicts out loud.
2. Read the canvas (`project/canvas.json`, the V4 boards) and the three V5 drafts. Review the V5 system board against
   the critique and fix it before reusing it.
3. Finish the five representative screens in V5: Playlist (draft), Library (draft), Search (idle + typing +
   no-results/offline), Now playing, Song actions, plus the sort sheet. Put them side by side with the system board
   at phone scale.
4. Get the owner's review on the system and those five.
5. Extend the system to every screen in section 4, including the never-drawn screens and overlays, with each relevant
   state (empty, loading, error, selected, expanded, keyboard, 200 % text, 360 px width).
6. Scripted audit (labels, 48 px targets, contrast, no gradients or caps), then a side-by-side review of the full set;
   report complete vs gaps.
7. Get the open product calls (section 2.6) decided before drawing what depends on them. Mark proposals as proposals.
8. Only after approval: implement through `src/ui` tokens and components, starting with the five screens.

Blockers and open questions: the section 2.6 decisions; icon family (Material Symbols needs a font in the app and the
Kotlin tab bar, or switch the design back to Ionicons); whether to show buffering and error states, which the app does
not expose yet.

## 9. Continuation instruction

Read this handoff and the new UX prompt together. Inspect the real artifacts (the canvas via the Artifact tool, the
drafts in `.planning/mobile-ui-review/design-drafts/`, the code under `apps/mobile`). Keep useful work; do not restart
from scratch. Reconcile conflicting requirements explicitly. Cover every screen and state in section 4 without
silently dropping any. Show only features the code supports; label proposals. Do not change app code until the owner
approves the designs.

## 10. Update, later on 2026-11-06: round 5 complete for review

- Every board is now generated from one design-system kit: `design-drafts/v5_kit.py` (tokens, CSS, row, shell, sheet,
  buttons), `v5_core.py` (system, components, the five screens), `v5_rest.py` (everything else), `v5_map.py` (inventory,
  navigation map, coverage). `python v5_build.py` writes `design-drafts/project/`; `python v5_audit.py` writes
  `audit-v5.md`; `python v5_canvas.py <live canvas.json> <board-sizes.json>` merges the index.
- Published to the canvas (version 29): pages "Round 5: system + 5 screens (review)" and "Round 5: every screen and
  state", 21 boards, 101 phone frames. Older pages untouched; page `accent` renamed "Refined v4 (older)".
- The round-5 drafts listed in section 3 (`V5-System/Playlist/Library.dc.html` at the drafts root and
  `canvas.unpublished.json`) are superseded by `design-drafts/project/`; left in place, not deleted.
- System fixes vs the draft: weights 400/600/700 only (500 renders Regular), tertiary text `#8A8D96`, generated cover
  instead of a grey tile, switch outline 4.6:1, slider hit areas 48.
- Spec, conflict log, audit, journeys, matrix and plan: `REDESIGN-V5-SPEC.md`. Still no app code changed; waiting for the
  owner's review and the open questions in its section 13.
