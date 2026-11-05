# LuvLyrics redesign, round 5: full-app design proposal

Status 2026-11-06: **designs complete for review, nothing implemented, no app code changed.**
Boards: the Design canvas https://claude.ai/artifact/UGiYJ1UaRjWA66qTFjsmHT, pages "Round 5: system + 5 screens (review)"
and "Round 5: every screen and state" (older pages untouched).
Source of every board: `design-drafts/v5_kit.py` (tokens and components), `v5_core.py`, `v5_rest.py`, `v5_map.py`;
`python v5_build.py` regenerates them, `python v5_audit.py` re-runs the audit. Matrix: `design-drafts/coverage-matrix.md`.
Audit output: `design-drafts/audit-v5.md`.

Validation level for everything below: **visually reviewed at phone scale and scripted-audited**. Nothing is
interactive-prototype tested, TalkBack tested or device tested.

---

## 1. Verified inventory (summary)

Counted from `navigation/RootNavigator.tsx`, `navigation/TabNavigator.tsx`, `src/screens/`, every component that renders
`Sheet`, `PlayerSheet` or `ConfirmSheet`, and the overlays mounted in `RootNavigator`.

| Kind | Count | Notes |
|---|---|---|
| Verified routes (screens) | 20 | 18 screen files + 2 root-stack modals (`CreatePlaylist`, `AddToPlaylist`) |
| Verified sheets, dialogs, overlays, in-screen modes | 39 | Includes the ••• menu, which the proposal replaces |
| New screens proposed (labelled on boards) | 4 | You tab, Library Artists tab, Library Albums tab, Library ⋮ menu |
| Shared state sets | 5 | Loading, empty, errors, keyboard, sizes and 200% text |
| Not drawn, with a reason | 7 | System UI, widgets, notification, system island, rescue screen, debug HUD, empty Up next |
| Boards / phone frames | 21 / 101 | |

The "about 21 screens" figure from round 3 counted 21 boards; the real app has 20 routes and roughly twice as many
sheets and overlays. Full row-by-row matrix: `design-drafts/coverage-matrix.md` and the Coverage board.

Tab bar today: Stream, Luvs, (mic, optional), Library, ••• (Your DJ, Search, Playlists, Settings). Library header: Blends,
Import from Spotify, Downloads, Playlists. Search, Playlists, Dj, Settings and the YouTube Music `Browse` stack are hidden
tab routes, so the bar stays visible on them.

## 2. Where the handoff and the UX prompt disagree, and how I resolved it

