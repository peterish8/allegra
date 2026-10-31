# Performance work handoff

Updated: 2026-10-06 (Asia/Kolkata)  
Workspace: `C:\dev\allegra-perf`, branch `feat/search-to-play-trace`. Older sections below describe the shared `C:\dev\allegra` checkout.

## Current state — 2026-10-06 (supersedes everything below)

Branch `feat/search-to-play-trace` in worktree `C:\dev\allegra-perf`, built on PR #17. The
measurement code was moved here from the shared checkout as performance-only hunks.

- First valid web baseline recorded: 15 of 16 samples complete. See `WEB-RESULTS.md`.
- The trace-off clock read in `CommandPalette.tsx` is fixed: `performance.now()` runs only while
  an attempt is being traced.
- Harness fixes: bounded steps, onboarding dismissal, failure screenshot, suggest route.
- Checks: web typecheck/lint clean, shared trace tests 7/7, gateway test 1/1, mobile `tsc` clean.
- Android: no diagnostic APK or device baseline in this pass. The build runner sets
  `NODE_ENV=production`, but that has not been re-verified with a build.
- No behavior optimization. Next step: measure `/api/stream` time to first byte, then propose.

## Latest verified checkpoint — 2026-10-06

This section supersedes stale status statements below where they conflict. Two opted-in production builds passed before the latest helper/harness edits. One Chromium attempt was an invalid topology diagnostic: bare production Next served HTML (200) for same-origin `/api/search`; direct API returned JSON success with 20 results. First result: `pW-kkdqr`, “Blinding Lights”, The Weeknd. A second same-origin probe confirmed HTML, no JSON envelope, zero API results. `apps/web/src/lib/api.ts` rejects non-API JSON, matching the trace's `search-failure`. The recorded 221.7–244.7 ms interval is diagnostic only, not a product latency sample. Safe probe summaries and raw trace paths are in `WEB-RESULTS.md`.

Latest source checks: shared helper tests 7/7 passed after removing its unused configurable-cap option; the cap is fixed at 250. Gateway test passed, including HTTP 206/Range headers. Gateway and verifier JS syntax and PowerShell runner parse passed. These are unit/parser checks only; no production build or browser run used the latest source. Earlier web lint passed before this final cleanup; rerun it. The local gateway routes `/api/*` and the existing `.well-known` paths to API `:8082`, and other requests to production Next `:5174`, using browser origin `:5175`. It preserves response status/headers/body and cancellation. The runner refuses occupied isolated ports. A consumed, sanitized route preflight and production browser run remain pending until Android releases its build slot.

At this checkpoint, `git rev-parse HEAD` is still `0e0c271ac49eeec0eca9a102a7f04ff44d4989e7`. Preserve concurrent listeners: API dev PID 44720 on `:8080`, Next dev PID 37428 on `:5173`, and Expo PID 43728 on `:8081`; root identified them as unrelated/shared services. Android directly released its build slot after `assembleRelease` exited 1 at Expo config because `NODE_ENV` was missing; no APK/device was produced and no Android processes remain. Free RAM recovered to 7.83 GiB; isolated ports `:8082/:5174/:5175` were free. Web lint passed exit 0 and Playwright discovery listed one test. The current-source opted-in Next production build passed in runner session 26487, and the sanitized gateway check returned HTTP 200 JSON success with 20 results. Its one-sample Playwright journey is still active in that session. Preserve the shared listeners. No emulator, valid browser sample or root gate is active.

## Read this first

1. [HANDOFF.md](HANDOFF.md) — current state, ownership, commands, blockers, safe resumption.
2. [CHECKLIST.md](CHECKLIST.md) — status of every stage in the approved 12-section plan.
3. [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) — authoritative measurement scope and safeguards. Its initial "approval pending" wording predates the user's explicit approval of this measurement slice; optimization still needs later separate approval.
4. [WEB-RESULTS.md](WEB-RESULTS.md) and [ANDROID-RESULTS.md](ANDROID-RESULTS.md) — platform evidence. Android results are written by the Android worker; do not overwrite them.
5. [article-search-to-play-plan.html](article-search-to-play-plan.html) — original visual plan, linked to this handoff/checklist.

## Objective and approval boundary

The user approved **the measurement slice**: opt-in local instrumentation, focused tests, repeatable serial production-mode web search-to-play measurement, a separate Android measurement, and an evidence-based optimization proposal. The fixed cross-platform query is `Blinding Lights The Weeknd`; the local API diagnostic returned 20 results, with first result `pW-kkdqr` / “Blinding Lights” / “The Weeknd”. The browser route still needs live validation through the isolated gateway.

