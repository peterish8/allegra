# LuvLyrics redesign v3: Glass deck (for owner review, 2026-11-05)

Status: **design only**. Nothing here is in the app. Implementation starts when the owner says go.
Canvas: https://claude.ai/artifact/UGiYJ1UaRjWA66qTFjsmHT, page "Final: Glass deck" (21 boards). Earlier pages
("Current app", v1, v2 A/B) stay for comparison.

Direction chosen by the owner: **B "Glass deck"** for layout, components, controls and navigation, with **A's
background**: one soft cover-coloured glow anchored at the top that fades into a plain `#0c0c10` ground.

## Decisions, the problem each solves, and the source behind it

| # | Decision | User problem it solves | Source |
|---|---|---|---|
| 1 | Five tabs: Stream, Luvs, Library, **Search**, **You** (was Stream, Luvs, mic, Library, •••). Search becomes a tab; the ••• menu becomes "You" (Your DJ, Blends, Listen together, Downloads, Import, Settings) | Search, the most common "find a song" action, was buried in an overflow menu; "More" says nothing about what is inside | M3 navigation bar: 3–5 top-level destinations; HIG tab bars: "use a tab bar to support navigation, not to provide actions", and a More tab "makes it harder for people to reach and notice content" |
| 2 | Tab labels always visible, 12 px, never icon-only; active tab = lens plate + filled glyph + lime + `aria-current` | "Where am I?" must not depend on colour or recognising a glyph | M3 navigation bar accessibility (labels stay visible up to 2× text); WCAG 1.4.1 Use of Color |
| 3 | Mini player docked directly above the tab bar, same glass, on every screen except the full player and Luvs; whole bar opens the player, Pause and Next are separate buttons | One predictable home for "what's playing"; the old pill relied on swipes to open and skip | WWDC25 "Build a UIKit app with the new design" (accessory above the tab bar); WCAG 2.5.7 Dragging Movements |
| 4 | Library holds Songs / Playlists / Artists / Albums in one segmented control right under the title; Playlists is no longer a separate page behind a header button | Two routes to playlists and an unclear "where do playlists live" | HIG tab bars / segmented controls: group related content views in one place |
| 5 | Every pushed page has a 48 px glass back button top-left labelled with its parent ("Back to Library", "Back to You"); the parent tab stays highlighted | Losing your place after drilling into a playlist or artist | HIG tab bars: keep the tab bar visible across sections ("if you hide the tab bar, people can forget which area of the app they're in"), except under a modal; M3 navigation bar |
| 6 | Every song row shows a visible ••• (44 px); long press is a shortcut only | Song actions were reachable mainly by long press, which nobody discovers | WCAG 2.5.7 (single-pointer alternative); HIG buttons |
| 7 | Song actions sheet: the four most common actions as labelled tiles (Play next, Add to playlist, Lyrics, Share), then navigation (artist, version, cover), then hide/delete last, separated, delete in red **with a trash icon and an ellipsis** ("Delete from this phone…") | Scanning a long flat list; destructive items mixed with routine ones | M3 menus accessibility (text + decorative icon); WCAG 1.4.1 (red plus icon plus words) |
| 8 | Every sheet has a visible Done button as well as the drag handle | A drag-only close fails switch and screen-reader users | M3 bottom sheets accessibility; WCAG 2.5.7 |
| 9 | Up next: drag handle for reorder **and** a ••• per row (move, play next, remove) | Reordering was drag-only | WCAG 2.5.7 |
| 10 | Full player has a labelled Close button (chevron) beside the grabber; the lyric preview card is one big button "Open lyrics" | Closing and opening lyrics were gesture or tiny-target only | WCAG 2.5.7; HIG buttons (44×44 pt hit region) |
| 11 | One primary action per region, always a lime capsule **with a text label** (Play, Add songs, Create a Blend, Find songs); secondary actions are glass capsules with labels; icon-only only where the icon is universal (search, back, •••, play/pause/skip) | Icon-only primaries ("what does + do here?" — it was New playlist) | HIG buttons; M3 menus accessibility |
| 12 | Touch targets ≥ 44 px everywhere, 48 px for chrome and primary controls, ≥ 8 px between adjacent targets | Missed taps on the 36 px header and pill buttons | HIG accessibility (44×44 pt default); M3 touch targets (48 dp); WCAG 2.5.8 (24 px minimum) |
| 13 | Text colours: primary `#f5f5f7`, secondary `#b4b4bb` (was `#8e9498`/`#a1a1a8`), tertiary `#8e8e96` only for counts and chevrons. Measured contrast: 17.9 / 9.5 / 6.0 : 1 on the ground, 8.6 : 1 on panels, 6.9 : 1 on glass over the warm glow, danger 5.1 : 1 | Grey-on-dark labels were hard to read outdoors | WCAG 1.4.3 Contrast (4.5 : 1), 1.4.11 Non-text Contrast (3 : 1 for rings and switch tracks: 4.4 and 5.4 : 1) |
| 14 | Glass is used only for floating controls (tab bar, mini player, header capsules, sheets). Anything carrying body text sits on a near-opaque panel (`rgba(28,28,34,0.78)`) or sheet (0.94). Labels on artwork sit in a dark pill. Fallback under Reduce Transparency: solid `#1c1c22` | Translucency over busy covers made text and selected states hard to read | HIG accessibility (reduce transparency); Apple Liquid Glass guidance (glass for controls, content stays legible) |
| 15 | Off/on never by colour alone: switches move the knob and show a ring when off; checkboxes fill and show a tick; Autoplay shows a tick; liked heart is filled vs outline; the playing song has lime title **and** equaliser bars **and** "Now playing" text | Colour-blind users and glare | WCAG 1.4.1 |
| 16 | Deck navigation: side cards are buttons, page dots show position; Play / Shuffle all are labelled buttons under the deck. Swiping is optional | The old deck needed a drag to browse | WCAG 2.5.7 |
| 17 | Large text: rows have `min-height` and wrap to two lines; segmented control becomes 2×2; mini player drops the lyric line and keeps title + Pause; tab labels keep showing (board "Small phone + large text", 360×800 at ~130 %) | Truncated, overlapping text at large font sizes. The board shows ~130 %; the build must hold up to **200 %** (rows grow, nothing clips, tab labels may truncate only past 2×) | HIG accessibility (enlarge text by at least 200 %); M3 navigation bar accessibility (labels at 2×); WCAG 1.4.4 Resize Text |
| 18 | States drawn: empty library (one primary "Find songs" + secondary "Import a playlist"), loading (static skeleton, `aria-busy`, no shimmer loop), offline (amber alert with icon, text and Retry), no results (spelling hint + corrected search), empty playlist (Add songs + Search) | Blank screens and spinners with no next step | M3 / HIG empty-state guidance; WCAG 4.1.3 Status Messages |
| 19 | Reduce Motion: the deck's 3D tilt flattens to a cross-fade, the glow is static, sheets fade in place, no idle loops anywhere | Motion sensitivity; the old app had spinning discs and idle loops | HIG accessibility: under Reduce Motion replace x/y/z transitions with fades and avoid animating depth or blur; repo rule: `prefers-reduced-motion` collapses to opacity |
| 20 | Safe areas: content starts below the status bar (28 px in mockups), chrome sits 18 px above the gesture area; primary playback controls live in the lower half of the player | One-handed reach on tall phones | HIG layout; M3 touch targets |