| # | Topic | Handoff / code says | UX prompt says | Resolution |
|---|---|---|---|---|
| 1 | Name | Code: LuvLyrics | "radioOutcome" | Boards and docs use the code's names |
| 2 | Library tabs | Code: no Albums, Artists is an orbit filter | Songs / Playlists / Artists / Albums | Artists and Albums drawn, **labelled proposals**; Albums is derivable from `song.album` |
| 3 | Playlist owner, description | Local playlists have neither | "where supported" | Omitted. The V5 draft's "Asha's playlist" line was removed |
| 4 | Playlist artwork picker | Code supports "Cover from your photos" and "Use the songs' covers" | "only if supported" | Kept, in the playlist options sheet |
| 5 | Sort direction | Not supported | "show direction where relevant" | No direction shown. Remembering the sort is a proposal |
| 6 | Shuffle / repeat | Shuffle reshuffles what's next; repeat is repeat-one only | "if supported" | Shuffle drawn as an action (not a toggle), repeat drawn as repeat-one |
| 7 | Buffering and errors | Player reports `playWhenReady` vs `isPlaying` and `onPlaybackError`, UI shows neither | "show real states, only when architecture requires" | Drawn, tagged **Needs code** (the data exists; no new architecture) |
| 8 | Offline | No NetInfo | "only when architecture requires" | No offline state. Drawn "Can't reach the catalog" (a failed request) instead |
| 9 | Moods | Real YouTube Music chips on Stream, mood tiles on Search | "generic mood cards, keep only with real destinations" | Kept as plain chips on Stream; removed from Search (**proposal**) |
| 10 | Search entry | Hidden behind •••, and a field on Stream | "Search in nav vs header" | Search becomes a tab; Stream's field goes (**proposal**, open product call from the handoff) |
| 11 | Mic | A tab-bar button when enabled | "voice only if implemented" | Implemented; moves into the search field (**proposal**) |
| 12 | Glass | Owner taste: clear glass; app: Frosted sheets, glass tab bar | "purposeful translucency, no over-engineered glass" | Round-4 decision kept: opaque shell, opaque sheets, flat browse backgrounds. Cover-tinted player sheets are an **open question** |
| 13 | Weights | V5 draft used 500 | — | App ships only 400/600/700 (500 renders Regular). Rows are 400, playing rows 600 |
| 14 | Missing artwork | V5 draft drew a grey note tile | "fallbacks" | App rule: the generated duotone + monogram cover, never a grey box. Fixed |
| 15 | Tertiary text | `#6F727B` (4.0:1 on base) | 4.5:1 for normal text | `#8A8D96` (5.9:1 on base, 5.3:1 on raised) |
| 16 | Accent and gutter | DESIGN.md: chartreuse, gutter 20 | White accent, gutter 16 | White and 16, per the owner's decisions; DESIGN.md needs updating at implementation |
| 17 | Remove from playlist | Code asks for confirmation | "confirm or Undo by consequence" | Undo toast (reversible). Delete song and delete playlist keep a confirmation |
| 18 | Player ••• | Echo's long menu, duplicates on-screen controls | "one action model" | Same song actions as everywhere, then player tools; Like, Shuffle, Repeat, Lyrics leave the menu because they're on screen (**proposal**) |
| 19 | Look settings | Settings offers App background, Mini player background, Bottom bar style | "only real settings" | Drawn honestly but flagged: they conflict with a fixed shell and flat backgrounds (**open question**) |
| 20 | First run | No onboarding; permissions asked in context | "first-run / permission if present" | No onboarding drawn. Drew the one in-app denied state (audio files); the rest are Android dialogs |

## 3. UX audit of today's app, by severity

| Sev | Problem | Task hit | Fix in round 5 | How to validate |
|---|---|---|---|---|
| Critical | Search, the top listening job, sits behind ••• (and a second copy on Stream) | Find a song | Search tab; one search | Task timing: "play a named song" from cold start, today vs prototype |
| Critical | Buffering and playback errors are invisible; a dead stream looks paused or keeps "playing" | Control playback; failed media | Spinner + "Loading the song…"; "Couldn't play" + Try again, from player state | Device test: airplane mode mid-song, expired link, skip spam |
| High | Four song-action models: Library long press only, Playlist ⋮ + long press, Stream a smaller sheet, player its own menu; no Add to playlist in Library | Organise songs | One sheet, grouped, ⋮ on every row | Card sort / first-click test on "add this to a playlist" from each screen |
| High | Library opens on a decorative deck and artist orbit; songs start below the fold; four unlabelled header circles | Browse library | List first; tabs; header = Downloads + ⋮ | Rows visible above fold: today vs 6–7 in round 5 |
| High | Mini player and tab bar are two floating pills; ••• hides destinations | Navigate, resume | One anchored shell, five labelled destinations | First-click test on "open Settings", "open a playlist" |
| High | Rename and Delete playlist only by long press in Playlists | Manage playlists | Also in the playlist's ⋮ | TalkBack walkthrough without gestures |
| Medium | Sort looks like text and resets each visit | Find in library | Labelled button + half sheet; remembered | Observe whether testers find sort unprompted |
| Medium | Remove from playlist asks first although it's reversible | Edit playlist | Undo toast | — |
| Medium | Player ••• mixes song actions, player tools and on-screen duplicates | Contextual actions | Grouped sheet | — |
| Medium | Copy breaks the app's own rules (emoji in About's coffee row) | — | Plain label | designGuards test for emoji in strings |
| Low | On 640-tall phones the shell takes 146 px (3.5 rows visible) | Browse | Open question: compact shell under 700 | Device test at 360×640 |
| Low | Always-on A–Z rail would collide with ⋮ | Browse | Fast-scroll thumb only while dragging | — |