The user has **not** approved a behavior optimization. Measure first, then write a concrete `WEB-OPTIMIZATION-PLAN.md` and/or Android proposal naming the measured bottleneck, exact scope, expected benefit and verification. Stop before implementing that behavior change and request its separate approval. Production deployment, external paid work and release actions are outside scope. Do not claim a speedup, 3× improvement, 120 fps, production p95, or audible-start proof from these checks.

## Ownership and worktree identity

- Web/shared worker: shared helper and tests; web adapter/instrumentation; dedicated web Playwright harness and runner; `WEB-RESULTS.md`; this aggregate handoff/checklist and the HTML index link.
- Android worker: Android adapter/tests, SearchScreen and PlayerContext instrumentation, `ANDROID-RESULTS.md`, and mobile/device work. Preserve that ownership and coordinate root gates with that worker.
- Aggregate revision identity: HEAD remains `0e0c271ac49eeec0eca9a102a7f04ff44d4989e7`; no performance commit was created. The worktree is shared and currently has substantial unrelated/concurrent changes, so HEAD alone is not a complete source snapshot. Re-run `git status --short` before resuming and do not reset/stash/revert.
- Pre-existing edits reported at task start included `apps/mobile/CLAUDE.md`, `apps/mobile/app.json`, `apps/mobile/src/navigation/TabNavigator.tsx`, `.github/scripts/mobile-navigation-probe.py`, `.planning/blend/`, `.planning/listen-together/`, and `.planning/navigation-audit/`.
- Later live status also showed concurrent API/Convex/LuvLink work, many mobile files, `apps/web/src/lib/routes.ts`, and `package.json`. Treat all files outside the web/shared/harness/planning ownership above as other work and preserve them. The exact live list changes as workers proceed; `git status --short` is authoritative.

### Web/shared-owned paths

- New: `packages/shared/performanceTrace.ts`, `packages/shared/performanceTrace.test.ts`, `apps/web/src/lib/performanceTrace.ts`, `tests/performance/playwright.config.ts`, `tests/performance/search-to-play.web.spec.ts`, `tests/performance/run-web.ps1`, `tests/performance/local-vercel-gateway.mjs`, `tests/performance/local-vercel-gateway.test.mjs`, `tests/performance/verify-local-gateway.mjs`, `WEB-RESULTS.md`, `HANDOFF.md`, `CHECKLIST.md`.
- Modified: `apps/web/src/App.tsx`, `apps/web/src/components/CommandPalette.tsx`, `apps/web/src/hooks/useAudioPlayer.ts`, `article-search-to-play-plan.html` (navigation/status only).
- `apps/web/src/lib/routes.ts` is concurrently modified; it is not part of this performance slice.
- Local raw browser runs, sanitized probe summaries and startup logs are under ignored `output/performance/search-to-play/`; they are retained diagnostics and not valid timing samples.

## Shared trace API

Implemented in `packages/shared/performanceTrace.ts`, with no new package dependency:

```ts
createPerformanceTrace({ enabled, platform, now? })
```

Methods: `beginAttempt(scope, generation, metadata?)`, `getActiveAttempt(scope)`, `record(attempt, event, details?)`, `finish(attempt, outcome, details?)`, `exportRecords()`, `clear()`, `dispose()`. Scope values are `web.search-to-play`, `android.search.online`, and `android.search.local`. Details allow only finite `durationMs`, integer `resultCount`, and coarse `cache`; scenarios are `online|local`. The default buffer is bounded at 250. Superseded and stale callbacks are rejected. Disabled mode does not call the clock or retain records.

The web adapter reads only the boolean build flag `NEXT_PUBLIC_PERF_TRACE=1`. It publishes `window.allegraPerformanceTrace.snapshot()/clear()/recordResultsPresented()` only in that opt-in build. Web trace records contain no query, recording/song identity, URLs, account data or tokens. The audio instrumentation distinguishes `canplay` readiness from the real `playing` event; success waits for an advancing, active audio element observation. The browser harness labels post-rAF visibility as a **presentation proxy**, not a compositor paint or audible start.

Android uses `EXPO_PUBLIC_PERF_TRACE=1` only for its local diagnostic build and has the same snapshot/clear global shape. See Android report for Android event semantics and privacy boundary.

## Environment, tools and services

