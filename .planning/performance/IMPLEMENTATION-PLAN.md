# Allegra performance implementation plan

Date: 6 October 2026  
Status: detailed proposal; implementation approval pending  
First slice: search → visible playable result → local playback, on web and Android

## 1. What we will deliver

Apply the article's measurement loop to Allegra: reproduce a real wait, attribute its cost, make one focused change, compare the same workload, and protect a demonstrated improvement. We will preserve Allegra's visual design and playback behavior.

The first deliverable is a reliable baseline for website and Android search-to-play. The second is an optimization proposal naming the measured bottleneck, exact files, expected benefit and verification. After that proposal is approved, implement and verify the selected fix. No numerical speedup is established yet.

This document expands the existing HTML review plan. It does not authorize instrumentation, source edits, APK installation or production deployment. Later journeys—startup, lyrics scrolling and Connect—have their own measurement and review steps.

## 2. Current evidence and boundaries

- `apps/web/app/ClientShell.tsx:9` loads the main application with `ssr: false`. This is a startup candidate, not proof of the search-to-play bottleneck.
- `apps/web/src/App.tsx:113–1770` owns substantial UI state. `loadSearch` near line 426 fetches results and updates that state. Profiling must establish which parts re-render and whether they delay input or results.
- `apps/mobile/src/screens/SearchScreen.tsx:81–433` has separate local and online searches, request sequence guards and selected store subscriptions. Its online effect awaits song search and artist search together before publishing either result. This is a concrete dependency worth timing.
- `apps/web/src/hooks/useAudioPlayer.ts:382–402` uses one buffering handler for both `canplay` and `playing`. Measurement must distinguish those events without changing existing behavior.
- `apps/mobile/src/contexts/PlayerContext.tsx:100` consumes native playback status. The UI adopts `playWhenReady`, which expresses intent and can be true during buffering. Actual native `isPlaying` is a different observation.
- `apps/mobile/android/app/src/main/java/com/lyricflow/app/modules/MainPlayerModule.kt` bridges native status to JavaScript. Receipt time includes bridge/event delivery delay; it is not a native audio-output timestamp.
- `docs/workflows.md` documents local Connect traces, but explicitly says adapter readiness is not first audible samples. These traces do not replace this baseline.
- The last inspection found no connected Android device and an unavailable local API at port 8080. Recheck these before executing; they are snapshots, not permanent blockers.

Source inspection identifies hypotheses. The measurements below decide which hypothesis deserves a change.

## 3. Prepare a repeatable environment

1. Record current HEAD, branch, dirty-file list and relevant source diff. The planning snapshot was `0e0c271ac49eeec0eca9a102a7f04ff44d4989e7`; use the actual current revision when running.
2. Preserve existing mobile navigation, version, CLAUDE.md and audit edits. Do not reset, stash or incorporate them into a performance commit without understanding ownership. If an isolated checkout is needed, document whether it includes those edits; its timings represent that checkout only.
3. Check `http://localhost:8080/api/health` before starting another API. Use the existing root development command for inspection. For final web timing, build `apps/web` and run its production server at port 5173 with the API on 8080. Confirm the rewrite works. Do not benchmark Next development overhead as production performance.
4. Record machine, browser version, viewport, power mode, network and backend/provider configuration. Keep the machine otherwise quiet. Save environment metadata without secrets.
5. Connect a physical Android phone and record model, OS, display refresh rate, power mode, installed APK version, commit and build type. Prefer a local release-equivalent benchmark build. Development builds can help locate a problem but do not establish release speed.
6. Keep guest and signed-in results separate. Initial primary workload uses local playback with no other active Connect owner. A remote playback route becomes a separate scenario rather than silently changing the endpoint.

Outputs: `environment.json`, a source-diff identity and a short runbook under `output/performance/search-to-play/`. Check existing ignore rules before saving local artifacts. Do not commit device identifiers or private traces.

## 4. Fix the workload and metric definitions

Choose one online query and one recording available on both platforms; record its provider-qualified identity and expected result count. Make sure it is not already playing. Android uses its Online scope for the primary cross-platform workload so a downloaded duplicate cannot silently change the measurement into local-file playback.

