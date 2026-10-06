# Performance implementation checklist

Updated: 2026-10-06 · Current checkpoint: web lint and Playwright discovery pass; one-sample production run is active (session 26487). Android build released with no APK.  
Legend: `[x]` verified complete · `[ ]` pending · **PARTIAL/BLOCKED** describes independent evidence limits and is not completion.

## Plan-stage checklist

### 1. What we will deliver
- [x] User-approved scope is search → visible result → local playback measurement on web and Android.
- [x] Later behavior optimization requires a second approval after a measured proposal.
- [ ] Baselines and measured optimization proposal complete.

### 2. Current evidence and boundaries
- [x] Current source hypotheses and timing boundaries are documented in `IMPLEMENTATION-PLAN.md`.
- [x] Playback proxy is distinguished from first audible samples; no session replay.
- [ ] Collect real platform evidence to confirm or reject the hypotheses.

### 3. Prepare a repeatable environment
- [x] Captured HEAD/branch, current dirty-worktree caution, Node/npm/Playwright versions.
- [x] Rechecked process state: preserve shared API dev `:8080` PID 44720, Next dev `:5173` PID 37428, and Expo process `:8081` PID 43728. Isolated ports `:8082/:5174/:5175` were free at last check.
- [x] Android worker reports AVD stopped; current ADB/process state is rechecked before any resource-heavy work.
- [ ] Record final browser/network/provider/cache environment and available resource state.
- [x] Confirm direct local API health/search and production-mode Next startup without exposing env values.
- [ ] Use safe, isolated Android test state; never inspect/clear the existing installed user's data.

### 4. Fix the workload and metric definitions
- [x] Fixed query chosen: `Blinding Lights The Weeknd`.
- [x] First visible song result is the web harness's deterministic selection rule.
- [x] Resolve one provider-qualified recording/result count from local API: 20 results, first `pW-kkdqr` / Blinding Lights / The Weeknd; share identity with Android.
- [ ] Collect web/Android online runs separately from Android local-library runs.
- [ ] Establish and label client/backend/provider cache state; a new browser context alone is not a cold backend.

### 5. Implement minimal measurement support
- **Shared:** [x] Helper API, injected monotonic clock, generation ownership, fixed 250-record storage, privacy allowlist, no-op disabled behavior.
- **Shared:** [x] Focused unit tests passed 7/7 after removing unused configurable-cap option; earlier `sync:shared` ran before this cleanup, exit status not retained.
- **Web:** [x] Opt-in adapter exists; `NEXT_PUBLIC_PERF_TRACE` defaults off; global exists only under the opt-in build.
- **Android:** [x] Adapter/tests implemented per Android report; opt-in flag is `EXPO_PUBLIC_PERF_TRACE`.
- [ ] Verify normal build has no debug trace global and diagnostic mode overhead limits with paired evidence.
- [x] Shared record fields omit query, recording identity, URLs, account data, tokens and provider metadata.

### 6. Wire website observations
- [x] Web `CommandPalette` records query/debounce/request completion and matching result commit.
- [x] `App` records the existing App search dispatch/response/commit and result selection/playback command without changing request behavior.
- [x] Audio handler distinguishes `canplay` readiness, `playing`, and advancing active element progress.
- [x] Harness uses serial Chromium, realistic typing/click, no autoplay bypass, and a post-rAF presentation **proxy**.
- [x] Earlier production Next build passed twice with `NEXT_PUBLIC_PERF_TRACE=1` (both before latest gateway/helper cleanup).
- [x] Playwright config discovery: one test listed from the dedicated config.
- [x] Web lint passed (exit 0, no diagnostics).
- **PARTIAL/INVALID TOPOLOGY:** [ ] Full browser journey. One production Chromium attempt reached local Next's same-origin `/api/search` and received HTML (200) because no Vercel gateway was active; exclude it from product timing/failure statistics (n=0 valid journeys).
- [x] Root-cause probes: direct API returned 200 JSON/success/20; production Next same-origin returned 200 HTML/no envelope/0. Existing Vercel `/api` route verified in `vercel.json`; local production Next intentionally has only dev rewrites.
- [x] Local-only Vercel-topology gateway routes API/.well-known to API and other paths to Next; unit test passes routing and 206/Range status/header/body.
- [x] Updated production runner uses isolated API :8082, Next :5174 and same-origin gateway :5175, refusing occupied ports; gateway route/206 unit test, JS syntax and PowerShell parse passed.
- [x] Current-source opted-in production build passed; sanitized gateway preflight returned 200 JSON success with 20 results.
- **IN PROGRESS:** One Playwright browser smoke is active in runner session 26487.
- [x] Reran web lint after helper/gateway cleanup (exit 0); Playwright discovery lists one test.
- [ ] Inspect diff to reconfirm no playback funnel, audio-node, debounce, Range 206 or reduced-motion behavior changed.

