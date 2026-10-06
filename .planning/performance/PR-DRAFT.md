# PR draft — local search-to-play measurement support

## Summary

The web search-to-play journey previously had no bounded local timing trace or repeatable production-browser harness. A first Chromium attempt also showed that standalone `next start` does not provide Vercel's production `/api` rewrite, so that attempt could not measure the app. This change adds opt-in local observations and a serial Playwright runner whose local gateway reproduces the existing Vercel route split without changing product routing.

This is measurement infrastructure. It does not optimize search or playback, and no speedup has been demonstrated.

## Scope and review grouping

The new shared/web/harness source consists of 965 lines across nine files:

| Group | Files | New lines | Purpose |
|---|---|---:|---|
| Shared trace | `packages/shared/performanceTrace.ts`, `packages/shared/performanceTrace.test.ts` | 373 | One bounded recorder with injected monotonic clock, attempt/generation ownership, stale-callback rejection, a fixed 250-record cap and an allowlist; tests cover the behavior and disabled no-op. |
| Web adapter | `apps/web/src/lib/performanceTrace.ts` | 81 | Gates the browser global behind `NEXT_PUBLIC_PERF_TRACE=1`, correlates the selected player source, and keeps the same snapshot/clear shape as Android. |
| Browser harness | `tests/performance/playwright.config.ts`, `search-to-play.web.spec.ts`, `run-web.ps1`, `local-vercel-gateway.mjs`, `local-vercel-gateway.test.mjs`, `verify-local-gateway.mjs` | 511 | Isolates production services, mirrors existing Vercel API dispatch, validates the route before Playwright, and records one real serial search-to-progress journey with bounded local output. The gateway test protects API and Range 206 behavior. |

Existing integration edits are in `apps/web/src/App.tsx`, `apps/web/src/components/CommandPalette.tsx`, and `apps/web/src/hooks/useAudioPlayer.ts`. Their current shared-worktree diff is +170/-15 lines in total, but it includes concurrent unrelated hunks in `App.tsx` and `CommandPalette.tsx`; those files must be reviewed and staged by hunk so LuvLink work is preserved. Do not treat the entire file diff as performance-owned.

Planning and evidence files are separate from code: `WEB-RESULTS.md`, `HANDOFF.md`, `CHECKLIST.md`, this draft, and the existing HTML plan's links to the handoff/checklist.

## Behavior and privacy boundaries

- Tracing is disabled by default; the web debug global is created only in an explicit opted-in build.
- Shared records contain timing, generation, platform, event and allowlisted count/cache/outcome fields. They do not contain query text, song identity, URLs, account data or credentials.
- Stale generations cannot contribute events after supersession. Buffer size is fixed and bounded.
- Search result commit/presentation proxy is kept separate from selection and playback. `canplay` is readiness; browser completion requires an active audio element whose clock advances. This does not claim audible output.
- The app's request/debounce/playback flow, audio-node ownership, reduced-motion behavior and Range response contract are not intentionally changed. The local gateway is harness-only and does not modify `next.config.ts`, `vercel.json` or API routes.

## Validation and current evidence

Passed source-level checks after the latest helper/gateway cleanup:

- Shared helper tests: 7/7.
- Gateway unit test: 1/1, including API and `.well-known` dispatch, Next fallback, and HTTP 206 Range headers/body.
- Gateway/verifier JavaScript syntax and PowerShell runner AST parse.

Latest web lint and Playwright test discovery pass. The current-source opted-in production build and sanitized gateway preflight passed; one browser smoke remains active in session 26487. The latest app typecheck reported errors in concurrent `apps/web/src/components/luvLink/LuvLinkPage.tsx`; that file is outside this measurement scope. Full root gates remain pending coordination with the Android worker.

The direct local API diagnostic returned HTTP 200 JSON success with 20 results for the fixed query. The initial production browser attempt is invalid as product timing: bare Next returned HTML with HTTP 200 for `/api/search`, while the API itself returned JSON. The recorded 221.7–244.7 ms interval ended in `search-failure`; it is retained only as a local topology diagnostic. The new gateway preflight and browser run have not yet run.

## Remaining verification

After Android releases its active Gradle build and host memory recovers:

1. Rerun web lint and build current source with tracing explicitly enabled; verify ordinary builds leave the debug global absent.
2. Run one production Chromium smoke through the local Vercel-routing gateway. Stop on the first failed journey.
3. Only if the complete journey succeeds, collect the planned 20 serial samples and calculate median, IQR, range and failure rate for each milestone. Keep backend/provider cache marked unknown.
4. Run root typecheck/lint/test after Android releases the shared gate slot. Record unrelated existing failures without changing their owners' files.

Android's current `mobile:check` failed on concurrent Connect/Convex type errors, and its release-equivalent build is still in progress. No APK/runtime sample or Android baseline is established. See `ANDROID-RESULTS.md` for counterpart-reported evidence.

## Reviewer focus

Review trace-off behavior and privacy first, then attempt/generation correlation across query, displayed results and selected audio. Check that only actual progress is a playback completion and the harness does not call readiness audible. Verify the gateway forwards `206`, `Content-Range` and `Accept-Ranges`. Inspect integration hunks separately from concurrent LuvLink edits.

No latency reduction, performance win, audible-start time or production performance claim is made by this draft. No behavior optimization, deployment, commit or published PR has been performed.


