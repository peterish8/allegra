# Handoff: LuvLyrics redesign after round 6 (2026-11-06, end of session)

Latest continuation: [IMPLEMENTATION-STATUS.md](IMPLEMENTATION-STATUS.md) records the
owner's resolved defaults, waived canvas publishing, prepared V6 frontend foundation,
current validation and still-pending device/release gates. Read it before resuming.

Read this first, then `REDESIGN-V6-NOTES.md`, `REDESIGN-V5-SPEC.md`, `apps/mobile/DESIGN.md` (top section "Redesign
direction"), `apps/mobile/CLAUDE.md` and the repo `CLAUDE.md`. Earlier history: `HANDOFF-2026-11-06-redesign.md`.

## 1. What the owner approved

- **The direction**, in the owner's words: neat, minimal, modern, frosted, with depth. Concretely: near-black ground; the
  playing song's cover glowing across the top ~20% of every screen; frost used sparingly on the bottom shell, toasts and
  player panels; white as the only accent (the one primary action and selected states); colour only from artwork; depth
  from the cover itself on Now playing (blurred backdrop, the cover lifted by its own coloured shadow).
- **The Stream structure** (section 7 of `REDESIGN-V6-NOTES.md`): mood filters → Jump back in (2×3 typed tiles) → Quick
  picks (4 rows, the page's only Play all) → one "Made for you" shelf → Your artists → typed YouTube Music shelves.
  Rows = songs, squares = collections, circles = artists.
- **Implementation is approved.** The next agent finishes the remaining designs, then builds the V6 look into the app,
  bumps `expo.version` for every change that reaches `main`, pushes, merges and ships through `apk-latest` (owner,
  2026-11-06: "the future agent will code and it will bump and push and merge and update app with this new look of V6").
  Ask the open questions in section 6 once up front; if they stay unanswered, use the recommended option noted there.

## 2. Where the designs are

| What | Where |
|---|---|
| Live canvas (21 round-5/6 boards, ~115 phone frames, older rounds kept) | https://claude.ai/artifact/UGiYJ1UaRjWA66qTFjsmHT, version 32. Pages "Round 5: system + 5 screens (review)" and "Round 5: every screen and state" |
| Offline gallery (opens in any browser, no login) | `.planning/mobile-ui-review/design-gallery/index.html` (all boards stacked) and one `V5-<Board>.html` per board, covers beside them |
| Canvas sources (what gets published) | `.planning/mobile-ui-review/design-drafts/project/*.dc.html` + `project/canvas.json` |
| Generator (the design system as code) | `design-drafts/v5_kit.py` (tokens, CSS, song row, shell, sheets, buttons), `v5_core.py` (system, components, five core screens), `v5_player.py` (Now playing family), `v5_rest.py` (all other screens), `v5_round6.py` (round-6 overrides: seek band, hierarchy rules, Library, Playlist, Stream, empty/permission), `v5_map.py` (inventory, navigation map, coverage), `v5_build.py`, `v5_audit.py`, `v5_canvas.py` |
| Rationale | `REDESIGN-V6-NOTES.md` (round 6), `REDESIGN-V5-SPEC.md` (inventory, conflicts, IA, per-screen specs, journeys, matrix) |
| Coverage matrix / audit | `design-drafts/coverage-matrix.md`, `design-drafts/audit-v5.md` |

Regenerate: `cd .planning/mobile-ui-review/design-drafts && python v5_build.py ../design-gallery` (writes `project/`
and refreshes the gallery HTML; cover JPEGs come from `make_covers.py`). Audit: `PYTHONIOENCODING=utf-8 python v5_audit.py`.
Change a token or component in `v5_kit.py` / `v5_round6.py` and every board follows.

Publish to the canvas: Artifact tool `read` the canvas (no path) and `project/canvas.json` first; if boards changed size,
run `v5_canvas.py <that canvas.json> <sizes.json>` to re-lay out; then publish with `url` = the canvas,
`root` = `design-drafts`, `file_path` = `design-drafts/project/canvas.json`, `files` = the changed `project/V5-*.dc.html`.
Cover images on the canvas are uploaded assets (`/_blob/<id>`, ids in `v5_kit.COVERS`).

## 3. Design system in one screen (details: DESIGN.md top section, `v5_kit.py`)

- Colour: base `#0B0D10`, raised `#17191E`, control `#22252C`, pressed `#2A2D34`; text `#F4F4F5` / `#A3A5AE` /
  `#8A8D96`; danger `#FF6B61`; song-action sheets `#0D0F12`. All text ≥ 4.5:1 on base and raised.
- Type (SF Pro; only 400/600/700 ship): title 28/700, detail title 24/700, player title 24/700, section 18/600,
  row 15/400 (playing 600), meta 13/400, nav 12/400 (active 600). Sentence case, no tracking.
- Shape: radius 8 thumbnails and chips, 12 artwork/buttons/fields, 16 sheets; circles only for people and play discs.
  48 dp targets (the mini-player seek band is 24, see notes).
- Shell: one bottom surface, cover-tinted frost (bitmap blur once, never a live blur of the list), 24 seek band with the
  progress line as its top edge, 56 mini player, 64 nav + inset, selected tab = filled icon + 600 + quiet indicator.
- Hierarchy: one compact primary per state; secondary actions are text; Cancel / Not now never filled; no full-width
  buttons in empty states; long press always opens the item's actions (never acts silently).
- Now playing: no volume row; loading = spinner in the play disc; error = disc becomes retry + info button inside the
  cover, details shown in the softened cover; nothing moves between states.

## 4. Remaining design work (owner wants to keep designing)

1. Carry the round-6 look explicitly onto boards that only inherit it through the kit: Search, LibraryMore (Playlists,
   Artists, Albums tabs: they now have the tab-row search icon; check them), PlaylistFlows, AddToPlaylist, You/Settings,
   Social, Tools, Overlays, Browse (Artist page could take the Playlist composition), Luvs, Responsive.
2. Up next empty-queue state (gap X7 in the matrix).
3. Settle the open questions (section 6) and redraw what depends on them.
4. Re-run the side-by-side review and the audit after each pass; republish.

## 4a. Every owner request this session, and its exact status

Done and published (canvas v32) unless noted. "Partial" items are the next agent's first design tasks.

| # | Request | Status | What's left |
|---|---|---|---|
| 1 | Full-app redesign master brief: inventory, audit, IA, system, every screen, matrix | Done (round 5) | Up next empty queue (matrix X7) |
| 2 | Now playing: depth, better lines and buttons | Done (`v5_player.py`) | — |
| 3 | Up next: interesting top half, neat bottom half | Done (cover deck + glass queue, pulled-up variant) | Empty-queue state |
| 4 | Lyrics: lyrics-first, only cover, seek, three transport buttons, a way back | Done | — |
| 5 | Current-song glow across the top ~20% of every screen | Done (kit `top_glow`) | — |
| 6 | Restrained frost on the nav and a few persistent surfaces, with opaque fallback | Done (shell, toasts, player panels) | Fallback drawn only in code (`frost.solid`); add one board frame showing it |
| 7 | Stream: diagnosis, research with citations, structure, states | Done; **structure approved** | — |
| 8 | Song-action sheets: deeper opaque black | Done (`.sheet.deep`) | — |
| 9 | Now playing: remove volume, in-control loading/error, stable geometry | Done | — |
| 10 | Mini-player progress line becomes a seek bar (rest, scrub, disabled) | Done (kit seek band) | — |
| 11 | Playlist: new composition, states, loading strategy | Done (design + measurement plan) | Apply the same composition to the **album page** (`v5_rest.collection_page`, still the old cover-beside-title header) and the **Blend page** (`blend_detail`); measuring the loading suspects is implementation work |
| 12 | Library: search icon in the tab row, quiet sort, no Shuffle row | Done | — |
| 13 | Empty library + music access with illustration/motion; **app-wide hierarchy pass** | **Partial**: both states and the motion strip are done; kit rules now make Cancel/Not now text and empty-state buttons compact | Board-by-board pass still owed: full-width or paired filled buttons remain on AddToPlaylist (Add 2 songs bar), Browse (Artist Play + Shuffle pair, album Play + Shuffle pair), Luvs (Languages Cancel/Save, Saved Clear/Download all), Overlays (voice result Play + Play next, Play on this phone, About update), PlayerTools (Connect sign-in), PlaylistFlows (name sheets, delete confirm), Social (Create a Blend, Join), SongActions (delete confirm), Tools (import bar, cover-search bar, DJ save), You (sync choice, Show again bar). Decide per case: bottom action bars may stay full width; everything else gets one compact primary + text secondary |
| 14 | Now playing error details inside the cover (info control, softened artwork) | Done | — |
| 15 | Save everything, handoff, starter prompt, DESIGN.md direction, implementation authority | Done | — |

## 5. Implementation plan (approved: build, bump, push, merge, ship each step)

Branch `feat/mobile-frontend-polish` still holds ~80 **uncommitted** polish changes from the earlier session (tap
feedback, sheets on `src/ui`, removed effects; tsc 0, eslint 0, jest 1019/1019 at the time). Deal with them first: get
the owner's go-ahead, run the device checks listed in `HANDOFF-2026-11-06-redesign.md` §7, bump `expo.version` in
`apps/mobile/app.json` (1.35.4 → 1.36.0), commit, open a PR.

Then the redesign in small PRs on `feat/` branches, each reaching `main` with its own **minor version bump** in
`apps/mobile/app.json` (1.37.0, 1.38.0, …) as `apps/mobile/CLAUDE.md` requires:

1. Tokens and type weights in `src/constants/allegraTheme.ts` / `src/ui`; update `DESIGN.md` to match; designGuards.
2. Shared components: SongRow (from `ListRow`, ⋮ slot, badge, states), SortTrigger, Toast with Undo, Sheet surfaces
   (`deep`, player glass), empty state with one primary, top glow, frosted shell with fallback.
3. Mini player: seek band (gesture separated from open-player and buttons; `wasPlaying` seek pattern; disabled when
   duration unknown), new layout. The tab bar is native Kotlin (`views/NativeTabBarView.kt`), so the shell needs Kotlin work.
4. Playback status: derive `idle | loading | playing | paused | error` in `usePlayerStore` from `playWhenReady`,
   `isPlaying` and `MainPlayer.onPlaybackError`; Now playing and the mini player read only that.
5. Screens in this order: Library (tab-row search, quiet sort), Playlist (+ the loading fixes below, measured first),
   Now playing (no volume row, cover-inset error details, lyrics-first view, Up next deck), Stream (approved structure),
   then the rest.
6. Navigation change (Search and You tabs) only if approved: `VISIBLE_TABS`, `MORE_ITEMS`, deep links, Kotlin tab bar, smoke
   test walk, in its own PR.

Playlist loading suspects (measure on real phones before changing): N+1 in `getPlaylistSongs`
(`database/playlistQueries.ts:140`); `getAllPlaylists()` just for one name (`PlaylistDetailScreen.tsx:158`); load runs
twice on open (focus effect + `onlineVersion` effect); local then online in sequence; errors swallowed.

Every PR: `npm run typecheck`, `npm run lint`, `npm test` in `apps/mobile` (or `npm run mobile:check` at the root), the
three playback invariants, transform/opacity-only motion from tokens, Reduce Motion fades, `useBottomClearance`, no bare
`Pressable`, haptics through `utils/haptics`, no live blur on always-visible chrome, a regression test per fix, full
local e2e before merging features, device check at 360 / 393 / 430 and 200% text.

## 6. Open questions (ask the owner once; recommended default in brackets if unanswered)

1. Navigation: Search and You as tabs, ••• removed? [Yes: Stream's approved design assumes Search is a tab.]
2. Icons: Material Symbols Rounded (new font in app + Kotlin tab bar) or map to Ionicons? [Ionicons: already shipped,
   no new font in the Kotlin tab bar; map each glyph to its outline/filled pair.]
3. Retire the App background / Mini player background / Bottom bar style settings? [Yes; keep Player background.]
4. Compact shell on screens under 700 tall? [Yes: 56 mini player, 72 nav.]
5. Albums tab; Artists tab replacing the orbit; remember sort per list; Undo for remove-from-playlist; membership ticks.
   [All yes.]

## 7. Facts the designs rely on (verified in code 2026-11-06)

Tabs today: Stream, Luvs, (mic), Library, ••• (Your DJ, Search, Playlists, Settings). Library sorts: Recently added,
A–Z, By artist (no direction). Playlist sorts: Custom, Title, Artist, Recently added **with direction, persisted**
(`saveSort`). Player shuffle reshuffles what's next; repeat UI is repeat-one. Sleep timer 15/30/45/60/end of song.
Buffering and playback errors are reported by the player but never shown. No onboarding; permissions are asked in
context. Stream's home is built in `screens/StreamScreen.tsx` + `components/stream/StreamHome.tsx` + `services/stream/homeFeed.ts`.
