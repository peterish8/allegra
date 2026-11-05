# Round 6 refinements (2026-11-06): for review, nothing implemented

Canvas https://claude.ai/artifact/UGiYJ1UaRjWA66qTFjsmHT, version 32. Built from `design-drafts/v5_round6.py` on top of
the round-5 kit (`python v5_build.py`). Audit: 115 phone frames; weights, names, 48/24 targets and contrast all pass.

## 1. Now playing (page "system + 5 screens", board 4)
- Depth comes from the cover: blurred full-screen behind, its own coloured shadow under the sharp cover, a scrim only
  under the controls. One frosted play disc; on-media white tones; no hard lines.
- No volume row anywhere. The freed space goes to a 342 cover and calmer gaps.
- Status without new rows: loading = spinner inside the disc; failure = the disc becomes the one retry, and an info control
  sits in the cover's top-right corner. Tapping it softens the cover in place and explains, with a quiet text retry; the
  control becomes ×, Back closes details first. Title, seek and transport never move. The copy does not claim a network
  cause; the app should map `onPlaybackError` reasons (`expired`, `network`, `stall`, `error`) to wording.
- Lyrics view: cover thumbnail and a lit lyrics button to go back, the lines, seek, previous/play/next. Nothing else.
- Up next: the next three covers fanned behind the playing one (top half); a glass queue panel with source, shuffle,
  repeat, one segmented filter and calm 56 rows, autoplay songs labelled (bottom half); a pulled-up variant.

## 2. App-wide surface changes
- Every screen: the playing song's cover, blurred once, glows across the top ~20% and fades into the dark ground. No glow
  before anything has played. Luvs and the player keep their own backgrounds.
- Frost, used sparingly: the bottom shell (mini player + navigation), toasts, player sheets and the Up next panel. On
  Android the shell's frost is the cover bitmap blurred once under a 58% dark tint, not a live blur of the scrolling list
  (CLAUDE.md: live blur on always-visible chrome re-renders every scroll frame). Reduced transparency, Battery Saver and
  low-end phones get the opaque raised fallback (`frost.solid`).
- Navigation: the selected tab gets a quiet 56×30 indicator (radius 10) plus filled icon and weight 600.
- Song-action sheets (library, playlist, stream, cover options): deeper, opaque `#0D0F12` with a 6% top hairline.

## 3. Mini player seek (Library board)
The progress line is the top edge of a 24-tall seek band of its own (the mini row is 56 below it), so no touch target
overlaps the open-player area or the buttons. Tap jumps; drag shows a thumb and a "2:03 / 3:41" preview kept on screen;
the row dims while dragging; release commits through the same seek path as Now playing (capture `wasPlaying`, seek,
resume). Cancelled drags snap back; a track change or buffering cancels the drag; a failed seek returns to the player's
reported position. Unknown length: dashed line, `aria-disabled`. TalkBack: a slider with "1:24 of 3:41" and adjust
actions of ±10 s. 24 px meets WCAG 2.5.8 (minimum) but is under Android's 48 dp recommendation; precise seeking stays in
Now playing.

## 4. Library controls
Filter field and Shuffle row removed. A search icon closes the tab row and searches only the current tab; it opens a
frosted field (back restores the tabs, × clears), with "2 of 248 songs · searching Songs only". Sort is a quiet trigger
on the left above the list, with the count on the right. Songs start ~65 px sooner. At 200% text the tabs scroll and the
icon stays pinned at the end of the row.

## 5. Empty library and music access; the hierarchy rules
- Empty library: a small fanned-deck illustration (drawn shapes, no image asset), "Your next favorite starts here", one
  line ("Save songs from Stream, or add music files from this phone"), primary **Find music on Stream** (Stream is the
  start screen and saving is explicit), text action Add songs from this phone. Motion: a 520 ms fan-out once, then at most
  two 2° tilts after 8 s idle; Reduce Motion shows the resting frame with a 160 ms fade.
- Music access, two real states: Android can still ask ("Allow access" opens its prompt: Music and audio on Android 13+,
  Files and media before) or it can't ("Open settings", neutral wording). Not now is a text action; Stream is untouched.
- Rules now applied in the kit, so every board inherits them: one compact primary per state; secondary actions are text
  (Cancel and Not now are never filled); no full-width buttons in empty states; empty-state heading 19/700, one line of
  body; confirmations keep a full-width destructive action with a text Cancel.

## 6. Playlist (board 2)
Reading order: cover (184, centred, lifted by its own shadow), name (24/700, two lines max), then a row with the quiet
meta on the left and Shuffle (frosted 44) + Play (56 white disc) on the right, then a quiet utility line (Order on the
left, Add songs on the right), then songs. Four songs show above the player. Management stays in ⋮. States: populated,
long name, loading, partial error, order sheet (with the direction the app already supports and keeps), options, edit
order, empty, 200% text.

**Loading, from reading the code (to measure before changing):**
1. `getPlaylistSongs` (`database/playlistQueries.ts:140`) reads the ids, then calls `getSongById` once per song: N+1
   queries. Candidate: one `JOIN` ordered by `sort_order`.