## 4. Information architecture

Navigation map board ("Navigation map"). Proposed: **Stream · Luvs · Library · Search · You** (Android guidance: 3–5 top
destinations in a navigation bar; sections inside a destination use tabs).

- Stream: what to play next (catalog + history): moods, Jump back in (moved from Library), Quick picks, Daily discover, shelves.
- Luvs: the clip taste map. No mini player (it plays its own clips), as today.
- Library: what you keep. Tabs Songs · Playlists · Artists · Albums. ⋮: Import, Blends, Add songs from this phone, Hidden songs.
- Search: one search for the phone and the catalog, scopes All / On this phone / Online.
- You: Your DJ, Blends, LuvLink, Downloads, Import, Connect devices, Settings, About. Replaces •••.
- Global: the mini player on every tab but Luvs → Now playing (full screen) → its sheets. Root modals: Add songs, New
  playlist. Overlays anywhere: voice card, LuvLink request, Play on this phone?, toasts.

Duplicates removed: Search (••• + Stream field → one tab), Playlists (header circle + ••• → Library tab), mic (bar → field).
Kept on purpose: Downloads in the Library header and in You (status + destination).

**Back**, in order: keyboard → top sheet (focus returns to its opener) → player collapses → page pops → tab root other than
Stream goes to Stream → Stream leaves the app (predictive back shows home). **State**: each tab keeps its stack and scroll
(`freezeOnBlur`, as today); tapping the active tab pops to root, then scrolls to top (as today for Library); Search keeps
query, scope and results until cleared; Library keeps tab, filter and sort.

## 5. Design system

Board "Design system" and "Components". Tokens live in `v5_kit.py` `TOKENS`/`CSS`.

| Role | Value | Contrast on base / raised |
|---|---|---|
| Base | `#0B0D10` | — |
| Raised (shell, sheets, fields) | `#17191E` | — |
| Control (secondary button, chip, sort) | `#22252C` | — |
| Pressed (pressed row, toast, progress track) | `#2A2D34` | — |
| Text 1 / accent | `#F4F4F5` | 17.7 / 16.0 |
| Text 2 (meta, idle icons) | `#A3A5AE` | 7.9 / 7.2 |
| Text 3 (hints, placeholders) | `#8A8D96` | 5.9 / 5.3 |
| Danger | `#FF6B61` | 7.0 / 6.3 |
| Divider | white 6% (decorative) | — |
| Scrim | black 40% | — |
| Artwork atmosphere | cover's two tones, blurred, top of detail pages; immersive on the player | — |

Type (SF Pro in the app; Inter stands in on boards; only 400/600/700): title 28/700 · detail title 24/700 · player title
22/700 · section and sheet title 18/600 · row title 15/400 (playing 600) · button 15/600 · meta 13/400 · group label
13/600 · nav 12/400 (active 600). Nothing under 12. Sentence case, no tracking except the LuvLink room code.

Spacing 4 / 8 / 12 / 16 / 24 / 32, gutter 16. Radius: thumbnails, small controls, chips 8 · large artwork, buttons,
fields 12 · sheets 16. Circles only for people and the play button; switch and slider tracks are the only pills.
Targets 48 × 48 everywhere (scripted check: 0 drawn controls under 48).

Icons: Material Symbols Rounded 24 / weight 400, outline at rest, filled for selected, active and transport. **Open
decision**: ship the font (app + Kotlin tab bar) or map each glyph to Ionicons, which is already shipped.

Artwork: square; 48 in rows (radius 8), 44 in the mini player, cards fill their column (radius 12), playlist and album
headers 120, player cover = the space left after the controls (342 at 390 × 844, 208 at 360 × 640, never below 200).
Missing cover → the app's generated duotone + monogram. Loading → nothing behind a real cover (as today). Playing →
cover kept, small badge at its corner.

