# Verification and delivery boundary

Date: 2026-10-04.

## Delivered artifacts

- `MASTER-PLAN.md`: consolidated recommendation, ranked wins, language boundaries, all three requested layouts, source decision and implementation phases.
- `UI-PERFORMANCE-PLAN.md`: rendering, screen/list, graphics/image and interaction slices.
- `NATIVE-PLAYBACK-PLAN.md`: verified PixelPlayer/Echo references, existing native engine, persistence, clock/events, background radio/cache/preload and native-view contract.
- `BACKEND-YOUTUBE-PLAN.md`: provider/data/download findings, proposed contract amendments, official/extractor alternatives, timing/capability and layout rules.

All four are plans. Wider Kotlin migration, backend/cache changes, YouTube integration and new layouts were not implemented in this request.

## Lyrics correction

Current changed product paths:

- `apps/mobile/src/components/SynchronizedLyrics.tsx`
- `apps/mobile/src/playback/lyricLayout.ts`
- `apps/mobile/src/playback/lyricLayout.test.ts`

The native-row measurement/footer correction appeared from concurrent work after this investigation began; the assigned correction agent preserved it. Our additions wait for measured viewport/content, clamp follow/imperative scroll to the content extent, retry after extent/viewport changes, and use the latest callback when batched row measurements finish. The public player command/queue contracts and existing design are unchanged.

Behavior covered by regression cases: long mixed-height/wrapped rows, fractional heights, spacer/header origin, unchanged boxes across song changes, final-line footer reach, initial clamping while layout arrives, and recomputing the target after viewport/content resize. Existing clock/motion/worklet checks also pass. These tests do not establish physical-device appearance or a measured improvement in app-wide performance.

## Local checks

| Check | Result | Scope |
|---|---|---|
| Root `npm.cmd run typecheck` | Exit 0 | Root workspaces; mobile is separate |
| Root `npm.cmd run lint` | Exit 0 | Root workspaces |
| Root `npm.cmd test` | Exit 0 | Workspace, infrastructure/release-note and Convex tests |
| Mobile local `tsc --noEmit` | Exit 0 | Full mobile TypeScript |
| Mobile `eslint .` | Exit 0 | Two existing warnings: generated Android report shadowed `i`, unused `esc` in `scanQueueQueries.test.ts` |
| Mobile `jest --runInBand` | 85 suites / 722 tests passed | Full mobile suite; reported runtime 177.252 seconds |
| Focused lyric/layout/motion/clock/worklet suites | 4 suites / 26 tests passed | Included in wider verification |
| `git diff --check` | Exit 0 | Git emits existing LF-to-CRLF normalization warning, no whitespace failure |
| Plan-local Markdown links | No missing links | All area documents resolve |

Root command logs: `output/performance-kotlin-2026-10-04/root-typecheck.log`, `root-lint.log`, `root-tests.log`. Preserve other existing `output/` files.

## Native visual and performance evidence

An existing Pixel_9_Pro x86_64 AVD was booted and the compatible existing Android debug client installed. Metro loaded the current JS bundle (2,828 modules) and reached Stream initialization; this is not a new release APK. The bounded controlled-fixture attempts through the Hermes inspector and catalog searches timed out. Native lyric-position visual acceptance remains unverified. The agent stopped the Metro and emulator processes it started; no temporary fixture product-code edits were made. Attempt evidence: `output/lyrics-scroll-20261004/RESULT.md` and `native-startup.png`; the startup image is not proof of lyric geometry.

No physical phone was connected. No release-mode Macrobenchmark/Perfetto performance baseline, production provider timing, or real YouTube playback was collected. Android emulator functional startup and passing arithmetic tests must not be presented as physical-phone optimization acceptance.

## Remaining acceptance

On a physical phone or a working deterministic native fixture, verify the active line remains above the center of the measured lyrics viewport across middle/final wrapped lines, seek, manual-scroll resume, provider/text-size/transliteration changes, reopening, and Connect remote playback. The performance phases require controlled before/after release traces across all screens. Future video work requires a source/capability decision before any contract or playback-source change.

No commits, pushes, releases, deployment, new service provisioning, or memory updates were performed. Unrelated `.mcp.json`, branding images and existing output were preserved.
