# Luna execution and debug handoff

Date: 2026-10-04. User authorization: implement the reviewed plan using GPT-6 Luna workers at extra-high reasoning; the coordinating agent reviews the diff and returns concrete debug work to the same workers.

## Current slice

Implement `UI-PERFORMANCE-PLAN.md` UI-1: hidden ambient surfaces rest, foreground return resumes correctly, and frame callbacks remain stable across unrelated renders. This is one reviewable change. Keep the existing lyrics geometry correction and unrelated workspace files. Larger renderer, queue, database and YouTube changes remain separate phases with their stated prerequisites.

No release-device baseline has been collected. This slice addresses source-confirmed lifecycle and callback issues; it does not establish the cause of all lag or a measured speedup.

## Worker A: visibility

Model: `gpt-6-luna`, reasoning: `xhigh`.

Owned files: `apps/mobile/src/hooks/useVisualBudget.ts`, `apps/mobile/src/utils/visualBudget.ts`, their focused tests, `apps/mobile/src/components/NowPlayingBackground.tsx`, and a shared `apps/mobile/src/hooks/useAppActive.ts` if required.

Prompt: Read the master/UI plans, root instructions and scoped mobile instructions. Inspect current code with graft and trace callers before edits. Extend the existing ambient budget with app visibility rather than creating a second budget system. Initialize visibility from current AppState, subscribe with cleanup, and rest while inactive/backgrounded. Require route focus for the player's glow/aura and prevent decorative video playback while hidden. Avoid delayed glow construction while hidden. Preserve the last visual frame, current palette, crossfades, reduced motion, and the existing design. Native Media3 audio must continue independently of UI visibility. Prove inactive/background/foreground transitions with focused behavior tests. Do not change playback authority, API contracts, YouTube providers, dependencies, or the existing lyrics fix. Coordinate a shared app-active hook with Worker B. You are not alone in the workspace: preserve and accommodate others' edits. Report exact changes, checks, limitations, and graft tally; do not commit or push.

## Worker B: frame callbacks and diagnostic lifecycle

Model: `gpt-6-luna`, reasoning: `xhigh`.

Owned files: `apps/mobile/src/components/player/GlowBackground.tsx`, `apps/mobile/src/components/allegra/MusicFlowField.tsx`, `apps/mobile/src/components/PerformanceHUD.tsx`, and directly relevant focused tests.

Prompt: Read the master/UI plans and applicable instructions, then inspect callbacks and callers with graft. Replace inline `useFrameCallback` functions with stable `useCallback` worklets using complete dependencies. Preserve phase, palette interpolation and frame-delta semantics. Never access React refs or JS-only APIs from a worklet. Consume Worker A's shared app-active hook for the HUD; stop both the UI callback and JS rAF while hidden or disabled. Reset timing on resume so background time cannot produce a phase jump or invalid FPS interval. Retain the existing budget and visual design. Do not edit Worker A's files, lyrics, playback/services, other screens, dependencies, or API contracts. You are not alone in the workspace: preserve others' changes. Run focused checks and report callback dependencies, limitations, and graft tally; do not commit or push.

## Worker C: lyrics activity

Model: `gpt-6-luna`, reasoning: `xhigh`.

Owned product file: `apps/mobile/src/components/NowPlayingLyricsArea.tsx`. Preserve the existing `SynchronizedLyrics.tsx` and `lyricLayout` geometry changes.

Prompt: Trace the shared local/Connect lyrics subtree. Require route focus and app-active state as well as `showLyrics` for the existing `live` input, so the mounted lyric clock, follow, word and waveform work rest when the screen is hidden. Reuse Worker A's app-active hook. Keep one clock/scroll authority, premount behavior, provider controls, and the existing layout/design. No playback authority, dependency, API, or geometry changes. Run relevant lyric/worklet checks and return precise evidence and limitations. You are not alone in the workspace: preserve other writers' edits. Return debug corrections to this worker if its diff has defects.

## Coordinator review and debug protocol

1. Read both workers' actual diffs and tests, not only their reports. Check focus/AppState wiring, cleanup, first-frame readiness, crossfade ownership, callback dependencies, stale captures and foreground timing.
2. For each defect, send its owning Luna worker an exact file/function, reproduction or failing assertion, expected behavior, minimal remedy, and required regression check. Keep a written debug entry below. The coordinator does not silently implement product fixes itself.
3. Let the owning worker implement the debug correction, review that diff, and re-run the affected checks.
4. Run root typecheck/lint/tests and separate mobile typecheck/lint/tests including worklet safety. Record exact outcomes and any pre-existing warnings.
5. Attempt current-source native visibility/lifecycle checks when a usable device/fixture is available. A debug emulator launch, mocked hook test, or continued audio is not release-phone visual or performance acceptance.
6. Show the final slice diff and remaining verification limits. Do not commit, push, publish, or claim the full master plan is implemented.

## Debug queue

**D1 — callback parameter typing (Worker B corrected).** In the first diff, moving the inline callbacks into standalone `useCallback` calls removed contextual parameter typing. `tickUi(frame)` and the two shader/glow `tick(info)` parameters need the installed Reanimated package's exported `FrameInfo` type to satisfy strict TypeScript. Worker B typed all three parameters. Coordinator inspected the diff and the first integrated mobile typecheck passed; final checks follow the remaining worker edits.

**D2 — lifecycle test environment (Worker A corrected).** The new source test reached React Native's mapped ESM Jest setup and failed before execution. Worker B reproduced and reported it. Worker A isolated the injectable source in `utils/appActivity.ts` with type-only React Native imports; the small React hook remains in `hooks/useAppActive.ts`. This preserves global Jest configuration and tests the actual source without a synthetic renderer. Coordinator reviewed the extraction; the focused cases and full mobile suite pass.

**D3 — unnecessary premount abstraction (Worker A corrected).** Worker A removed the extra glow-specific boolean helper and its implementation-mirroring test. The visibility guard stays at its owning component, while the meaningful shared-source subscription and budget transition regressions remain. Coordinator verified the final diff.

## Results

All three Luna workers completed their assigned source changes. Coordinator inspected the product diff and the corrections above. Root typecheck/lint/tests pass. Final mobile typecheck/lint pass; full mobile Jest passes 86 suites / 726 tests. Mobile lint retains two existing warnings. Detailed evidence and acceptance limits: `LUNA-VERIFICATION.md`.

Worker reports: `LUNA-VISIBILITY-RESULT.md`, `LUNA-CALLBACKS-RESULT.md`, and `LUNA-LYRICS-ACTIVITY-RESULT.md`. No device visual/performance acceptance, APK release, commit or push was performed.