## 6. Shared interaction specs

**Shell** (one opaque raised surface, anchored to the bottom edge): 2 px progress line (its top edge) · 64 mini player
(44 art, title 15/600, artist, play/pause, next) · 6% divider · 64 nav + gesture inset. Hidden: under the full player, on
Luvs (mini only), while the keyboard is up (**proposal**; today it stays). No mini player until something has played; it
stays (paused) after playback stops. States: playing, paused, loading (spinner in the play button, progress line pulses),
error ("Couldn't play. Try again", retry button), on another device ("Playing on Living room PC", controls go there).
Under modal sheets it's covered by the scrim. Play/pause shows press feedback at once but the icon follows the player
(`requestPlayback` → Media3 `playWhenReady` → store), never the tap.

**Navigation bar**: five equal cells, icon over label, selected = filled icon + white + 600 + `aria-current`; no badges
except Downloads' count; labels capped at 1.3× font scale (**proposal**) so five fit at 200%.

**Song row** (one component): 64 tall, 48 art, title + meta, ⋮ with its own 48 target, divider inset to the text. States:
default, pressed, playing (badge + 600 + "Playing"), paused current, downloaded (tick in meta), saving (ring + %), no
cover, can't play, selected / unselected (checkbox in multi-select), already in playlist (dimmed), album track number,
drag handle (queue, edit order). Tap plays from that row in that list's context; ⋮ and long press open the same sheet.
TalkBack: one row = "title, artist, state", ⋮ = "More actions for title".

**Song actions** (one sheet, contexts): header = cover, title, artist + source. Library: Play next · Add to playlist · Go
to artist / Find lyrics · Another language or version · Share the audio / Change cover… · Edit title and artist / Hide
this song · Delete song… (red, confirms). Playlist adds "Remove from this playlist" (not red, Undo). Streamed song: Play
next · Save to library · Add to playlist · Go to artist · Share. Player: the same song actions, then Start radio, Lyrics
sources, Cast, Connect devices, LuvLink, Ambient mode, Details, Equalizer, Tempo and pitch, Reload, Set as ringtone.
Rows a song can't use are left out (as today), never shown disabled.

**Sort**: labelled button (icon, current value, chevron) → half-height sheet with only supported options, tick on the
current one, applies at once and closes; remembered per list (**proposal**). Library: Recently added, Title A–Z, Artist.
Playlist: Custom order, Title, Artist, Recently added. No filter system exists, so none is drawn (Library's text filter is
a field, not a filter).

**Feedback**: toast above the shell (Undo where reversible), confirmation sheet for irreversible actions, inline error
blocks with Try again, placeholders in the shape of what's coming, empty states that name the next step.

## 7. Per-screen specs

Format: purpose · entry → exit · hierarchy · key interactions · data owner · states drawn · accessibility · reuse ·
acceptance. Motion follows §9 unless noted.

**Library · Songs** (V5-Library). Purpose: get to a kept song fast. Tab root; exits to Playlist, Artist, player. Header
(title, Downloads, ⋮) · tabs · filter field (count in placeholder) · sort button + Shuffle · rows. Row tap plays the list
from there; Shuffle shuffles all; filter narrows instantly ("3 of 248"). Data: `songsStore` (selectors only), sort from
settings (proposal). States: playing, sort open, A–Z with fast-scroll, loading, empty, permission denied. A11y: tabs are a
tablist; sort button reads "Sort: Recently added. Change". Reuse: PageHeader, tabs, field, SortButton, SongRow, Shell.
Accept: ≥ 6 rows above the shell at 390 × 844; every row reachable without long press; playing badge only when the player
says playing.

**Library · Playlists / Artists / Albums** (V5-LibraryMore). Grid of playlist cards ("Playlist · n songs"), New playlist
first; Artists list (circles, "n songs") → Artist page; Albums grid ("Album · artist", proposal). States: empty
playlists. Accept: a playlist card and an album card are distinguishable by text alone.

