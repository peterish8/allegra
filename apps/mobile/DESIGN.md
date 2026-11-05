---
name: LuvLyrics V6 frontend system
status: active
inherits: Approved V6 direction (.planning/mobile-ui-review/REDESIGN-V6-NOTES.md)
source_of_truth:
  - src/ui/
  - src/constants/allegraTheme.ts
  - src/components/allegra/
  - src/components/PillPlayer.tsx
  - src/navigation/playerSheet.ts
  - src/widget/
---

# LuvLyrics design system

> ## Redesign direction (approved 2026-11-06; runtime migration, release pending)
>
> The owner approved the redesign's direction: **neat, minimal, modern, frosted, with depth**. It replaces the
> earlier look as each area is implemented. The shared token and primitive rules below now describe prepared V6 source;
> the shell and screen migration are in source, with runtime/device validation tracked separately. Designs: `.planning/mobile-ui-review/design-gallery/index.html` (offline) and the Design canvas
> linked in `.planning/mobile-ui-review/HANDOFF-2026-11-06-round6.md`. Specs: `REDESIGN-V6-NOTES.md`, `REDESIGN-V5-SPEC.md`.
>
> - **Ground and colour**: near-black base `#0B0D10`, raised `#17191E`, control `#22252C`; text `#F4F4F5` / `#A3A5AE` /
>   `#8A8D96`; danger `#FF6B61`. **White is the only accent**: the one primary action and selected states. Colour comes
>   from artwork.
> - **Glow**: the playing song's cover, blurred once, across the top ~20% of every screen, fading into the ground. No glow
>   before anything has played.
> - **Frost, sparingly**: the bottom shell, toasts, player panels. On Android it is the cover bitmap blurred once under a
>   dark tint, never a live blur of scrolling content; an opaque fallback for reduced transparency, Battery Saver and
>   low-end phones. Lists and reading areas stay crisp.
> - **Depth on Now playing**: cover blurred full-screen, the sharp cover lifted by its own coloured shadow, a frosted play
>   disc, no volume row, status shown inside existing controls so nothing moves.
> - **Hierarchy**: one compact primary action per state; secondary actions are text; no full-width buttons in empty
>   states; long press always opens actions.
> - **Shape and type**: radius 8 / 12 / 16; circles only for people and play discs; 48 dp targets; SF Pro 400/600/700 only;
>   rows 15/400 (playing 600), meta 13, titles 28 and 24.
> - **Types at a glance**: rows are songs, squares are collections, circles are artists.
>
> When an area is implemented, move its rules into the sections below and delete what they replace.

LuvLyrics is a lyrics-first music player. It shares Allegra's visual language —
album art supplies the atmosphere, frosted material separates content, one
stable action colour stays legible over any artwork — and adapts it to a phone
held in one hand, on hardware as old as a five-year-old mid-range Android.

The feeling to aim for: a dark listening room lit by the cover that is playing.
Calm at rest, responsive under the finger, never busy.

This is the contract for new screens and for visual refactors. When this file
and the code disagree, fix one of them in the same change.

---

## 0. Build from the library (`src/ui`)

Every screen is built from one component library. Import from `src/ui` and
nowhere else:

```tsx
import { Button, IconButton, Chip, ListRow, Sheet, ConfirmSheet, Text, PageHeader, Haptics, useBottomClearance } from '../ui';
```

A one-off button is how the app ended up with six pressed colours, 28 font
sizes and a ••• that does nothing. If the library lacks something, add it to
`src/ui/`, export it from `src/ui/index.ts`, add a row below, and use it in
the same change.