- Windows PowerShell; Node `v24.18.0`; npm `11.16.0`; local Playwright `1.63.0` at `C:\dev\allegra\node_modules\.bin\playwright.cmd`.
- Android-reported SDK `C:\Users\nithy\AppData\Local\Android\Sdk`; `java` on PATH resolves to Java 8. If Gradle is run, use the **per-command** JDK 21 override from Android report: `C:\Program Files\Eclipse Adoptium\jdk-21.0.9.10-hotspot`. Do not change machine-wide Java settings.
- `.env` / `.env.local` presence was checked, but no values were read or printed. Never put environment contents, tokens, query-bearing URLs or full request URLs in a report.
- Initial API/web probes timed out before the first production run. Current unrelated development listeners on `:8080` and `:5173` must be left alone. The benchmark runner now uses `:8082` API, `:5174` production Next, and `:5175` local Vercel-routing gateway; it checks all three ports and refuses to replace occupied services.
- At the last verified device probe, ADB listed `emulator-5554`; task-owned PIDs were emulator `40788` and QEMU `25956`. Android worker stopped it using `adb -s emulator-5554 emu kill`. A later direct `adb devices -l` probe was empty and `Get-Process qemu-system-x86_64,emulator` returned no process. No AVD was running at that check. Recheck before resource-intensive work and do not stop unrelated processes.
- The first runner started API and production Next processes; logs under `output/performance/search-to-play/server/` show startup. Current `:8080`/`:5173` listeners are dev processes outside that run. One-off diagnostic wrappers were removed after their sanitized results were saved. The updated runner tracks the API/Next/gateway process roots it starts; inspect process command lines and ports after any interrupted run before stopping anything.

## Checks actually run

Worker-run evidence (not yet an integrated root gate):

| Command | Result | Notes |
|---|---|---|
| `node --import tsx --test packages/shared/performanceTrace.test.ts` | Exit 0; 7/7 passed | Shared helper behavior: disabled/no clock, allowlisting, generations, dedupe, cap, dispose and clock regression. |
| `npm.cmd run typecheck --prefix apps/web` | Earlier exit 0; latest exit 1 | Latest diagnostics are in concurrent `apps/web/src/components/luvLink/LuvLinkPage.tsx`; preserve that file. It does not typecheck the standalone Playwright spec. |
| `node_modules\.bin\playwright.cmd --version` | Exit 0; 1.63.0 | Playwright installed. |
| `node_modules\.bin\playwright.cmd test -c tests/performance/playwright.config.ts --list` | Exit 0; lists exactly one web measurement test | Validates the dedicated config and test discovery; does not run a browser. |
| `npm.cmd run lint --prefix apps/web` | Exit 0; no diagnostics | Includes the web application lint project. |
| PowerShell AST parse of `tests/performance/run-web.ps1` | Exit 0; “PowerShell parse passed” | Syntax-only; runner not executed. |
| `node --test tests/performance/local-vercel-gateway.test.mjs` | Exit 0; 1/1 passed | Verifies API and `.well-known` routing, Next forwarding, and 206/Range status/header/body preservation using local fake servers. |
| `node --check tests/performance/local-vercel-gateway.mjs` and `verify-local-gateway.mjs` | Exit 0 | Syntax only. |
| Shared helper test after cleanup | Exit 0; 7/7 passed | Fixed 250-record cap; no configurable cap. |
| `git diff --check -- apps/web/src/App.tsx apps/web/src/components/CommandPalette.tsx apps/web/src/hooks/useAudioPlayer.ts .planning/performance/article-search-to-play-plan.html` | No whitespace diagnostics | Untracked files are not included in this git diff check. |
| `npm.cmd run sync:shared` | Run per worker checkpoint; exit status was not retained | It printed copy activity; no API mirror diff was present afterward. Re-run only if repository instructions require it after a shared edit, then inspect its exact effects. |
| Initial API health and web root probes | Both timed out before the isolated run | A later one-sample browser attempt ran but is excluded due to the confirmed production routing topology gap; see `WEB-RESULTS.md`. |

Android-worker-reported evidence is recorded in [ANDROID-RESULTS.md](ANDROID-RESULTS.md): latest focused Jest 16/16, parser 5/5, changed-file ESLint and PowerShell/Python syntax checks passed. Latest `mobile:check` exited 2: secret scan passed, ESLint had 0 errors/69 warnings, TypeScript failed on concurrent `ConnectProvider.tsx(233,45)` plus `convex/connect.ts(1292,47)` and `(1307,47/76)`; `test:ci` did not run. The controlled `assembleRelease` retry is active; no APK/runtime sample is verified yet. These Android checks were reported by the counterpart, not run by this worker.

Web lint passed exit 0 and Playwright discovery lists one test after the latest source cleanup. Two opted-in builds passed earlier, before the latest gateway/helper edits; the current production runner is rebuilding source and its browser outcome is pending. The only prior Chromium attempt was invalid due to bare-Next routing topology. Later API and same-origin diagnostics confirmed the setup failure. A local Vercel-route gateway unit test passes, but its live route check and browser smoke remain pending. Not run: trace-off comparison, full serial samples, full root typecheck/lint/test. Raw browser output and sanitized probe summaries are under ignored `output/performance/search-to-play/`.

