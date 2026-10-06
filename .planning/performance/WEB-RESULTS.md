# Web search-to-play measurement checkpoint

Updated: 2026-10-06. This is an active measurement checkpoint, not a completed baseline.

## Status

The shared recorder and web instrumentation are implemented. The helper tests pass 7/7, the local routing gateway test passes 1/1, its source/verifier parse, and the PowerShell runner parses. The latest web lint passed exit 0 and Playwright discovery listed one test. Two opted-in production builds passed earlier, before cleanup; the current-source opted-in production build passed in runner session 26487.

The only Chromium attempt is invalid as product evidence. Bare production Next returned HTML with HTTP 200 for same-origin `/api/search`; the local API returned JSON success with 20 results. This established a benchmark-topology problem, not missing provider data or a product latency. The isolated gateway preflight passed in session 26487: HTTP 200, JSON, success envelope, 20 results. The one-sample Playwright browser journey remains active. There is no successful web journey, median, IQR, range or playback observation.

The runner now starts local API on `:8082`, production Next on `:5174`, and a same-origin gateway on `:5175`. The gateway sends `/api/*` and the existing `.well-known` OAuth metadata routes to the API, with all other requests sent to Next. It preserves status, response headers/body, client cancellation and `206` Range responses. The route policy comes from the current Vercel deployment routing; product `next.config.ts`, `vercel.json` and app routes are unchanged. A sanitized API preflight runs before Playwright.

## Fixed workload and metric boundaries

- Query: `Blinding Lights The Weeknd`.
- Local direct API diagnostic: HTTP 200, JSON success envelope, 20 results. First result was `pW-kkdqr` / “Blinding Lights” / “The Weeknd”. This resolves the shared test item only; it is not a browser journey or repeated timing.
- Selection rule: first visible song row, selected through a real click.
- Browser target: Chromium / Playwright 1.63.0, viewport 1280 × 860, one worker, serial samples, zero retries, no autoplay-policy bypass.
- New Playwright context per sample. Backend/provider cache remains **unknown**; this is not a controlled cold run.
- Results presentation is measured after row visibility and one `requestAnimationFrame` callback. It is a presentation proxy, not compositor-paint evidence.
- Playback completion requires an unpaused, unmuted, non-seeking audio element with advancing time. It is not physical audible-output evidence; `canplay`/`playing` alone does not complete the journey.
- Trace records are local and allowlisted. The separate ignored run record contains the fixed query and first result identity; no request body or response body is retained.

## Attempts and diagnostic evidence

1. The first production Chromium attempt ran one query journey and failed at the search response because bare `next start` served HTML for `/api/search`. It is excluded from product timing/failure statistics: 0 valid journeys. The trace interval 221.7–244.7 ms from final `query.changed` to the `search-failure` event is only diagnostic. There was no results commit/presentation, selection or playback progress.

4. After the route fix, one production browser attempt used the current source build and passed the gateway check (HTTP 200 JSON success, 20 results), but the journey timed out at open-search after Playwright's configured 600,000 ms test deadline. Its local record has ailure=open-search, ailureCause=unexpected-error, 11 successful /api/other requests, no /api/search, no trace events and no milestones. Treat this as one valid-topology harness/UI-stage failure (n=1; complete journeys n=0), not a search/provider latency or product timing sample. The record is in ignored output/performance/search-to-play/web-runs-traced.json; Playwright context is in ignored playwright-results/search-to-play.web-records-c370f-and-actual-element-progress/error-context.md. The context only reports the outer timeout, so the exact obstructed action is not established yet. The test's unbounded locator action/10-minute file timeout is a harness bug to fix before any retry.
2. One direct local API diagnostic returned HTTP 200, JSON, success, 20 results. One same-origin production Next diagnostic returned HTTP 200, HTML, no API envelope, zero parsed results. These single diagnostics established the missing local production routing topology. Their summaries are in ignored `output/performance/search-to-play/api-diagnostic.json` and `api-diagnostic-next-origin.json`; bodies were not saved.
3. The first browser artifact `output/performance/search-to-play/web-runs-traced.json` and Playwright error context remain under ignored `output/performance/search-to-play/`. These are retained as invalid-topology diagnostics; do not aggregate them as baseline data.

Temporary one-shot PowerShell probe wrappers were removed after their summaries were saved. The updated runner's live route check is `tests/performance/verify-local-gateway.mjs`; it stores only HTTP status, content-type class, envelope category and result count at ignored `gateway-route-check.json`.

## Environment and source identity

- Branch `feat/spotify-blend-info-tours`; HEAD `0e0c271ac49eeec0eca9a102a7f04ff44d4989e7` at last check. The shared worktree is dirty with unrelated/concurrent work; review the current status before resuming.
- Windows PowerShell, Node `v24.18.0`, npm `11.16.0`, Playwright `1.63.0`.
- Shared services preserved: API dev PID 44720 on `:8080`, Next dev PID 37428 on `:5173`, Expo PID 43728 on `:8081`. Last check showed isolated `:8082`, `:5174`, `:5175` free. Do not stop any shared listener.
- Android worker's controlled Gradle release build is active (session 72174 at last checkpoint); hold the web production build/browser timing until its direct release. No emulator/browser sample is active.
- Ignored startup logs currently exist in `output/performance/search-to-play/server/`. They belong to the earlier diagnostics, not to an active service from this worker.

