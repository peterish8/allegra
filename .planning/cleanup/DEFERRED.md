# Deferred cleanup

Items a session's cleanup pass saw and chose not to change, with the reason. Remove an entry when it is done.

## 2026-11-22 — "Saved in" sheet and sheet physics (mobile 1.72.0)

- **Device feel is unverified.** Sheet drag, rubber band, thrown settle and the short/full rests were checked by unit
  tests (`ui/sheetPhysics.test.ts`) and the source guards only. Record a physical-phone pass (flick speeds, list
  hand-off at full height, keyboard with the Find playlist field) in
  `.planning/mobile-ui-review/IMPLEMENTATION-STATUS.md` before calling it shipped.
- **Centered dialogs left as they are.** `LibraryEditModal`, `ModernDeleteModal` and `AccountConsentSheet` are fading
  dialogs, not sheets; moving them to `Sheet`/`ConfirmSheet` is a design decision, not a cleanup.
- **`MiniSongMenu` / `NowPlayingScreen` `void` warnings** are older than this change (repo-wide `no-void` warnings);
  not touched to keep the diff to this task.
- **Keyboard over expandable sheets (review finding 5, unverified).** `keyboard` lifts only the footer of an
  `expandable` Sheet; the card itself is not shortened. The lyrics editor in `LrcSearchModal` may have its caret and
  "Use these lyrics" under the keyboard. The reviewer's fix animates `paddingBottom` (a layout property the motion
  rules ban), so it waits for a phone check and a transform-only design (e.g. a lift clamped to keep the top band
  on screen).
- **Sheet gestures are rebuilt each render (review nit).** `headPan` / `bodyPan` are new objects on every `Sheet`
  render; Gesture Handler re-attaches them without visible cost. Memoise on `[bodyTwoWay, expandable, reduce]` if a
  profile ever shows it.
- **Profile menu close on a tap still uses the timed accelerate curve** (only a swipe is thrown). It is not a gesture
  release, so there is no speed to carry; left as designed in 1.44.0.