## Web workload and run procedure

- Query: `Blinding Lights The Weeknd`; select the **first visible song result** deterministically. Capture provider result identity and count only in the ignored local run manifest; trace records stay metadata-free.
- New Playwright browser context per sample. The local API process is reused, so backend/provider cache is **unknown** even though a client context is new. Do not call these controlled cold samples. No retry is hidden: the harness stops at the first failure to avoid repeated provider load and records the failed attempt.
- Web timing uses Chromium at `1280x860`, serial, one worker, zero retries, no trace/video/screenshots, real typing at 35 ms per key, the existing product debounce, and a real row click. It does not use the E2E autoplay bypass flag.
- Web milestones include final query input change, `/api/search` request timing with query removed from stored route, visible row plus one rAF scheduling proxy, row click, and progressing unpaused/unmuted audio element. `playing` or `canplay` alone does not complete the journey.
- After Android releases resources and the isolated ports are free, first run one production browser smoke with `$env:PERF_SAMPLES='1'; powershell -ExecutionPolicy Bypass -File tests/performance/run-web.ps1`. It starts local API `:8082`, builds production web with `NEXT_PUBLIC_PERF_TRACE=1`, starts Next `:5174`, and routes browser-origin `:5175` through a local proxy that mirrors existing Vercel `/api` and `.well-known` dispatch. The consumed preflight checks sanitized API schema before Playwright. Only after a complete journey, run the planned 20 serial samples. The runner refuses occupied ports and only stops process roots it starts.
- Runner logs and JSON are stored under ignored `output/performance/search-to-play/`. Existing trace and probe JSON files are retained diagnostics from the invalid topology run; the gateway preflight and valid-run record do not exist yet. Report should include count, medians/IQR/range/failure rates, result identity/count, OS/browser/network/cache state and the proxy caveat.
- Production build invocation if run manually: `$env:NEXT_PUBLIC_PERF_TRACE='1'; npm.cmd run build --prefix apps/web`; unset/restore the flag before an ordinary build. Normal build default is no flag. Browser trace global must be absent in the ordinary build and present only for the opted-in measurement build.
- `NEXT_PUBLIC_PERF_TRACE` is diagnostic configuration, not a secret. Never add it to deployment config.

## Blockers and how to reproduce

1. **Valid web baseline pending:** initial browser attempt hit a confirmed local production routing gap and is excluded. Gateway unit test passes; wait for Android build release, then run the live route check and production browser measurement.
2. **Android TypeScript/build:** Android gate fails on concurrent ConnectProvider and Convex typing. Do not edit those owners' files. Check Android report for the diagnostic APK retry result before starting resource-heavy web timing or root gates.

## Next 1–3 actions

1. Finish the checkpoint/PR draft and rerun web lint plus Playwright discovery after any source change; run production build/browser smoke only after Android releases its active Gradle build.
2. Confirm the sanitized gateway preflight reports JSON success with nonzero results before Chromium. If one complete browser journey succeeds, run 20 serial samples and label backend/provider cache unknown. If it fails, stop at the first failure and update `WEB-RESULTS.md`, `CHECKLIST.md`, and this handoff.
3. Run integrated root gates after Android finishes and releases resources. Create a behavior optimization proposal only if a valid measured baseline supports one; await separate approval before source behavior changes.

## Safe resume after a partial command

First read the five files in the read order. Re-run `git status --short`, `git rev-parse HEAD`, `Get-NetTCPConnection` for 8080/8081/8082/5173/5174/5175, `adb devices -l`, and inspect only process IDs started by this task. If an interrupted runner leaves processes, identify them from ignored server logs and command lines before stopping them; never kill a port owner solely by port number. Build outputs in `apps/web/.next` are generated; do not delete them during another worker's active build. An interrupted request/sample is not a valid result. Do not repeat the direct API schema diagnostic unless new evidence justifies it; inspect its safe summary first.

## Resume prompt for Claude

> Continue the approved Allegra search-to-play **measurement** task in `C:\dev\allegra`. Read `.planning/performance/HANDOFF.md`, then `CHECKLIST.md`, `IMPLEMENTATION-PLAN.md`, `WEB-RESULTS.md`, and `ANDROID-RESULTS.md`. Recheck HEAD, `git status --short`, listeners and Android process/device state before acting. Preserve concurrent files/ownership. Complete the pending web harness checks and production browser baseline only when local API/provider works; coordinate a quiet window with the Android worker. Record only verified commands/results and update HANDOFF/CHECKLIST after each milestone. Do not implement a behavior optimization until the user separately approves a measured proposal, and do not deploy or claim a speedup/audible-start from proxies.