**Playlist** (V5-Playlist). Purpose: play or tend one playlist. Back to Library. Cover 120 beside name + "Playlist · 24
songs · 1 h 32 min" · Play (white) + Shuffle · order button + Add songs · rows. ⋮ (top) opens playlist options; search
finds in playlist. Data: `playlistStore` + online playlist rows (both tables, per CLAUDE.md). States: order sheet,
options, edit order (drag handles + screen-reader move actions), removed + Undo, empty. Accept: five songs above the
shell; Play is the only white control; Rename and Delete reachable without long press.

**New playlist / Rename / Delete** (V5-PlaylistFlows). Sheet on the keyboard; Create disabled until there's a name;
busy on tap (no double create); failure keeps the name; success opens the new playlist (proposal) with Add songs next.
Delete asks ("Songs stay in your library"). Back closes the keyboard, then the sheet; a typed name is discarded only on a
second Back (proposal: keep it as a draft while the sheet lives).

**Add songs / Add to playlist** (V5-AddToPlaylist). Add songs is full screen titled "Add to <playlist>", multi-select with
a counting button; songs already in it dimmed. Add to playlist is a sheet from a song: ticks on playlists that already
have it (proposal), New playlist inline, "Save to library only" for streams. Toast confirms.

**Search** (V5-Search). Tab root (proposal). Field auto-focuses (as today, 250 ms) · recent searches with remove and
Clear · as you type: Artists, On this phone (instant), Online (loading placeholders) · scopes All / On this phone /
Online. States: idle, typing + keyboard, results, no results, catalog unreachable (phone results stay). Data: Search
screen state; keep query, scope and results when a result opens and Back returns (needs a small store or kept
route state; today the screen is frozen on blur, which already keeps it while mounted). Accept: query and scroll restored
after opening and closing a result; no mood tiles.

**Now playing** (V5-NowPlaying). Immersive (cover glow). Collapse · "Playing from <source>" (tap opens it) · ⋮ · cover ·
title, artist (→ artist), heart · seek (48 tall hit area, "1:24 of 3:41") · shuffle-what's-next · previous · play/pause
(white, 72) · next · repeat-one · volume (hidden under 680 tall) · Up next · output · sleep timer · lyrics. Gestures stay
(tap cover to flip, double tap ±5 s, swipe to skip) but each has a button. States: playing, loading, couldn't play,
lyrics, Up next, ⋮. Data: `usePlayerStore` only. Accept: cover shrinks before any control does; icon state matches
Media3 after rapid taps; error never leaves a "Playing" UI.

**Song actions** (V5-SongActions): see §6. Delete song confirms; Change cover is a second sheet.

**Stream** (V5-Stream). Why open it instead of Library: what to play next. Header (Downloads, About with update dot) ·
mood chips · Jump back in (proposal) · Quick picks · Daily discover. States: mood chosen, first-load placeholders,
catalog unreachable (keeps the cached page), Add a list, LuvLink join request. Accept: opens on its cached page
instantly (as today).

**Luvs** (V5-Luvs). Lanes as tabs, clip stack, title, clip scrubber, Luv · Save · Playlist · Full song · Share (labelled,
48+). Sheets: Languages (multi-select), Saved from Luvs. No mini player.

**Artist / Album** (V5-Browse). Artist: photo band (not full screen), name, "subscribers · n songs on this phone", Play,
Shuffle, Radio, Follow, On this phone, Top songs, Albums, Fans also like, About. Album: like Playlist with track numbers.
Error: Try again / Go back.

**Player sheets** (V5-PlayerTools): Sleep timer (15/30/45/60 min, end of song; running: countdown, add 15, turn off),
Connect devices (signed in / out), Lyrics sources, Details, Tempo and pitch, Ambient mode, remote playback.

