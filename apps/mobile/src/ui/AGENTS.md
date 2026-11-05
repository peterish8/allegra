# Mobile UI maintenance

- Build screens from the shared primitives exported by `src/ui/index.ts`. If a screen needs a missing pattern, add it to the UI library and its barrel instead of creating a one-off control.
- Treat `src/constants/allegraTheme.ts` as the source of truth. The V6 accent is white; use semantic color, spacing, radius, type, and motion tokens. Keep screen files free of raw colors, font sizes, and animation durations.
- Use the existing 8 / 12 / 16 dp corner family and 48 dp minimum touch targets. Prefer semantic `Text` roles and tones over local font styling; keep layouts readable with large system text.
- Use `Button` variants `primary`, `secondary`, `plain`, and `danger`. `glass` is a compatibility alias for the opaque secondary control; do not introduce new glass buttons.
- Use `Sheet` for bottom sheets and select `deep`, `raised`, or `player` surfaces to match context. Player glass is reserved for player surfaces. Keep live scrolling lists free of blur; use opaque surfaces there.
- UI primitives render props and call supplied handlers. Do not put player state, data loading, persistence, or other I/O in primitives. Pass row actions through callbacks such as `onPress`, `onLongPress`, and `onToggle`.
- Route presses through `Tactile` / `TactileRow` via the shared primitives. Use their haptic options or the shared haptics utility for committed actions; do not hand-roll press feedback.
- Preserve accessible roles, names, selected / disabled state, and scalable text. Do not rely on color alone to communicate state or clip larger text in fixed-height content.
- Add or update meaningful behavior tests at the screen or component boundary, then run the root `npm run mobile:check` gate for validation.
- Kotlin compiles and its JVM tests pass; runtime visual parity and physical-device checks are still pending. Do not describe V6 as shipped without that evidence.
