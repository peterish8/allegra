# UI-1 callback and HUD lifecycle result

This work covers `GlowBackground`, `MusicFlowField`, and `PerformanceHUD` from UI-1. The frame callbacks are now stable `useCallback` worklets, and the HUD follows the shared `useAppActive()` state for both of its samplers.

## Callback captures

- `GlowBackground` depends on `minStep`, `pending`, and `progress`. The imported `CYCLE_S` remains a fixed module constant. The 16 ms fallback, 66 ms delta clamp, 20 second cycle, and palette interpolation are unchanged.
- `MusicFlowField` depends on `minStep`, `pending`, `clock`, `targetColors`, and `colors`. The callback still clamps each frame delta to 66 ms, caps accumulated `dt` at 66 ms, advances the same shader clock, and applies the same time-based palette easing.
- `PerformanceHUD` depends on `frames`, `since`, and the stable `setUiFps` setter. It does not capture the app-active state; that state only controls activation from React.
- All three callback parameters are explicitly typed with Reanimated's exported `FrameInfo`. D1: the first memoized version lost the inline callback's contextual type and produced implicit-`any` parameters; explicit annotations corrected it before checks.

## HUD lifecycle

`enabled` is `show && appActive`. When it becomes false, the UI callback is deactivated and its frame count/timestamp baseline are cleared. The JavaScript effect cancels its pending animation frame. On foreground return, the UI callback establishes a new timestamp on its first frame, and the JavaScript loop starts a new `Date.now()` baseline. This prevents the background interval from entering either FPS denominator.

The two ambient callbacks retain their existing clamped-delta behavior. A stopped callback cannot accumulate background wall time into shader phase; the next missing frame delta still uses the existing 16 ms fallback.

## Callers and checks

Graft returned no indexed incoming edges for these component symbols. A JSX search then found the actual consumers in `RootNavigator`, `GlowRoom`, `DynamicAura`, `AuraBackdrop`, `NowPlayingBackground`, and `PillPlayer`. Graft reported approximately **18,364 tokens saved** across the four calls.

- `npm.cmd run typecheck` from `apps/mobile`: passed.
- Focused ESLint for the three owned components: passed.
- `npm.cmd test -- --runInBand src/workletSafety.test.ts`: passed, 7 tests.
- `npm.cmd test -- --runInBand src/hooks/useAppActive.test.ts`: passed, 3 lifecycle tests. The first attempt exposed Jest's ESM React Native setup mapping; the visibility worker isolated the AppState source in a pure utility, after which the test ran cleanly.
- No HUD mount or callback-identity render test was added: this package has neither `react-test-renderer` nor React Native Testing Library, and no custom renderer was introduced for this small wiring change.

This is source-level verification. No device trace or before/after performance measurement was produced, so it does not establish a measured FPS or battery improvement.
