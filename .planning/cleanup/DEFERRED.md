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
- **Profile menu close on a tap still uses the timed accelerate curve** (only a swipe is thrown). It is not a gesture
  release, so there is no speed to carry; left as designed in 1.44.0.
