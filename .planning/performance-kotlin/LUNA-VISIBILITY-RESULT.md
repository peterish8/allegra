# Luna visibility slice result

Date: 2026-10-04. Scope: UI-1 app foreground and Now Playing visibility controls.

## Changes

- Added `useAppActive(): boolean`, backed by one shared `AppState` subscription. The source seeds itself from `AppState.currentState`, reconciles after attaching, notifies only when active/inactive status changes, and detaches when its last subscriber leaves.
- Extended `resolveVisualBudget` with optional `appActive` input. Existing callers default to active; backgrounding only changes `running`, preserving the selected frame cap and render scale. `useVisualBudget()` supplies the shared AppState value to all its visuals.
- `NowPlayingBackground` combines route focus and app activity for Aura, Glow and decorative canvas playback. Canvas artwork stays mounted through focus/background transitions so its last frame and fade state survive; its video player receives `playing=false` until both route and app are active.
- The delayed Glow premount is scheduled only while the blend route is focused and the app is active. Lyrics can still request immediate construction, and an already-mounted Glow stays mounted for its cross-fade.

## Focused verification

- `jest --runInBand src/hooks/useAppActive.test.ts src/utils/visualBudget.test.ts`: 2 suites, 9 tests passed. Coverage includes startup as active/background/unknown, active/inactive/background transitions, sharing one native listener, cleanup, resubscription reconciliation, and budget rest/resume across tiers and playback states.
- D2 harness adjustment: Jest's configured `react-native` mapper loads an ESM setup file that `ts-jest` cannot parse when imported by a unit test. The AppState source was separated into `utils/appActivity.ts` with a type-only React Native import; its injected port can be tested without changing global Jest config or adding a renderer dependency.
- The parent orchestrator is running ESLint and mobile typecheck across the integrated mobile changes; I did not duplicate those checks. No device was connected, so visual fade/frame behavior and physical-device performance remain unverified.

## Graft

Built the structural graph because this checkout had no committed Graft graph, then checked budget callers, the Now Playing parent and CanvasVideoLayer. The graph was structurally in sync after the build; semantic summaries were unavailable without a Graft API key. Graft reported approximately 73,522 tokens saved across the indexed queries this turn.