**You and Settings** (V5-You): You hub (proposal), today's ••• for comparison, Settings (grouped, values open choice
sheets, switches act at once), library and data (red rows confirm), first-sync choice, Hidden songs (+ empty).

**Blends, LuvLink** (V5-Social): Blends list / signed out, a Blend (who brought each song), Join (+ failure), LuvLink start,
in a room (code, requests, listeners, Leave).

**DJ, import, editors** (V5-Tools): Your DJ (set, suggestions, ask field above the shell), DJ settings, Import (choose,
running, done), Edit lyrics, Change cover search, Another version, Edit title and artist.

**Voice, notices, app states** (V5-Overlays): voice listening and result, Play on this phone?, About + update, screen
crashed (player keeps playing).

## 8. Journeys

1. **Find and play**: Search tab → field focused → type "mira" → On this phone results appear instantly, Online loads →
   tap Small Hours → spinner in mini player → playing badge on the row and title in the mini player once Media3 reports
   playing → tap mini player → Now playing → collapse → Search still shows "mira" and its results. Failure: catalog down →
   phone results still playable.
2. **Browse and play**: Library → Artists → Mira Vale → On this phone → tap → playing badge appears in the Artist page,
   Library Songs and the mini player at once (one store) → Back → Artists tab kept.
3. **Create a playlist**: Library → Playlists → New playlist → type → Create (busy, single submit) → new playlist opens →
   Add songs. Cancel/Back closes without creating. Failure keeps the name.
4. **Add a song to a playlist**: row ⋮ → Add to playlist → tick shows where it already is → tap Monsoon mornings →
   sheet closes, toast "Added to Monsoon mornings" → same scroll position.
5. **Manage contents**: Playlist ⋮ → Edit order → drag (or screen-reader Move up/down) → Done. Row ⋮ → Remove from this
   playlist → row leaves, toast with Undo. Delete playlist → confirmation.
6. **Control playback**: mini player → Now playing → pause (icon flips when Media3 does) → drag seek (resumes if it was
   playing) → next / previous → collapse.
7. **Search and return**: covered in 1; Search state survives tab switches (freeze) and result round trips.
8. **Failed media**: tap a song with an expired link → spinner → recovery reloads (as today) → if it still fails: "Couldn't
   play this song", Play shown, retry available; never "Playing".
9. **Back and dismissal**: row ⋮ → sheet → Back closes the sheet, focus returns to that ⋮ → Back again pops the page.
   Confirmation over a sheet: Back closes the confirmation first.
10. **Small screen and large text**: 320 × 640: 3.5 rows above the shell (open question). 200%: rows grow to two-line
    titles, Shuffle becomes icon-only, tabs scroll, nav labels capped.

## 9. Accessibility and motion

Accessibility (design-level; not tested with TalkBack): 48 × 48 targets (Android guidance); every control named (scripted:
0 unnamed); roles: tablist/tab, radio for scopes and sorts, checkbox for selection, switch, slider with value text;
states: selected, checked, busy (loading play), pressed (like, repeat); reading order follows layout; sheets trap focus
and return it to the opener; every gesture (swipe to skip, long press, double-tap seek, drag to reorder) has a visible
control or a screen-reader action; no colour-only state (filled icons, weight, ticks, text); text contrast per §5 (WCAG
2.2 1.4.3), UI parts ≥ 3:1 (1.4.11; switch outline 4.6:1); the lyrics' non-sung lines are large text at 3.9:1 (passes
3:1). Text scales: rows grow instead of clipping.

Motion (existing `src/ui` tokens; transform and opacity only): press = `Tactile`; small state = `Motion.duration.fast`
160; sheets = `Motion.spring.open`, releases keep finger speed; player = one sheet growing from the mini player (open
spring, fling); list changes slide with transforms, 40 ms stagger, max 6; Reduce Motion = fades, no feature removed; no
idle loops on browse screens; at most two self-running effects per screen. Haptics through `utils/haptics` as
DESIGN.md §7a (no new dependency).