### 7. Wire Android observations
- [x] Android local/online attempt scopes and song/artist durations implemented per counterpart report.
- [x] Android player status correlation implemented per counterpart report; focused combined Jest 16/16, parser tests 5/5 and changed-file ESLint passed per counterpart report.
- [x] Complete `npm.cmd run mobile:check`: counterpart reports exit 2; secret scan passed; ESLint 0 errors/69 warnings; TypeScript failed on concurrent `ConnectProvider.tsx(233,45)` plus `convex/connect.ts(1292,47; 1307,47/76)`; `test:ci` skipped.
- [x] Android counterpart released session 72174 after `assembleRelease` exited 1 at Expo config because `NODE_ENV` was missing; it produced no APK and no emulator/runtime evidence. Preserve the unrelated mobile/Convex typecheck failures recorded above.

### 8. Collect baseline and select the fix
- **Web:** [ ] Query input→presentation proxy, request, selection→progress; sample count, median, IQR, range and failures.
- **Android online:** [ ] Same provider-qualified target, serial sample statistics and event breakdown.
- **Android local:** [ ] Separate existing downloaded track and library-size record.
- [ ] Preserve all attempts/failures; don't silently retry; document overlapping spans instead of summing them.
- [ ] Rank a candidate only from measured wait, correctness risk and affected users; if no defensible change, say so.
- [ ] Save raw local-only traces under ignored `output/performance/search-to-play/` and write platform results.

### 9. Conditional implementation choices
- [ ] Choose a narrow web or Android fix only if its measured wait supports that branch.
- [ ] No behavior optimization is implemented yet.
- [ ] Write `WEB-OPTIMIZATION-PLAN.md` and/or Android proposal with exact evidence/scope/verification; obtain later user approval before source behavior changes.

### 10. Verify the approved change
- [ ] Not applicable yet: no behavior change has later approval or implementation.
- [ ] After later approval, test correctness and repeat identical workload/build/device/cache/sample conditions.
- [ ] Root typecheck/lint/test and mobile gate results are pending; coordinate to avoid overlapping Convex-heavy gates.
- [ ] Check web 360/768/1280/1920 widths, reduced motion, audio-element continuity, streaming 206/Content-Range/Accept-Ranges.
- [ ] Physical Android play/pause/seek/next/buffering/focus/background/downloaded/online checks remain pending.

### 11. Retain the win and ship a reviewable slice
- [ ] No regression threshold or feature switch until a repeatable measured behavior win is approved.
- [x] No commit, push, APK install/release, deployment or external paid service was performed by this worker.
- [ ] Review owned diffs against concurrent edits; final integration checks pending.

### 12. Subsequent journeys
- [x] Startup, lyrics/scrolling and Connect remain out of this first measurement slice.
- [ ] Start a later journey only with its own scope, baseline and approval.

## Evidence ledger (update at each checkpoint)

| Platform / scope | Implementation checks | Runtime evidence | Status |
|---|---|---|---|
| Shared | Helper tests 7/7 passed; web typecheck passed. | None. | PARTIAL: implementation verified, no end-to-end baseline. |
| Web | Helper 7/7; gateway test 1/1; JS/PowerShell syntax pass; latest web lint exit 0; Playwright discovery 1 test. Earlier builds pass, current opted-in run session 26487. Latest typecheck fails in concurrent `LuvLinkPage.tsx`. | Direct API 200 JSON/success/20; bare Next 200 HTML/no envelope. Initial Chromium run invalid topology; current route check/browser outcome pending. | PARTIAL/BLOCKED: live gateway check and valid browser run pending. |
| Android online | Adapter, focused Jest 16/16, parser 5/5, focused ESLint pass per `ANDROID-RESULTS.md`; full mobile gate failed on concurrent Connect/Convex TypeScript errors. | No query/play sample. Controlled diagnostic APK build exited 1 at Expo config; no APK/device. AVD stopped. | PARTIAL; await APK outcome, then device/runtime work. |
| Android local | Instrumentation exists per counterpart. | No library or download run. | PENDING. |
| Behavior optimization | No fix implemented. | No measured baseline. | PENDING separate user approval after evidence. |
| Deployment/release | No ship action taken. | None. | OUT OF SCOPE. |

## Exact next actions

1. Finish current session 26487; inspect its sanitized route/run records and confirm runner-owned processes have stopped.
2. If the smoke completes a valid journey, run 20 serial samples. If it fails, stop and document that exact failure without repeated provider attempts.
3. Coordinate root gates after this web run releases resources. Write an optimization proposal only from valid measured evidence; await separate approval before behavior changes.