| Need | Component |
| --- | --- |
| Any text | `<Text variant tone tabular? align?>`: size and weight from the role, colour from the tone (§3) |
| A labelled action | `<Button label icon? variant="primary·glass·plain·danger" size="md·sm" block? busy?>` |
| An icon-only control | `<IconButton icon label onPress size="sm 36·md 40·lg 44" variant? selected?>`. `label` is required (the screen reader's name); the touch area is at least 48 |
| An inline text action ("See all", "Undo") | `<TextButton label onPress>` |
| A filter, a sort, a mood | `<Chip label selected onPress clearable?>` in a `<ChipRow>`; chosen is lit white glass |
| 2–4 exclusive options | `<Segmented value options onChange label>`: the lit plate slides |
| A row in a list | `<ListRow title subtitle artwork·icon onPress onLongPress trailing chevron? active?>`, 64 pt (`ROW_HEIGHT`) |
| A row in a sheet or menu | `<SheetOption label icon? selected? hint? destructive? onPress>` |
| Something rising from the bottom | `<Sheet visible onClose title? tall? surface="deep?raised?player" palette? keyboard?>` (§2a) |
| A question before something final | `<ConfirmSheet title body confirmLabel destructive onConfirm onClose>` |
| A tab page's title | `<PageHeader title subtitle? actions? leading?>` |
| Nothing here yet | `<EmptyState icon title body action?>` |
| Loading | `<RowPlaceholder>` / `<Placeholder width height>`: the shape of what is coming |
| A glass card or menu body | `<Panel>`; the material itself is `Frosted` |
| A custom tappable (a cover card, the deck) | wrap it in `<Tactile>` (buttons, cards) or `<TactileRow>` (full-width rows) |

Tokens (`Signal`, `OnMedia`, `Glass`, `Space`, `Radius`, `TypeScale`,
`Motion`) are re-exported from `src/ui` too. A screen never writes a colour, a
font size, a duration or a bottom padding as a number.

---

## 1. Colour and tokens

`src/constants/allegraTheme.ts` is the runtime source of truth, re-exported by `src/ui`.
Screens select semantic roles; they do not define their own palette or type ramp.

| Role | Token | Value |
| --- | --- | --- |
| Page | `Surface.base` | `#0B0D10` |
| Raised reading surface | `Surface.raised` | `#17191E` |
| Secondary control | `Surface.control` | `#22252C` |
| Pressed surface | `Surface.pressed` | `#2A2D34` |
| Song actions | `Surface.deep` | `#0D0F12` |
| Primary action / selection | `Signal.wave` | `#F4F4F5` |
| Ink on action | `Signal.waveInk` | `#0B0D10` |
| Primary / secondary / muted text | `Signal.ink / inkSoft / inkMuted` | `#F4F4F5 / #A3A5AE / #8A8D96` |
| Destructive | `Signal.danger` | `#FF6B61` |

White is the only action accent. Artwork supplies atmosphere, never the control palette.
Legacy `Signal.accent*`, `vibeBlue`, `inkFaint` names remain compatibility aliases during
screen migration; new components use semantic roles. Do not introduce another colour system.

`Text` defaults to opaque surface tones. `onMedia` explicitly selects `OnMedia` whites
for artwork-backed player surfaces. Muted text passes 4.5:1 on base, raised, control and
song-action surfaces; it does not pass on `Surface.pressed`, so toast copy uses primary
or secondary. Filled destructive buttons use dark ink, not white text on coral.

## 2. Shared materials and controls

Shape is 8 for thumbnails/chips, 12 for fields/buttons/panels, 16 for sheets.
Circles are for people and player discs (`IconButton shape="disc"`). `Control` owns
minimum touch targets (48), button sizes, glyph sizes, list rhythm and the 16 gutter.

`Button` exposes primary, secondary, plain and danger. One compact primary per state;
Cancel and Not now use plain. The old `glass` variant is an opaque secondary compatibility
alias. Buttons grow with system text; `sm` changes the label and padding, not the 48 target.
`IconButton` keeps its 36/40/44 visual inside a real 48 target, rather than overlapping
neighbours with hit slop. `Chip` is an 8-radius opaque control; selected is white.
`Segmented` uses the same material and target rules, with transform-only indicator movement.

`Panel` is opaque raised by default. Supplying a player artwork palette opts into the
existing frosted material. Never use live list blur on persistent chrome. The bitmap
shell and top artwork glow are implemented by `ShellMaterial` and `AppScreen`. Reduced-transparency,
Battery Saver and low-end devices use the opaque fallback.

### Sheets (`Sheet`)

`surface="deep"` is the opaque default for song actions and contextual choices;
`raised` is a quieter opaque surface; `player` opts into player glass. Existing callers
with a palette retain player glass. The card anchors to the bottom with 16 top corners
and a quiet hairline. Scrim opacity stops at 0.4.

```tsx
<Sheet visible={open} onClose={close} title="Sort by" surface="deep">
  {SORTS.map(s => <SheetOption key={s.key} label={s.label}
    selected={sort === s.key} onPress={() => pick(s.key)} />)}
</Sheet>
```

The sheet springs open, follows the finger and settles or closes at release speed.
Reduce Motion fades. Its list uses `SheetScrollView`, or `SheetScrollable` around an
existing FlatList/FlashList; the wrapper reports the offset itself. Keyboard sheets pass
`keyboard`. Native back closes modal sheets; player sheets use inline presentation.
Confirm irreversible actions with `ConfirmSheet`, with a named destructive action and
text Cancel. Reversible removals should offer Undo when that screen is migrated.

`EmptyState` has one optional compact action and a short explanation. Reading rows use
`ListRow`, sheet actions use `SheetOption`, selection rows use `CheckRow`. Rows have minimum
heights and can grow with text. Do not use a fixed `getItemLayout` on variable-height rows.
Artwork fallback stays in `Artwork`; icons come from Ionicons.

## 3. Type

`Typography` is the semantic role map used by `Text`. It references `TypeScale` and
bundles size, line height and weight. SF Pro resolution remains in `constants/fonts.ts`
and `theme/appleTypography.ts`. Only 400/600/700 ship. No manual tracking on labels.

| `variant` | Size / weight | Use |
| --- | --- | --- |
| `page` | 28 / 700 | Tab title |
| `detail`, `playerTitle` | 24 / 700 | Detail / playing song |
| `title` | 18 / 600 | Section / sheet heading |
| `lead` | 19 / 700 | Empty / confirmation heading |
| `row` | 15 / 400 | Normal row; playing title 600 |
| `body` | 15 / 400 | Reading copy |
| `label` | 15 / 600 | Action |
| `secondary`, `meta` | 13 / 400 | Metadata |
| `caption` | 12 / 400 | Navigation / short hint |

`hero` and `display` remain for existing special surfaces. Allow system scaling, grow
rows/controls and wrap important labels. Numbers that change in place use `tabular`.
Sentence case; no all-caps labels, emoji or decorative tracking.

## Implementation status

Version 1.37.0 combines the pending polish with the approved V6 migration. Source and automated
checks are distinct from a published APK and physical-phone validation. See
[the release ledger](../../.planning/mobile-ui-review/IMPLEMENTATION-STATUS.md).

## 4. Layout and the bottom shell

`AppScreen` binds the current cover to the stateless `Screen`/`CoverGlow` primitives. `AppSafeArea`
is the equivalent for utility screens. There is no moving shader at rest, and no glow before a song.

The five tabs are Stream, Luvs, Library, Search and You. Use Ionicons in both the React Native
fallback and Kotlin V6 tab bar. Search and You are first-class destinations; voice remains available
through the existing voice flows. The Stream top-right LuvLyrics mark opens About and Updates.

The bottom shell is flush with the edges: a 24dp seek band, a 56dp mini row and 64dp navigation
plus the safe inset. Below 700dp tall, navigation reserves at least 8dp below its targets. At large
text the mini row grows to 72dp. `v6Shell.ts` is the geometry source; `useBottomClearance()` reserves
only visible mini-player space, including Connect remote playback. Hide the shell for the keyboard.

`ShellMaterial` blurs only a tiny copy of the cover. It never blurs scrolling content. Use opaque
raised fill for reduced transparency, Battery Saver, low-end devices, or missing artwork. The old
App background, Mini player background and Bottom bar style settings are retired.

## 5. Playback surfaces

The mini player uses square artwork and separate metadata, play/retry and next targets. Its seek
band is adjustable by TalkBack in ten-second steps, clamps to known duration, shows a scrub thumb
and time preview, cancels when the track changes or loading starts, and restores position on failure.
Unknown duration is a dashed inactive track. Connect remote seek stays inactive until supported.

`playbackStatus` separates playback intent from audible playback. Loading, play/pause and retry
occupy the same disc; a reduced-motion loading state is static. Error details are a cover inset, so
neither the title nor scrubber moves. Retry callbacks come from the existing playback owners;
presentation components never start another audio player. Native audio, native skip, scrubber and
lyrics clocks keep their current ownership. V6 uses the shared React Native transport disc so loading
and retry remain visible; it does not use the older native play/pause-only transport bar.

Now playing defaults to a sharp cover card, at most 342dp, over the chosen Player background.
Keep cover-to-lyrics and swipe gestures, the player sheet, Up next and playback ownership invariants.
There is no volume row. Player background remains configurable. Up next explains an empty queue
without hiding the current song's transport.

### Canvas

Decorative, muted, never takes audio focus. The cover stays under it, so
whatever the canvas reveals is the cover, never a gap. It never vanishes mid-frame: when
the song changes the old clip fades out (520 ms) before the next one fades in
on its first frame. The layer has no backing of its own, so before the first
frame (or on a frame the decoder hasn't filled) the cover underneath shows,
never black. The loop is the player's own repeat, which holds the last frame
until the next one is ready — no fade at the seam. `CanvasVideoLayer` sizes the video
from its real track dimensions to a true cover fit and renders into a
TextureView on Android (a SurfaceView ignores fades, clips and the sheet's
drag). The lookup keys on title + artist only, so metadata backfill mid-song
can't blank it.

---

## 6. Screen hierarchy

| Screen | Composition |
| --- | --- |
| Stream | Moods, Jump back in (six typed song shortcuts), four vertical Quick picks with Play all, one Made for you collection shelf, Your artists, typed provider shelves. Collection taps open a real mix page; long press opens real actions. The LuvLyrics mark stays at top right, with an update dot. |
| Library | Songs, Playlists, Artists, Albums. Search is pinned beside horizontally scrolling tabs and searches the active scope. Song sorting is remembered. Albums and playlists use square covers; artists use circles. Phone import, hidden songs and account import remain accessible through Library options. |
| Playlist | Centered 184dp cover, 24dp title, metadata with compact shuffle/play discs, quiet order and Add songs utilities, then shared song rows. Edit mode retains reorder handles. Removal offers Undo; concurrent additions survive restoration. |
| Artist / album | Centered compact artwork, 24dp title, quiet metadata and compact actions, then real catalog sections. No decorative full-height hero. |
| Search | Dedicated search destination retaining local/catalog scopes and real result actions, on the shared room. |
| You | Listening, Library and App groups with DJ, Blends, LuvLink, downloads/import, devices, Settings and About. |
| About / Updates | Updates first, installed version and status, progress and install action, then a short creator note, links, feedback form and privacy. Download/install remain owned by WorkManager and Android's installer. |
| Luvs / DJ / Blend / utility screens | Shared semantic palette, type and control library. Preserve their existing feature-specific interactions and playback ownership. Utilities use the shared static cover glow. |

Do not change playlist SQL or loading topology on visual assumptions. The loading suspects in the
handoff still require real measurements; this migration does not claim latency or frame-time gains.

---

## 7. Motion

Primitives: `RiseIn`, `Tactile`, `TactileRow`, `SwapText`, `MorphIcon`,
`NudgeIcon` (`allegra/motion.tsx`), and the release physics in
`allegra/physics.ts`. All re-exported from `src/ui`. Reuse them.

| Token | Use |
| --- | --- |
| `Motion.spring.tactile` | Press feedback (inside `Tactile`) |
| `Motion.spring.open` | A tap opens or closes something (critically damped, 400) |
| `Motion.spring.fling` | A release faster than `Motion.flingVelocity` (800 pt/s) |
| `Motion.spring.settle` | A drag that didn't commit, coming back |
| `Motion.duration.fast 160 · base 240 · slow 400 · morph 460` | Timed state changes |
| `Motion.ease.decelerate` · `morph` | Arrivals · one surface becoming another |

- Springs for anything a finger can interrupt; 160–460 ms timings for state.
  Every number comes from a token, never typed into a screen.
- **Springs never wobble.** Every shared spring has a damping ratio of at least
  0.6 (`physics.test.ts`). Overshoot is kept for one event: the heart when liked.
- **A release keeps the finger's speed.** Exits and settles take
  `releaseSpring(velocity / distance, fingerVelocity)`, never a fixed ease-in
  that restarts from zero.
- **Edges stretch.** With nothing to go to (no next song, the end of a deck),
  follow the finger through `rubberBand(overshoot, 120)`, not 1:1.
- **No `exiting` child inside a `layout={…}` parent.** That crashed
  Reanimated 4.1 on Android. Keep the child mounted, fade it with a shared
  value, and unmount it when the fade ends.
- 40 ms list staggers, capped at 6 items.
- **Transform and opacity only.** No animated `height`, `width`, `top`,
  `backgroundColor` or `borderRadius`. Equaliser bars use `scaleY` from the
  baseline; progress bars use `scaleX` from the left; a header "turns solid" by
  fading a scrim, not by animating its colour.
- At most two self-running effects per screen (e.g. the shader + a canvas).
- Reduce Motion collapses movement to fades; it never removes a feature.
  Loops stop, except `Placeholder`'s breath, which means "loading".

### 7a. Touch and haptics

Every tappable thing presses through `Tactile` or `TactileRow`, usually via a
library component. It sinks and lights for at least 70 ms, so even the
quickest tap is seen. A bare `Pressable` in a screen is a bug; the only
exception is a sheet's backdrop.

**Long press means "actions" everywhere.** On any song, playlist or artist it
opens that item's actions sheet, with Play next first. It never acts silently.

Haptics go through `Haptics` (`utils/haptics.ts`, which respects the Settings
switch). Name the moment, not the motor:

| Call | When |
| --- | --- |
| `Haptics.tap()` | A selection changed: chip, choice, tab, sheet option, a sheet swiped shut |
| `Haptics.toggle()` | Like, switch, a long press opening a sheet, a drag picking something up |
| `Haptics.commit()` | Play/pause anywhere, a skip by gesture, confirming a destructive action |
| `Haptics.success()` | Something finished: download, lyrics saved, songs added |
| `Haptics.refuse()` | It can't: nothing to skip to, a disabled action tried |

`haptic="select" | "light"` on `Tactile`, `TactileRow` and the buttons maps
to `tap` and `toggle`.

### Old-phone budget

- One gesture per component, worklets on the UI thread, cross to JS only when a
  discrete value changes (the lyric line).
- `DynamicAura` gets `active={isFocused}` so hidden screens stop their shader.
- Lists over ~30 rows use FlashList.
- Blur thumbnails, not full covers.
- Rows respond on the first tap — no multi-tap timers in front of the common case.

---

## 8. Home-screen widgets (Android)

Built with `react-native-android-widget`; glyphs are inline SVG (`widget/icons.ts`).

**Now playing** (3×3, resizable): a soft frame around the cover full-bleed; a
glass pill with the song, share and like circles; elapsed / remaining; a white
progress bar; round dark-glass transport buttons. Below ~190 dp it drops text.

**Playlist** (4×3, resizable): cover, name, count, a `wave` play button and ›
to cycle playlists; a scrollable list where the playing row wears `wave`.

The app writes a snapshot (`widget/widgetData.ts`) on song, play-state, like and
playlist changes, plus a 20 s tick while playing. Transport acts on the live
player; rows, "play playlist" and share are `lyricflow://widget/…` deep links so
they work from a cold start. RemoteViews can't blur: "frosted" there means a
dark translucent fill.

---

## 9. Copy

- Sentence case everywhere ("Now playing", "Up next"). Never all caps.
- Buttons say what they do: "Delete playlist", "Save to library". Never "OK" or "Submit".
- No period at the end of a single line (labels, buttons, one-line empty states).
  Paragraphs keep their periods.
- No exclamation marks, emoji, sparkles, "magic", "seamless" or "unlock".
- Errors say what happened and what to do, in plain words. Never show a raw
  `error.message` to the listener: log it with `diag`.
- Use "Unknown artist", curly apostrophes (’), and `countOf(n, 'song')`,
  never "song(s)".

---

## 10. Checklist for a new screen

1. Dark room: `Signal.bg`, `DynamicAura` (with `active={isFocused}`) or a
   cheap-blur backdrop — not flat black.
2. `PageHeader` title on the gutter (`GUTTER`); `IconButton`s for actions.
3. Shelves with `SectionHeading`; rows with `ListRow`; menus and pickers in a
   `Sheet`; questions in a `ConfirmSheet`.
4. Bottom padding from `useBottomClearance()`.
5. Play/pause through `requestPlayback`; open the player with `openPlayerSheet`.
6. Loading (`RowPlaceholder`), empty (`EmptyState`) and offline states
   designed, never blank glass.
7. Every tap through a library component, `Tactile` or `TactileRow`. Long press
   opens the item's actions.
8. Transform/opacity motion from the tokens and primitives, with a Reduce
   Motion fade; check on a low-end phone.

## 11. Guards

`src/designGuards.test.ts` reads the source and fails on:
- a bare `Pressable` or `TouchableOpacity` outside `src/ui/` and `components/allegra/`
- `animationType="slide"`
- a `layout=` parent with an `exiting=` child in the same file
- a `fontWeight` other than 400/600/700
- `letterSpacing`

Most of them carry an allowlist of files not moved yet. A list only shrinks:
when you move a file onto the library, take it off its list.
