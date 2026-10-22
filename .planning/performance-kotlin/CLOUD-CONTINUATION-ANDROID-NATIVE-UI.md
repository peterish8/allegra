# Allegra Android UI migration — cloud continuation handoff

## Checkout and checkpoint

- Repository: `https://github.com/peterish8/allegra` (`origin`). Continue on `perf/mobile-player-responsiveness` only.
- This Windows checkout was `C:\dev\allegra`; the feature branch was synchronized with `origin` at `1a2898c` before the checkpoint edits.
- Latest checkpoint commit: `10c024c fix(mobile): align native queue reorder gesture`.
- A docs commit will contain this file and the updated worktree note in `HANDOFF-ANDROID-NATIVE-UI.md`.
- The local `npm ci` in `apps/mobile` was interrupted at the user's request while retrying corrupt-tarball downloads. It may have left partial ignored `node_modules`; in the cloud, inspect the environment and install dependencies there as needed.
- No tests, Gradle build, APK build, emulator run, or device check were performed for `10c024c`. `git diff --check` passed before committing.

## What changed at the checkpoint

`QueueMath.beginsReorderDrag(dxPx, dyPx, density)` now activates the native queue handle drag at a 1 dp Euclidean movement threshold in any direction, matching React Native Gesture Handler's `Gesture.Pan().minDistance(1)` behavior. `NativeQueueListView` previously checked only vertical movement and compared against 1 physical pixel; the X displacement was recorded but unused. A JVM test covers horizontal and vertical movement at densities 1 and 3. `apps/mobile/app.json` is now version `1.29.1` for this Android fix.

The earlier queue parity review is recorded in `HANDOFF-ANDROID-NATIVE-UI.md`. The queue slice remains **not device-verified**. The 1 dp adjustment itself also needs to be exercised on an Android device.

## Resume in this order

1. Check `git status --short --branch`, `git log -3 --oneline`, and `git remote -v`; fetch `origin` and confirm the feature branch contains both checkpoint commits. Do not discard any cloud-session changes.
2. Read `CLAUDE.md`, `apps/mobile/CLAUDE.md`, and `HANDOFF-ANDROID-NATIVE-UI.md`. This file is the current machine/session handoff; use the actual current checkout path rather than assuming the old cloud or Windows worktree path.
3. Complete the **Slice 7 queue device check first** using the checklist under “Needs a device check” in `HANDOFF-ANDROID-NATIVE-UI.md`. Include a short-drag check around the 1 dp handle threshold in both horizontal and vertical directions, plus reordering, scroll/panel gesture arbitration, TalkBack, covers, and safe areas. Mark only the checks actually observed. If cloud has no Android device/emulator, leave the list explicitly unverified and hand back the device steps.
4. Run the required checks for the current queue fix and branch: mobile TypeScript, lint, Jest, and Android `:app:testDebugUnitTest` (the cloud recipe and environment notes are in the main handoff). Report exact results; do not treat an interrupted process or compile-only result as a passing full gate.
5. After Slice 7 is checked and the current patch is verified, continue one vertical slice at a time in the order and constraints from the main handoff. Each APK-reaching change needs an `expo.version` bump, focused automated checks, a conventional commit without AI/co-author footers, and a specific “Needs a device check” list if physical UI proof is unavailable.
6. Push only to `origin/perf/mobile-player-responsiveness` when the work is ready. Do not open a PR, merge, or push to `main` unless the user explicitly asks.

## Starter prompt

Paste this into the cloud session:

> Continue the Allegra Android native UI migration on `peterish8/allegra`, branch `perf/mobile-player-responsiveness`, from the latest remote state. First inspect `git status`, branch, recent commits, and `origin`; preserve existing work. Read `CLAUDE.md`, `apps/mobile/CLAUDE.md`, `.planning/performance-kotlin/HANDOFF-ANDROID-NATIVE-UI.md`, and `.planning/performance-kotlin/CLOUD-CONTINUATION-ANDROID-NATIVE-UI.md`. The latest checkpoint is `10c024c`, which aligns the native queue handle's 1 dp drag threshold with Gesture Handler and bumps the app to 1.29.1. Its tests/build/device behavior are unverified. Finish the Slice 7 queue device check first if an Android device/emulator is available, including the new horizontal/vertical short-drag threshold; otherwise record that proof as unavailable. Run the mobile TS/lint/Jest gates and Android `:app:testDebugUnitTest`, report exact outcomes, then continue the remaining native UI migration one vertical slice at a time as the main handoff specifies. Commit with conventional messages and no AI footer. Push only to `origin/perf/mobile-player-responsiveness`; do not open a PR, merge, or push to `main` without my instruction.