2. `loadData` (`screens/PlaylistDetailScreen.tsx:158`) calls `getAllPlaylists()`, which counts songs for every playlist
   including the online tables, just to read one name and cover. Candidate: a single-row query, or the row the Playlists
   screen already has passed as a route param, so the header renders on the first frame.
3. The load runs twice on open: `useFocusEffect` and the `onlineVersion` effect both fire on mount. Candidate: one trigger.
4. Local songs, then online rows, run in sequence. Candidate: render local rows first, merge online rows when they land.
5. Failures are swallowed (`console.log`), so the screen can't show a partial error. Candidate: keep what loaded and
   show the one-line retry.
Already right: FlashList for the list, `expo-image` with memory-disk cache for the header, stable `song.id` keys.
Measure on a low-end and a mid-range Android, with 24, 200 and 1,000-song playlists, cold and warm: screen-entry time (tap
to first frame), first usable content (header + first rows), scroll frame times while artwork decodes, artwork time to
visible, and the query count per open. Change only what the numbers point at; no animation to mask delay.

## 7. Stream (page "every screen", board Stream)

**Diagnosis (from `StreamScreen.tsx` and `StreamHome.tsx`):** before any music there are four control rows: a search field
with a list button, a Downloads tray, an Import tray and mood chips. Below them, the same kind of content repeats: a
shortcut grid, Quick picks, Daily discover, one "More like X" shelf per artist, Forgotten favourites, followed artists,
then YouTube Music's own shelves. Every shelf uses the same square card, so songs, albums, playlists and mixes look
alike. Most headings carry their own action (Play, See all, Clear), so actions compete. A long press on a cover silently
queues it, against the app's own rule (DESIGN.md §7a).

**Research, verified:**
- YouTube Music's 2024 home tweaks swapped the "More" pill for a chevron, made shelf titles smaller, removed second-line
  descriptions, and kept "Play all" for Quick picks; Speed dial is a 3×3 grid of quick access
  ([9to5Google, 2024-08-12](https://9to5google.com/2024/08/12/youtube-music-home-feed-tweaks/)).
- YouTube Music's Speed dial now includes albums and playlists you only partly finished, a "Quick start" shelf starts radio
  from up to 8 high-affinity artists, and Quick picks surfaces artists you were exposed to but didn't seek out
  ([YouTube Music Help, Sept 2025](https://support.google.com/youtubemusic/thread/375076277)).
- Spotify's home has filter buttons at the top that switch the feed rather than open new screens
  ([The Verge, 2022-08-09](https://www.theverge.com/2022/8/9/23298679/spotify-app-redesign-podcasts-music)).
- Not verified this session: Spotify's two-column shortcut grid. The app's own `StreamHome.tsx` already models it on that.

**Recommendation (mine):** take YouTube Music's information (typed quick access, Quick picks, one Play all, chevrons)
and Spotify's restraint (filters that act on the feed, a short shortcut grid), with one rule for types: **rows are
songs, squares are collections, circles are artists**, and every meta line names the type.

| # | Section | Purpose | Format | Meta | Primary / secondary |
|---|---|---|---|---|---|
| 0 | Header | Place, About (update dot) | Title + one icon | — | — |
| 1 | Mood filters | Filter the whole page | Chips, one row | — | Tap filters; tap again clears |
| 2 | Jump back in | Resume in one tap | 2×3 tiles, 56 tall | Type (Playlist, Album, Song, Artist, Mix); thin progress for half-played | Tap plays/opens; long press = actions |
| 3 | Quick picks | Something new now | 4 song rows | Artist | Row plays; ⋮ actions; the page's only "Play all" |
| 4 | Made for you | All personal mixes in one place | Shelf of 148 squares | "Mix · …" | Tap opens; long press = actions |
| 5 | Your artists | Followed artists | 96 circles | Name | Tap opens the artist |
| 6 | From YouTube Music | Catalog shelves, typed | 148 squares | "Album · artist · year", "Playlist · YouTube Music" | Tap opens |

Above the fold: header, filters, Jump back in, Quick picks with about four rows. Merged: Daily discover, every "More like
X" and Forgotten favourites become cards in Made for you. Moved: search to the Search tab, Downloads to Library and You,
the import tray into one status line shown only while something runs, Add a list to Library ⋮. Vertical for songs
(scannable, actionable); horizontal only for collections and artists, one carousel per heading, never nested. States drawn:
default, scrolled, mood, activity line, long-press actions, first run with no history (no Jump back in), first load,
catalog unreachable (cached page kept), 200% text (grid to one column). Scroll position and filter persist per tab
(`freezeOnBlur`); detail pages push inside the tab, so Back returns to the same scroll. Reduce Motion: shelves don't
animate in.

## 8. Decisions accepted
The owner accepted all five defaults: Search and You tabs, Ionicons, one shell with the three old shell settings retired (Player background retained), compact shell below 700dp, and Albums/Artists tabs with remembered sort, Undo and membership ticks. Canvas republishing is waived; the repository gallery is authoritative for this implementation.