Measure Android On this phone search separately using a fixed existing library and downloaded recording. Record its library size. Do not merge these figures with online results. Use the product's actual request path on each platform and disclose differences; the main before/after comparison is within each platform.

Define events:

- `query.changed`: input change handler receives the fixed final query.
- `search.dispatched`: debounce ends and the search operation starts.
- `catalog.completed`: playable song response has been consumed.
- `artists.completed`: Android artist response has been consumed, recorded independently.
- `results.committed`: the matching query generation commits its displayed song rows.
- `results.presented`: external render/frame observation confirms a usable result. Commit alone is not proof of paint.
- `result.selected`: the existing row handler receives the tap/click, before queue/loading work.
- `playback.commanded`: the existing player path is given playback intent for that attempt.
- `media.ready`: browser readiness or native prepared-state observation, when available.
- `playback.observed`: selected media is actually progressing with playback active and not suppressed/buffering.
- `attempt.finished`: success, empty result, aborted, superseded, timeout, playback failure or remote-routed outcome.

Report input-to-result presentation and selection-to-playback separately. For total search-to-play, automate a fixed selection rule once the target result is available and report the selection gap. Never count a person's variable hesitation as system latency.

Report audio-event/native-state timing as a playback proxy. Validate actual audible start on the physical device separately; if precise output timing is needed, use an authorized controlled local capture or native audio trace and describe its limitations. No automatic recording or session replay is part of this plan.

## 5. Implement minimal measurement support after approval

Proposed new shared file: `packages/shared/performanceTrace.ts`, with behavior tests in the shared package's existing test convention. Before adding it, inspect the relevant package scripts and exports. It will have no npm dependencies so mobile does not accidentally bundle another React.

The helper owns attempt IDs, generation tokens, injected monotonic clocks, bounded event storage, one-time completion and export of durations. Proposed buffer limit: 250 records; this is a storage bound, not a performance target. No periodic persistence, network exporter or global store subscription. Completion removes active attempts. New input supersedes the old attempt; late callbacks cannot finish its successor. Dispose on opt-out/unmount.

Event data is restricted to attempt/generation, event kind, local elapsed time, platform, outcome, result count and coarse cache/scenario labels. Keep query text, song metadata, account IDs, tokens and URLs out of trace records. Store workload identity in the separate private run manifest if necessary.

Proposed platform adapters: `apps/web/src/lib/performanceTrace.ts` and `apps/mobile/src/services/performanceTrace.ts`. Reuse existing local trace patterns where appropriate, but do not expand Connect's trace API to unrelated journeys.

Opt-in diagnostic builds may use proposed `NEXT_PUBLIC_PERF_TRACE=1` and `EXPO_PUBLIC_PERF_TRACE=1` flags. These are public boolean switches, never credentials. Default them off and keep them absent from deployment/normal release configuration. Verify normal builds expose no trace buffer/export API and execute no measurement listeners. If a build-time flag cannot strip instrumentation cleanly, use a dedicated local benchmark entry instead of weakening the production boundary.

Use the same diagnostic build mode and instrumentation in both baseline and final runs. Obtain uninstrumented corroboration and compare overhead. Detailed React/native profiling runs are separate from the low-overhead timing runs.

Before any multi-file source edit, run `graft callers <changed-symbol> --depth all`, inspect current spans and nested instructions, and finalize the smallest actual file set. Shared changes require `npm.cmd run sync:shared` according to repo rules.

## 6. Wire the website observations

In `apps/web/src/App.tsx`, mark the actual search input handler, the existing debounce, `loadSearch` dispatch/response and existing result-selection handler. Carry an attempt generation through the existing request cancellation path; instrumentation must not add requests or change debounce values.

In `apps/web/src/lib/api.ts`, observe the search boundary only if the App boundary is insufficient to attribute response consumption. Do not wrap every API call or change the response envelope. Browser network traces provide request timing without new backend instrumentation initially.

At the actual result-list component, observe the matching render commit using minimal local instrumentation. A post-commit animation-frame callback is a scheduling observation, not guaranteed physical paint. Use browser rendering traces to corroborate presentation, and keep the metric label explicit when only a proxy is available.