## Verification record

| Command | Result | Evidence limit |
|---|---|---|
| `node --import tsx --test packages/shared/performanceTrace.test.ts` | Exit 0; 7/7 pass after cap cleanup | Shared-helper behavior only. |
| `node --test tests/performance/local-vercel-gateway.test.mjs` | Exit 0; 1/1 pass | Fake local servers verify API and `.well-known` routing, Next fallback, and 206/Range status/header/body. |
| `node --check tests/performance/local-vercel-gateway.mjs` and `node --check tests/performance/verify-local-gateway.mjs` | Exit 0 | Syntax only. |
| PowerShell AST parse of `tests/performance/run-web.ps1` | Exit 0 | Syntax only; current runner execution is active. |
| `npm.cmd run lint --prefix apps/web` | Exit 0 after current source cleanup | No diagnostics. |
| Earlier opted-in builds | Exit 0 twice | Predate latest helper/gateway edits. |
| Current `run-web.ps1` build | Exit 0 | Current-source opted-in Next 16.3.5 production build; TypeScript and static page generation completed. |
| `node tests/performance/verify-local-gateway.mjs` inside runner | Exit 0; 200 JSON/success/20 | Preflight only; not browser evidence. |
| `npm.cmd run typecheck --prefix apps/web` | Earlier exit 0; later exit 1 in concurrent `apps/web/src/components/luvLink/LuvLinkPage.tsx` | Preserve that file; not a measurement-slice error. |
| Playwright dedicated config `--list` | Exit 0; one test discovered | Discovery only, no browser execution. |
| First production browser runner with `PERF_SAMPLES=1` | Exit 1 overall; build passed, query failed on HTML returned for `/api/search` | Invalid local routing topology; zero valid journeys. |`r`n| Current production runner with gateway and `PERF_SAMPLES=1` | Build exit 0; preflight exit 0; Playwright exit 1 after 600,000 ms | One valid-route attempt, `open-search` / `unexpected-error`; no `/api/search` or latency measurement. Runner cleanup stopped its owned API/Next/gateway processes. |
| Historical direct API / bare Next one-shot diagnostics | Both exit 0, summarized above | Schema/routing diagnosis, not timing. Their temporary wrapper scripts were removed. |

Latest web lint/discovery, current-source production build and gateway preflight passed. The one-sample Playwright attempt timed out at `open-search` after 600 seconds; no query/result/playback timing was captured. The latest app typecheck had concurrent LuvLink diagnostics. Full root typecheck/lint/test remain pending.

## Next steps

1. Finish active runner session 26487 and inspect its sanitized route/run records; verify only runner-owned processes are stopped.
2. If the smoke completes a valid journey, run the planned 20 serial samples. If it fails, stop and record the exact sanitized failure without repeated provider attempts.
3. Only after a complete journey, run 20 serial samples and calculate median, IQR, range and failures for each defined milestone. Keep cache unknown. Then consider an optimization proposal only if measured evidence identifies a defensible bottleneck; implementation requires separate user approval.

## No-claims

No valid browser search-to-result or search-to-progress baseline exists. No speedup, reduced latency, production p95, 3× result, 120 fps or audible start has been established. The failed 244.7 ms endpoint is not a product-latency measurement.





## Baseline, 2026-10-06 (first valid run)

Branch `feat/search-to-play-trace` on top of PR #17 (per-keystroke search through
`/api/search/suggest`). Command: `$env:PERF_SAMPLES='20'; powershell -File tests/performance/run-web.ps1`.
Production Next build with `NEXT_PUBLIC_PERF_TRACE=1`, local gateway on `:5175`, Playwright
Chromium 1280x860, new browser context per sample, one API process reused, so the API's
in-memory search cache was warm after the first sample. Query `Blinding Lights The Weeknd`; the
first song row was `pW-kkdqr` (Blinding Lights, The Weeknd), 5 suggest rows.

Two harness fixes were needed first: every step now has a 20 s bound (the old click waited for the
10-minute test timeout), and the harness waits for and dismisses the first-visit onboarding that
covered the search pill. It also follows `/api/search/suggest`, which PR #17 introduced.

16 samples attempted, 15 complete. Sample 16 stopped at `selection-and-playback`: the audio
element did not advance within 25 s. The run stops at the first failure, so no more samples ran.

| Interval (ms, from the final keystroke unless noted) | n | Median | IQR | Range |
|---|---:|---:|---:|---:|
| Request dispatched | 15 | 130 | 118–138 | 95–162 |
| Suggest request duration (warm API cache) | 15 | 7 | 6–12 | 6–85 |
| Results committed | 15 | 142 | 128–172 | 103–218 |
| Results presented (post-rAF proxy) | 15 | 204 | 193–252 | 158–419 |
| Row selected → audio `playing` | 15 | 1,414 | 737–1,726 | 283–6,057 |

Reading: the search half is answered in about 0.2 s once the API is warm. The listener's longest
wait is between tapping a song and audio playing (median 1.4 s, worst 6.1 s, plus one sample that
never started). That interval covers stream resolution and the first audio bytes. Cold API and
provider cost is not represented: only the first sample could have been cold.

No optimization was implemented. A follow-up proposal needs measurement of the stream path
(`/api/stream/:id` time to first byte) before choosing a change, and separate approval.
