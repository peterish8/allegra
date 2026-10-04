# Luna UI visibility slice verification

Date: 2026-10-04. Branch: `feat/native-queue-engine`. Evidence describes the local working tree, including the existing lyrics geometry correction.

## Delivery

Three coding workers used `gpt-6-luna` with `xhigh` reasoning. Their prompts, ownership and debug queue are in `LUNA-EXECUTION.md`. The coordinator read the actual diffs, sent callback typing and test/abstraction corrections back to the owning Luna workers, and inspected their repairs.

- Shared `useAppActive` uses `useSyncExternalStore` over one AppState listener, initialized from the current state, reconciled after subscribing, and removed after the last listener detaches. The injectable source lives in `utils/appActivity.ts`.
- Existing ambient budgets rest while the app is inactive/backgrounded without changing the selected density/cap.
- Now Playing glow/aura, decorative video playback and lyric live activity require app activity and route focus. Glow and lyric premount delays defer while hidden. Mounted lyric state and canvas artwork are retained across temporary visibility loss.
- Glow, shader and HUD frame callbacks are stable typed worklets. Both HUD samplers rest while the app is inactive; sampling restarts with a fresh time baseline.
- No playback command, native queue, service, provider, database, shared API or dependency change was made. Existing local/Connect lyrics geometry edits were preserved.

## Checks

| Check | Result | Evidence |
|---|---|---|
| Root `npm.cmd run typecheck` | Exit 0 | `output/luna-optimization-20261004/root-typecheck.log` |
| Root `npm.cmd run lint` | Exit 0 | `output/luna-optimization-20261004/root-lint.log` |
| Root `npm.cmd test` | Exit 0 | `output/luna-optimization-20261004/root-tests.log` |
| Mobile `tsc.cmd --noEmit`, final integrated source | Exit 0 | `output/luna-optimization-20261004/mobile-typecheck.log` |
| Mobile `eslint.cmd .`, final integrated source | Exit 0; two existing warnings | `output/luna-optimization-20261004/mobile-lint.log` |
| Mobile `jest.cmd --runInBand`, full suite | 86 suites / 726 tests passed; exit 0 | `output/luna-optimization-20261004/mobile-tests.log` |
| Focused lifecycle/budget tests | 2 suites / 9 tests passed | Worker A result report |
| Focused lyric/worklet checks | 4 suites / 26 tests passed | Worker C result report |
| `git diff --check` | Exit 0 | Coordinator check; informational LF/CRLF warnings |

Existing lint warnings: shadowed `i` in the generated Android test report, and unused `esc` in `src/database/scanQueueQueries.test.ts`.

## Acceptance limits

The new tests exercise the real injected AppState source and budget transitions. Existing worklet safety checks examine source worklet boundaries. They do not mount the native shader/video/lyrics/HUD views or measure a live render-thread counter.

`adb devices` showed no attached device. No native visual journey, release-device trace, physical-phone responsiveness, battery/CPU comparison or measured speedup was produced. The earlier lyrics geometry attempt remains visually unverified as recorded in `VERIFICATION.md`; this visibility slice does not change that status. Native playback was left outside this diff, but its background/notification behavior was not re-exercised on a device.

UI-1 source implementation and local checks are delivered. Device acceptance and Phase 1 baseline remain open. Stream virtualization, request cancellation/caching, Kotlin snapshot IO and native lyrics/YouTube layouts remain their separate planned slices. No APK release, commit, push, deployment or memory update was made.