In `apps/web/src/hooks/useAudioPlayer.ts`, attach diagnostic observations to the existing layout-owned audio element. Distinguish `canplay`, `play`, `playing`, `waiting`, `error` and advancing `currentTime`. Do not remount the element, issue playback from the recorder, change buffering logic or make load effects depend on play state. Associate completion with the selected source/attempt; ignore old-source events and duplicate `playing` signals.

Collect main-thread tasks and selected layout/style observations using browser tools where supported. Capture React commit attribution in a separate profile run. Do not add broad profiling wrappers around the entire app unless narrower evidence leaves an attribution gap.

Proposed local harness: `tests/performance/search-to-play.web.spec.ts` and a dedicated performance Playwright configuration. Reuse installed Playwright, run serially and explicitly select this harness. The current E2E config is built around development servers and specific filename matches, so do not assume it provides production-mode performance runs automatically.

The timing harness uses realistic gesture/autoplay behavior. Existing E2E autoplay bypass flags may remain useful for correctness, but cannot establish user click-to-play latency.

## 7. Wire the Android observations

In `SearchScreen.tsx`, record local and online generations separately. Mark local lookup, online song lookup, artist lookup, resulting list commit and the `playOnline`/`playLocal` handlers. Preserve both existing sequence guards and the current online/local scope rules.

Trace song and artist completion separately without changing the existing combined publication behavior during baseline collection. This will reveal whether songs are waiting for artists and by how much.

Observe the existing streamed-song handoff used by `StreamService.play`, then the playback command and native status in `PlayerContext.tsx`. Do not assume every search uses `searchOfficial`; SearchScreen currently invokes `searchMusic` directly. Preserve queue construction, routing and sheet-opening behavior.

Use actual native playing/buffering/suppression observations rather than Zustand's displayed play state. Associate the active attempt with the selected track; if existing status lacks enough identity, inspect `NativeAudioPlayer.ts`, `MainPlayerModule.kt` and the native player bridge before proposing a diagnostic-only identity marker.

Native and JS clocks have different origins. Report JS tap-to-received-status on the JS monotonic clock, and native load-to-playing on Android's monotonic clock independently. Do not subtract their raw timestamps. Cross-clock timing requires explicit calibration and uncertainty, which is outside the initial default.

Use Android system/native profiling to examine frames, main-thread work and event delivery. A React Native commit or layout callback does not prove a native frame was presented. Corroborate with physical-device frame evidence and keep proxy metrics labeled.

Keep downloads, online playback and remote routing separate. Do not modify the existing roughly 1 Hz position-store update just to obtain a timer. Avoid polling loops and continuous progress logging.

## 8. Collect the baseline and select the fix

Start with 20 unprofiled warm repeats and 10 controlled cold repeats per platform/scenario. Report all attempts, including failures and superseded requests. Do not retry a failed run invisibly. Repeat slowly enough to respect existing request limits; provider-heavy work is serial.

Define cold conditions precisely: fresh app/browser process, client cache condition and observed backend cache condition. A fresh page does not prove a cold provider/backend cache. Never erase account storage or downloads to manufacture a cold run.

Save raw bounded timing records and summaries with median, IQR, range, sample count and failure rate. Increase samples if noise obscures the decision. Profiling samples explain cost but are not mixed into timing statistics. These lab sample counts cannot establish production p95/p99.

Break down debounce, request/response, additional artist wait, response-to-presentation, selection-to-command and command-to-playing. Some spans overlap; do not add all durations as if they were serial.

Rank candidates by measured milliseconds on the actual journey, consistency, affected users, correctness risk and maintenance cost. If the UI is fast and the provider dominates, report that rather than forcing a frontend rewrite. If clock/presentation evidence is ambiguous, repair the measurement first.

Output: `.planning/performance/BASELINE.md`, local raw files, and a narrowly scoped `.planning/performance/OPTIMIZATION-PLAN.md` naming one measured fix. Request approval of that specific optimization before changing behavior.

## 9. Conditional implementation choices

These are decision branches, not a commitment to implement every item.

**If Android artist lookup delays playable songs:** publish song results as soon as song search resolves and publish artists independently when ready. Give each result lane appropriate loading state; retain sequence checks and stale-result protection. Preserve final song identity/order, artist results, deduplication and errors. Verify songs become selectable while artists are delayed, and no old query overwrites a newer query. Likely initial file: `SearchScreen.tsx`; expand only if its tested boundaries require it.