## 10. Component reuse plan (maps to `src/ui`)

| Round-5 part | Today in `src/ui` | Change |
|---|---|---|
| SongRow | `ListRow` (64 pt) | Add ⋮ slot, badge, states; one component for every list |
| Shell | `MiniPlayer`/`PillPlayer` + Kotlin `NativeTabBarView` | New anchored layout; the tab bar is native, so this is the largest piece |
| PageHeader, tabs | `PageHeader`, `Segmented` | Add a text tab row |
| Buttons | `Button`, `IconButton`, `TextButton` | White primary; radius 12 |
| Chips | `Chip`, `ChipRow` | Radius 8, white fill + tick |
| SortButton | — | New, small |
| Sheet, options, confirm | `Sheet`, `SheetOption`, `ConfirmSheet` | Already the one sheet; restyle to raised |
| Feedback | `Toast`, `EmptyState`, `RowPlaceholder` | Toast gains Undo |
| Artwork | `allegra/Artwork` (generated fallback) | Unchanged |

## 11. Implementation architecture (after approval)

- Tokens first: `allegraTheme.ts` / `src/ui` tokens to the §5 values; update DESIGN.md (white accent, gutter 16, radii).
- Playback status: derive one `playbackStatus` (`idle | loading | playing | paused | error`) in `usePlayerStore` from
  `playWhenReady`, `isPlaying` and `onPlaybackError`; mini player, Now playing and rows read only that. No local copies.
- Navigation: `VISIBLE_TABS`, `MORE_ITEMS`, deep links (`lyricflow://open/...`), the smoke test's walk and the native tab
  bar change together. Highest-risk step; behind its own PR.
- Lists stay FlashList with fixed 64 rows; artwork through `Artwork`; no live blur on the shell (CLAUDE.md).
- Sort persistence in `settingsStore` (migration); Search state kept across result round trips.

## 12. Completion matrix

Full table: `design-drafts/coverage-matrix.md` (also the Coverage board).

| Measure | Count |
|---|---|
| Verified full screens | 20 |
| Verified sheets, dialogs, overlays | 39 |
| Proposed new screens | 4 |
| Essential shared components | 9 (SongRow, Shell, header + tabs, buttons, chips, SortButton, Sheet family, feedback, Artwork) |
| Phone frames drawn | 101 on 21 boards |
| Items designed | 67 of 75 (+1 drawn only as the “today” reference: the ••• menu the You tab replaces) |
| Items visually reviewed | 68 |
| Interactive-tested / device-tested / implemented | 0 / 0 / 0 |
| Not drawn, with reason | 7 (6 out of scope, 1 gap: empty Up next) |

Design completion and implementation completion are tracked separately: implementation is 0 of 75.

## 13. Open questions (need the owner)

1. Navigation: Search and You as tabs, ••• removed? (Everything in §4 depends on it.)
2. Icons: Material Symbols Rounded (new font in app + Kotlin) or Ionicons?
3. Look settings: retire App background, Mini player background, Bottom bar style?
4. Player sheets: opaque raised (drawn) or keep today's cover-tinted glass?
5. Short phones: compact shell under 700 tall?
6. Library: Albums tab yes/no; Artists tab replaces the orbit?
7. Jump back in on Stream, and Stream without its own search field?
8. Undo for Remove from playlist; remember sort; membership ticks in Add to playlist?
9. Shell hidden while the keyboard is up?

## 14. Implementation plan (after approval only)

1. Tokens, type weights, DESIGN.md; designGuards updated (no app behaviour change).
2. SongRow + Sheet restyle + SortButton + Toast Undo, applied to Library and Playlist.
3. Playback status in the store; mini player and Now playing show loading and errors.
4. Search screen + Now playing layout.
5. Navigation change (tabs, You, deep links, native tab bar, smoke test) in its own PR.
6. Remaining screens in board order; then device checks at 360 / 393 / 430 widths, 200% text, TalkBack, rapid taps,
   airplane mode. Each phone build bumps `expo.version`.
