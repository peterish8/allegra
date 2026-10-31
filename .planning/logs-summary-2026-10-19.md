# Stray log summary, 2026-10-19

- 22 gitignored `.lyrics-*.log` files at the repo root were read: 20 passed, 2 captured a failing test run (both from the lyric-alignment work on 2026-10-17).
- Both failures were fixed in later runs and pass on current code (re-run today: `lyricAlign.test.ts`, 5 of 5 pass). Nothing from these logs is still live.
- Worth a look but not a failure: the mobile lint step reports 76 to 79 warnings (0 errors), mostly `no-void`, plus a few `no-shadow`, `no-bitwise` and one unused import.

## What each log captured

All commands run from the repo root unless noted. "Typecheck" is `npm run typecheck --workspaces` (api, web, connect). "Lint" is `npm run lint --workspaces` (api, web). "Test" is `npm test --workspaces`, then `infra:test`, then `convex:test`.

| File | What it ran | Result | Key error |
| --- | --- | --- | --- |
| `.lyrics-align-final-typecheck.log` | typecheck, all workspaces | Passed | none |
| `.lyrics-align-final-webtest.log` | web tests, `src/lib/*.test.ts` | Failed, 263 of 264 | `apps\web\src\lib\lyricAlign.test.ts:47:12` "Guest timing survives another visit, with word timing retained and corrupt storage rejected": `AssertionError [ERR_ASSERTION]: Expected values to be strictly equal` (actual was a payload with a `timestamp: -1` line, expected `null`) |
| `.lyrics-align-focused.log` | focused web run, alignment tests | Failed, 3 of 4 | `apps\web\src\lib\lyricAlign.test.ts:15:10` "Alignment follows acoustic characters and leaves instrumental gaps between lines": `AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal` (actual ends `6` and `11`, expected `7` and `12`) |
| `.lyrics-align-focused2.log` | focused web run, alignment plus sharing tests | Passed, 6 of 6 | none |
| `.lyrics-align-lint.log` | web lint only | Passed | none |
| `.lyrics-align-root-lint.log` | lint, api and web | Passed | none |
| `.lyrics-align-root-test.log` | full test run | Passed: api 375, web 263, connect 91, shared 219, infra, convex (vitest 8 files, 86 tests) | none |
| `.lyrics-align-root-typecheck.log` | typecheck, all workspaces | Passed | none |
| `.lyrics-align-typecheck.log` | web typecheck only | Passed | none |
| `.lyrics-align-typecheck2.log` | web typecheck only | Passed | none |
| `.lyrics-build-output.log` | `npm run build` (api `tsc`, web `next build`, Next.js 16.3.5 Turbopack) | Passed, 2 routes generated | none |
| `.lyrics-convex-output.log` | `convex dev --once` against the dev deployment | Passed, "Convex functions ready" | Notices only: Convex 1.46.0 to 1.47.0 update available, AI files out of date |
| `.lyrics-lint-output.log` | lint, api and web | Passed | none |
| `.lyrics-mobile-output.log` | `npm run mobile:check` (secrets, lint, typecheck, jest) | Passed: 94 suites, 786 tests | 0 lint errors, 77 warnings (for example `fileImportStore.ts:94:7` "Expected 'undefined' and instead saw 'void'" `no-void`) |
| `.lyrics-resume-lint.log` | lint, api and web | Passed | none |
| `.lyrics-resume-mobile.log` | `npm run mobile:check` | Passed: 94 suites, 790 tests | 0 lint errors, 79 warnings (`no-void`, `no-shadow` at 41:22, `no-bitwise` at 20:49, unused `useOnlineLibraryStore` at 18:10) |
| `.lyrics-resume-mobile-focused.log` | jest on `src/services/LyricaService.test.ts` | Passed, 11 of 11 | none |
| `.lyrics-resume-test.log` | full test run | Passed: api 375, web 259, connect 91, shared 219, infra 20, convex 86 | none |
| `.lyrics-resume-typecheck.log` | typecheck, all workspaces | Passed | none |
| `.lyrics-resume-web.log` | web tests, `src/lib/*.test.ts` | Passed, 259 of 259 | none |
| `.lyrics-test-output.log` | full test run (earliest) | Passed: api 350, web 255, connect 91, shared 212, convex 86 | none |
| `.lyrics-typecheck-output.log` | typecheck, all workspaces | Passed | none |

## Still relevant?

No. Both failures came from the lyric-alignment feature (commit `e46ad62`, "align and share lyric timings") while it was being built, and both are gone.

- `lyricAlign.test.ts:15` (word end times 6 and 11 instead of 7 and 12): `.lyrics-align-focused2.log` and every later web run show this test passing. I re-ran `node --import tsx --test src/lib/lyricAlign.test.ts` on the current checkout today: 5 tests, 5 pass.
- `lyricAlign.test.ts:47` (negative timestamp accepted from storage): `apps/web/src/lib/lyricAlign/localTiming.ts:19` now rejects any line with `line.timestamp < 0`, so `readLocalTiming` returns `null` for the corrupt payload as the test expects. The later full web run (`.lyrics-resume-web.log`, 259 of 259) confirms it.
- The test file and `localTiming.ts` have no uncommitted changes, so the passing state is the committed state.

Things that are not failures but may deserve a ticket:

- Mobile lint warnings (76, 77 and 79 across three runs, so the count crept up with new code). Mostly `no-void` on fire-and-forget calls. The repo does not fail CI on warnings today.
- `useOnlineLibraryStore` is imported but unused (`@typescript-eslint/no-unused-vars`, seen at 18:10 in `.lyrics-resume-mobile.log`).

## Left alone

- `apps/web/.next/dev/logs/next-development.log` and anything under `.next/`: the Next dev server rewrites it and may be running.
- `apps/mobile/android/app/build/**` logs: build output, a Gradle clean handles it.
- `output/playwright/connect-login-profile/**` (`000003.log` and similar): Chromium LevelDB database files, not logs. Deleting them would corrupt the saved browser login profile.
- `.claude/worktrees/**`: other sessions' checkouts. Read only. `player-control-hover-f7d0f4/output-lyrics-*.log` were read for this summary and are unchanged:
  - `output-lyrics-lint.log` and `output-lyrics-typecheck.log`: passed.
  - `output-lyrics-tests.log`: passed (api 340, web 263, connect 91).
  - `output-lyrics-mobile.log`: passed (94 suites, 783 tests, 0 lint errors, 76 warnings).
- Every other file. The main checkout has uncommitted work on `fix/dynamic-island-audit`; nothing was staged, stashed or committed.

## Deleted

All 22 were confirmed ignored with `git check-ignore -v` and none are tracked. None were skipped.

- `.lyrics-align-final-typecheck.log`
- `.lyrics-align-final-webtest.log`
- `.lyrics-align-focused.log`
- `.lyrics-align-focused2.log`
- `.lyrics-align-lint.log`
- `.lyrics-align-root-lint.log`
- `.lyrics-align-root-test.log`
- `.lyrics-align-root-typecheck.log`
- `.lyrics-align-typecheck.log`
- `.lyrics-align-typecheck2.log`
- `.lyrics-build-output.log`
- `.lyrics-convex-output.log`
- `.lyrics-lint-output.log`
- `.lyrics-mobile-output.log`
- `.lyrics-resume-lint.log`
- `.lyrics-resume-mobile.log`
- `.lyrics-resume-mobile-focused.log`
- `.lyrics-resume-test.log`
- `.lyrics-resume-typecheck.log`
- `.lyrics-resume-web.log`
- `.lyrics-test-output.log`
- `.lyrics-typecheck-output.log`