**If unrelated playback updates delay web search:** use profile evidence to isolate the result list or fast-changing player state from unrelated views. Stabilize only proven expensive props/subscriptions. Preserve the single audio node and existing navigation. A large App file alone is not a reason to refactor it wholesale.

**If Android native/JS work delays selection:** change the measured handoff or subscription only. Preserve Media3 ownership of transport, focus handling, queue and buffering state. Avoid moving native-owned playback state back into JS to simplify measurement.

**If requests dominate:** first examine duplicate requests, dependency order and repeated resolution of an already-known song. Optimize the measured redundant work without changing provider contracts or ranking. Persistent caching, speculative prefetch and new infrastructure need a separate proposal covering identity, expiry, privacy, bandwidth and battery.

**If no defensible improvement is measurable:** deliver the baseline and explanation; do not add complexity to chase a proxy count.

## 10. Verify the approved change

1. Establish a reproducible behavioral/performance failure before the fix. For the artist-wait branch, a controlled slow artist response must delay songs on baseline and stop delaying them after the fix. Then demonstrate real elapsed-time benefit with the representative workload.
2. Test recorder behavior: superseded attempts, late responses, duplicate media events, empty/error outcomes, disposal and clock isolation. Test the fix's externally observable behavior rather than internal method names.
3. Re-run the same workload with identical build modes, devices, network/cache conditions, counts and metric boundaries. Alternate baseline/final blocks where practical to reduce network drift. Compare absolute milliseconds, relative change, variation and failure rate.
4. Run `npm.cmd run typecheck`, `npm.cmd run lint` and `npm.cmd test`; run `npm.cmd run mobile:check` when mobile is touched. Run root and mobile gates without overlapping Convex-heavy test runs. Report failures with actual output.
5. On web check 360, 768, 1280 and 1920 widths, reduced motion, scrolling, result selection and navigation while playing. Confirm the same audio element survives and streaming still preserves `206`, `Content-Range` and `Accept-Ranges`.
6. On the physical Android phone check play, pause, seek, next, buffering, focus interruption, background/resume, downloaded playback and online playback. Check queue/routing behavior if touched; use a signed-in development setup for any Connect acceptance.
7. Compare request count, duplicate loads, memory and frame behavior. Battery conclusions need device measurements over a suitable interval; shorter lab runs cannot establish improved battery life.

Accept a gain only if it exceeds measurement variation, meets correctness checks and does not hide work behind a changed endpoint or missing content. Report browser/local proof, physical-device proof and production proof separately.

## 11. Retain the win and ship a reviewable slice

Keep a stable benchmark only after it correlates with the actual user wait. A render/request-count budget can protect a demonstrated source of latency; a noisy millisecond threshold should not block CI by default. Do not introduce automatic ratcheting until repeatability has been demonstrated.

Use a feature switch only if the approved behavior change has a meaningful rollout risk, and document removal criteria. Do not create a flag for every small change. Keep performance commits separate from unrelated edits.

Any mobile/shared change that rebuilds an APK on main must include the repo-required version bump, coordinated with the version edits already present. Verify the final diff and build identity before release. Production deployment is a separate explicitly authorized step; this planning request does not authorize shipping.

Final outputs: approved implementation diff, before/after results, correctness evidence, measured limits and any retained regression control. No claim of 3× speed, 120 fps or production improvement without matching evidence.

## 12. Subsequent journeys

After search-to-play is complete, choose the next slice using impact and evidence:

1. **Startup:** app launch/navigation → search control actually usable; separate web HTML/JS initialization, home requests and Android startup. Evaluate partial server-rendered content or deferred optional UI only after attribution.
2. **Lyrics and scrolling:** fixed long track/lyrics set → frame presentation and interaction response while playing; inspect which content changes each tick, virtualization and visual budgets. Match device refresh rate and validate on the phone.
3. **Connect:** local gesture → acknowledged receiver action, with separate receiver readiness/audible acceptance; reuse the existing local trace contract and avoid raw cross-device clock subtraction.

Each gets its own baseline, focused proposal, approval, implementation and like-for-like comparison. The first execution milestone remains the search-to-play measurement slice on both platforms.