Sources:
- Apple HIG, Buttons: https://developer.apple.com/design/human-interface-guidelines/buttons
- Apple HIG, Accessibility: https://developer.apple.com/design/human-interface-guidelines/accessibility
- Apple HIG, Tab bars: https://developer.apple.com/design/human-interface-guidelines/tab-bars
- WWDC25, Build a UIKit app with the new design: https://developer.apple.com/videos/play/wwdc2025/284/
- Apple Newsroom, Liquid Glass (June 2025): https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/
- Material 3, Navigation bar guidelines: https://m3.material.io/components/navigation-bar/guidelines
- Material 3, Navigation bar accessibility: https://m3.material.io/components/navigation-bar/accessibility
- Material 3, Touch targets: https://m3.material.io/foundations/designing/structure
- Material 3, Bottom sheets accessibility: https://m3.material.io/components/bottom-sheets/accessibility
- Material 3, Menus accessibility: https://m3.material.io/components/menus/accessibility
- WCAG 2.2: https://www.w3.org/TR/WCAG22/ and WCAG2Mobile: https://www.w3.org/TR/wcag2mobile-22/

## The shared system (what implementation builds into `src/ui`)

- **Ground**: `#0c0c10` + one top glow from the current cover (A's treatment: 560×420 box, two circles, blur 80, opacity 0.5).
- **Glass** (floating controls only): `rgba(40,40,48,0.62)`, blur 28 + saturate 170 %, 0.5 px top highlight and hairline.
  Chrome (tab bar, mini player): `rgba(34,34,40,0.80)`, blur 30.
- **Panel** (lists, cards with text): `rgba(28,28,34,0.78)`, radius 20, 0.5 px hairline; rows 64 px with 48 px art.
- **Sheet**: `rgba(30,30,36,0.94)`, top radius 34, grabber + Done.
- **Type**: page 34/700, section 22/700, row 16/500 + 14 meta, body 15–16, caption 13–15/600, tab 12/600.
- **Accent**: lime `#d9e66a` (primary action, progress, active tab, on-states, playing song); coral `#ee6b5f` liked;
  red `#ff6961` destructive; amber `#ffba49` warnings.
- **Spacing**: 16 px panel inset, 20 px text gutter, 8 px minimum between targets.

## Journeys checked on the boards

| Journey | Path | Where someone could hesitate, and the fix |
|---|---|---|
| Find a song | Search tab → field → results / Recent searches | Search was inside •••; now a tab. Field has a voice button inside it |
| Search the library | Library → search glass button "Search your library" | The label says the scope, so it isn't confused with catalogue search |
| Open a playlist | Library → Playlists segment → card | One route; back button says "Back to Library" |
| Create a playlist | Library header "New playlist" or the "New playlist" row on Playlists, or "New playlist with this song" in Add to playlist | Three entry points, all labelled the same way |
| Add a song to a playlist | Row ••• → Add to playlist tile → tick playlists → Done; status line confirms | Checkbox semantics + "Added" text, not colour alone |
| Remove a song from a playlist | Playlist row ••• → Remove from this playlist | Visible ••• on every row; no long-press dependency |
| Song actions | ••• on any row, in the player, in Luvs | Same sheet everywhere, same order |
| Start playback | Play (lime, labelled) on Library deck, playlist, artist; tap any row | One primary per region |
| Mini player ↔ full player | Tap mini player → full player; Close (chevron) or swipe down to return | Close is a real button, not only a swipe |
| Empty, loading, error | States row on the canvas | Each state names the next step |
| Small screen, large text | 360×800 board at ~130 % | Wrapping rows, 2×2 segments, labels kept |

## Audit (all 21 boards, scripted and by hand)

- Unlabelled controls: 0. Every icon-only control has an `aria-label` that names the action and its object.
- Targets under 44 px: 0 (switch visuals are 52×32 inside a full-row label).
- Text under 12 px: 0. Gradients, uppercase, letter-spacing: 0.
- Contrast: every text pair ≥ 5.1 : 1; non-text indicators ≥ 4.4 : 1 (numbers in decision 13).
- Selected states carry a second signal besides colour on every screen (decision 15).
- Not checkable in a static mockup, to verify in the build: screen-reader focus order on device (markup order is
  top-to-bottom, chrome last), Reduce Transparency/Motion fallbacks, real glass readability over bright covers.

## Changes that need the owner's yes (product calls)

1. Five tabs with Search promoted and ••• renamed "You".
2. The mic slot leaves the tab bar; voice search lives inside the Search field.
3. Playlists folded into Library's segmented control (the separate Playlists page goes).
