# Claude handoff: Allegra performance and lyrics work

Prepared 2026-10-04 at the user's request. Coding workers are stopped; the unfinished mini-player task was interrupted before its product edit landed.

## Checkout and ownership

- Workspace: `C:\dev\allegra`.
- Branch: **`feat/native-queue-engine`**.
- HEAD: `10f1e0c73e60094059fc0ac913f350f525d6ed83`.
- Requested review comparison: `git diff 10f1e0c73e60094059fc0ac913f350f525d6ed83` against the supplied origin/main merge base.
- All workers used the same checkout and branch. There are no worker branches to merge.
- Product changes and planning documents are **local and uncommitted**. No commit, push, deployment, release build or new APK was made.
- Start by inspecting the current working tree. Do not reset, clean, switch branches, or discard untracked source files.

The initial review comparison was empty: the feature branch was at the supplied base. The lyrics and visibility changes listed below were subsequently made in this working tree.

### Concurrent changes observed during handoff preparation

Two additional files became modified after the first branch/status check:

- `C:\dev\allegra\apps\mobile\src\services\LyricaService.ts` (observed write time 17:33:36): shared title/artist cleaning, a warm/prefetch method, shorter backend timeout when plain lyrics exist, and an AbortController-based timeout.
- `C:\dev\allegra\apps\mobile\src\services\lyrics\EchoLyricsCascade.ts` (observed write time 17:32:56): concurrent provider requests with priority-order selection, in-flight coalescing, and provider-error handling.

These edits were not made or reviewed by the stopped workers in the completed slice. Their author is not established here. Preserve them and inspect current status again before continuing: another process/agent may still be writing. The test results below describe the previously checked lyrics/UI activity slice and **do not cover these newer service edits**. Do not describe provider cancellation/coalescing as verified delivery based on those earlier logs.

## User's objective and accepted requirements

The user reports lag across all screens. They asked for a complete optimization/Kotlin master plan, research using official sources and PixelPlayer/Echo Music/NewPipe, implementation by GPT-6 Luna at extra-high reasoning, coordinator review/debug, and a correction for lyrics drifting down and out of view.

The active lyric should sit a little above the middle of its actual viewport. All three future layouts are requested: current upper lyrics with lower controls, video above lyrics, and full lyrics. These additional layouts and YouTube playback are planned, not implemented.

The user then requested code review and bug correction. The latest instruction is to stop and hand off this work to Claude. Do not treat a plan document as proof that a feature is implemented or the app is faster.

## Read before continuing

Read applicable `AGENTS.override.md`/`AGENTS.md` and `CLAUDE.md`, including the mobile scope. Root AGENTS explicitly makes CLAUDE applicable. For native queue ownership, use current source and the newer scoped rules rather than stale descriptions of the former JS queue architecture.

Root orientation documents: `C:\dev\allegra\docs\architecture.md`, `docs\api-contract.md`, `.planning\ROADMAP.md`, and `docs\workflows.md`. Propose API contract changes first. Read `convex\_generated\ai\guidelines.md` before any Convex edits.

Use graft first for code discovery and trace callers before changing symbols. Keep the product's existing design, reduced-motion behavior, provider contracts, seconds-based duration semantics, source-qualified identities and Android/iOS ownership boundaries. Work one reviewable vertical slice at a time.

## Completed product work

### 1. Shared lyrics follow/geometry correction

Files:

- `C:\dev\allegra\apps\mobile\src\components\SynchronizedLyrics.tsx`
- `C:\dev\allegra\apps\mobile\src\playback\lyricLayout.ts` — new, untracked
- `C:\dev\allegra\apps\mobile\src\playback\lyricLayout.test.ts` — new, untracked

The renderer uses native row positions/heights and the lyric block origin, accounting for spacer/header offsets. It waits for real viewport/content readiness, clamps follow and imperative seek targets to actual scrollable extent, and reevaluates targets when content size or viewport size changes. Measurement batching calls the latest recomputation callback after song/settings changes. Footer space allows later lines to reach their anchor. Regression cases cover content arriving late and resizing.

This is the shared local/Connect renderer. Audio/queue authority was not redesigned. A concurrent writer supplied part of the native measurement/footer patch during the earlier investigation; that work was preserved, not replaced. Inspect the entire combined diff, not just the worker's attributed portion.

### 2. Foreground and route visibility slice (UI-1)

Three GPT-6 Luna workers at `xhigh` implemented separate owned areas, then the coordinator inspected their diffs and sent corrections back to the same workers.

- `C:\dev\allegra\apps\mobile\src\utils\appActivity.ts` — new injectable activity source: boolean snapshot, one shared native listener, reconciliation after subscription, notifications only on boolean changes, cleanup after the final subscriber.
- `C:\dev\allegra\apps\mobile\src\hooks\useAppActive.ts` — new shared hook using `useSyncExternalStore`.
- `C:\dev\allegra\apps\mobile\src\hooks\useAppActive.test.ts` — new tests of the real injected source, including transitions, sharing/cleanup, resubscription and unknown startup state.
- `C:\dev\allegra\apps\mobile\src\hooks\useVisualBudget.ts` and `utils\visualBudget.ts` — app activity stops the ambient running budget while preserving selected density/cap. Relevant tests added to `utils\visualBudget.test.ts`.
- `C:\dev\allegra\apps\mobile\src\components\NowPlayingBackground.tsx` — glow/aura and decorative playback require route focus and app activity; hidden glow premount is deferred. Mounted artwork/source is retained across temporary visibility loss.
- `C:\dev\allegra\apps\mobile\src\components\NowPlayingLyricsArea.tsx` — lyric live activity requires requested lyrics, route focus and app activity; hidden premount waits while unfocused/backgrounded. Mounted lyric state is retained.
- `C:\dev\allegra\apps\mobile\src\components\player\GlowBackground.tsx`, `components\allegra\MusicFlowField.tsx`, and `components\PerformanceHUD.tsx` — stable typed `useCallback` worklets. HUD UI/JS samplers stop while inactive and resume with fresh timing.

No playback command, Kotlin queue/service, backend/provider, database, shared API, dependency or build configuration change was made by this slice.

### 3. Debug corrections completed

1. Standalone frame callbacks lost contextual typing. Luna added the installed Reanimated `FrameInfo` type to all three callbacks.
2. The first activity test imported React Native's mapped ESM setup and failed before execution. Luna extracted the injectable source into `utils/appActivity.ts` with type-only RN imports. No global Jest configuration/dependency change was needed.
3. Luna removed an unnecessary premount boolean abstraction and its formula-mirroring test; actual lifecycle and budget behavior tests remain.

## Review outcome and immediate unfinished task

The coordinator independently reviewed the combined diff. Parallel standards/spec reviewers found no confirmed actionable introduced regression in the lyrics geometry, activity lifecycle, callback boundaries or retained canvas behavior. A reviewer identified an **existing** mini-player hidden animation gap. It was verified against the supplied base, so it was not presented as a regression introduced by these changes.

The user authorized correcting bugs. This next fix was assigned to a Luna worker, then interrupted for this handoff. **`PillPlayer.tsx` is unchanged and this fix is not implemented.** No `LUNA-PILL-FIX-RESULT.md` exists.

### Next task: stop the invisible mini-player glow and cover rotation

Primary ownership: `C:\dev\allegra\apps\mobile\src\components\PillPlayer.tsx`.

Both `MiniPlayer.tsx` and `ConnectMiniPlayer.tsx` use this shared pill, which remains mounted beneath the full player during handover. Its shell opacity uses `handOver = Math.max(0, 1 - playerSheetProgress.value * 4)`, so it is invisible at sheet progress >= 0.25. The mini `GlowBackground` receives no `active` prop and defaults active. The cover's infinite rotation depends on playing state and likewise continues when hidden.

Implementation brief:

1. Reinspect current code/callers and `C:\dev\allegra\apps\mobile\src\navigation\sheetProgress.ts`. Derive actual visible state on the UI thread from the same fade threshold used by shell opacity, also accounting for entry visibility.
2. Use a worklet reaction and cross to JS only when the visibility boolean changes. Do not send per-frame React state updates or read shared values in render.
3. Pass that visibility into `GlowBackground.active`; retain the mounted surface and last frame, resuming when the closing sheet makes the pill visible again.
4. Reuse `useAppActive` to pause the infinite cover rotation while the app/pill is hidden and preserve its angle on resume.
5. Do not just gate on `!sheetUp`: that prop changes around the sheet animation and does not describe the actual fade handover.
6. Preserve transport, queue, Connect, gestures, navigation and design. Avoid React refs/JS-only APIs inside worklets and avoid introducing another budget system.
7. Run focused lint/worklet checks, then the separate full mobile gates. Exercise local and Connect open/close/foreground behavior on a device when available. State device limitations if unavailable.

Approximate original locations for orientation: shell motion around line 180 and mini Glow around line 236. Reverify line numbers before commenting or editing.

## Local verification already completed

| Gate | Result |
|---|---|
| Root typecheck | Exit 0 |
| Root lint | Exit 0 |
| Root tests | Exit 0 |
| Final integrated mobile typecheck | Exit 0 |
| Final integrated mobile lint | Exit 0, two existing warnings |
| Full mobile Jest | **86 suites / 726 tests passed**, exit 0 |
| Subsequent focused review run | **6 suites / 35 tests passed** |
| `git diff --check` | Exit 0; informational line-ending warnings |

These results predate the concurrent service edits recorded above. Rerun the relevant gates after reviewing/integrating those changes and any further work.

The two mobile lint warnings were a shadowed `i` in the generated Android test report and unused `esc` in `src/database/scanQueueQueries.test.ts`.

Logs: `C:\dev\allegra\output\luna-optimization-20261004\root-typecheck.log`, `root-lint.log`, `root-tests.log`, `mobile-typecheck.log`, `mobile-lint.log`, `mobile-tests.log`. Detailed verification is in [LUNA-VERIFICATION.md](C:/dev/allegra/.planning/performance-kotlin/LUNA-VERIFICATION.md).

Commands used (run mobile gates from its directory; root gates exclude mobile):

```powershell
Set-Location -LiteralPath 'C:\dev\allegra'
git diff 10f1e0c73e60094059fc0ac913f350f525d6ed83
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
git diff --check

Set-Location -LiteralPath 'C:\dev\allegra\apps\mobile'
.\node_modules\.bin\tsc.cmd --noEmit
.\node_modules\.bin\eslint.cmd .
.\node_modules\.bin\jest.cmd --runInBand
```

### Device/performance evidence limits

No release-device baseline, physical-phone frame trace, battery comparison or measured speedup exists. The latest `adb devices` check showed no attached device.

An earlier attempt launched a Pixel_9_Pro emulator with a compatible older debug client and current JS; Metro reached Stream. Permission/dev overlay and fixture/catalog timeouts prevented reaching a verifiable lyric-anchor view. Startup evidence is **not** lyrics acceptance or a current release APK. Evidence: `C:\dev\allegra\output\lyrics-scroll-20261004\RESULT.md` and `native-startup.png`. The launched Metro/emulator were stopped.

Before claiming visual acceptance, test multiple lyric lengths, late arrivals, wrapped text, font/settings changes, seeking, reopen/resize, first/final lines and both local/Connect views. Before claiming performance improvement, collect release traces and compare the same journeys/fixtures. Background audio/notification behavior needs device regression coverage too.

## Master plan and remaining scope

Main artifact: [MASTER-PLAN.md](C:/dev/allegra/.planning/performance-kotlin/MASTER-PLAN.md).

Area research/plans:

- [UI-PERFORMANCE-PLAN.md](C:/dev/allegra/.planning/performance-kotlin/UI-PERFORMANCE-PLAN.md)
- [NATIVE-PLAYBACK-PLAN.md](C:/dev/allegra/.planning/performance-kotlin/NATIVE-PLAYBACK-PLAN.md)
- [BACKEND-YOUTUBE-PLAN.md](C:/dev/allegra/.planning/performance-kotlin/BACKEND-YOUTUBE-PLAN.md)

Worker prompts, completed debug queue and per-worker reports: [LUNA-EXECUTION.md](C:/dev/allegra/.planning/performance-kotlin/LUNA-EXECUTION.md), `LUNA-VISIBILITY-RESULT.md`, `LUNA-CALLBACKS-RESULT.md`, `LUNA-LYRICS-ACTIVITY-RESULT.md`. Earlier lyrics evidence: [VERIFICATION.md](C:/dev/allegra/.planning/performance-kotlin/VERIFICATION.md).

Recommendation: retain the React Native/TypeScript shell and Node/Convex backend, remove avoidable render/request work first, then extend the existing Kotlin service and pilot a native lyric/video component. Android audio and the full queue are already Kotlin/Media3. A full Compose rewrite remains an optional later migration gated by measurements and parity.

Remaining slices, in sequence from the master plan:

1. Collect release-device responsiveness/frame/request baselines and finish UI-1 device acceptance plus the pending pill fix.
2. Virtualize Stream shelves/defer continuation; introduce real cancellation/coalescing and bounded positive/negative lyric caches.
3. Move queue snapshot persistence off the main/player thread using ordered immutable snapshots and revision fencing; extend existing native link recovery/radio work and durable download receipts.
4. Bound decoded image bytes, blur composition and retained media resources; measure large-library SQL/search before moving more computation.
5. Pilot native lyrics tied directly to the existing Media3 clock, preserving local/Connect/settings/accessibility parity.
6. Resolve YouTube source/capability/contract decisions, then implement all requested layouts with one audio/clock owner.
7. Consider wider Compose migration only after an independently useful measured pilot.

No Stream virtualization, provider cancellation/caching, Kotlin snapshot IO, native lyrics, YouTube source integration, video/lyrics layouts or whole-app Kotlin rewrite has been implemented in this work.

## Reference-app and YouTube research cautions

The area plans contain official-source links, inspected paths and commit pins. Echo upstream was inspected at `399e6bcb44ebd2d3e08915d13f079b7af3ee1635`; its local comparison clone is `C:\Users\nithy\Desktop\aclones\Echo-Music-upstream` at a different historical revision. PixelPlayer current main was inspected at `63cb59b97aff1d60c5aa46afdf5ce489e632b267` and had proprietary licensing; the separate PixelPlayerOSS was inspected at `ba94188015258211889abe62baea8ff4e928e805` under GPL-3.0-or-later. Study architecture; reverify the relevant edition/license before any reuse.

NewPipeExtractor is Java/JVM callable from Kotlin, not a complete Kotlin lyric renderer. Official YouTube iframe capabilities and a native extracted source have different playback/layout boundaries. The iframe approach needs a visible player owning its clock/audio, and does not supply hidden/background/offline/separate-audio behavior for full lyrics. A native source may fit the existing Media3 architecture but needs an explicit provider-access/source contract decision and maintenance/license review first.

Do not overlay a muted video on a different provider recording and promise lyric synchronization without version/timing provenance, offset handling and mismatch fallback. Do not put extraction, token/spoofing or stream access into the existing metadata-only YouTube Music client. The proposed metadata video attachment/`GET /api/videos/match` is a proposal, not a shipped endpoint.

## Preserve unrelated work and complete the handoff safely

Unrelated/pre-existing untracked items include `.mcp.json`, `mobile allegra.png` and contents of `output\`. Preserve them. Some new logs under output belong to this work, but do not delete the directory or indiscriminately stage it. A verified Graft-generated `apps\mobile\.ignore` was removed earlier; no other cleanup is needed.

Required new product files are `useAppActive.ts`, `useAppActive.test.ts`, `appActivity.ts`, `lyricLayout.ts` and `lyricLayout.test.ts`. They are currently untracked and must accompany the tracked product changes in any eventual scoped commit. All `.planning\performance-kotlin\` documents are currently untracked as well. Review exact staging later; no Git publication action was requested by the handoff instruction.

All coding agents are stopped. Continue in this checkout only after reading this handoff and the actual diff. The next product task is the narrow PillPlayer fix above, followed by its checks and device acceptance where possible.

## Pasteable starting prompt

> Continue the Allegra performance work in C:\dev\allegra on feat/native-queue-engine. Read C:\dev\allegra\.planning\performance-kotlin\CLAUDE-HANDOFF.md, applicable AGENTS/CLAUDE rules, MASTER-PLAN.md and LUNA-VERIFICATION.md, then inspect git status and git diff 10f1e0c73e60094059fc0ac913f350f525d6ed83. Preserve all local changes and new source files; do not reset or switch branches. Lyrics geometry and the UI activity/callback slice are implemented and locally checked, but device/performance acceptance is open. Two concurrent lyrics-service edits appeared during handoff and are not covered by those earlier tests; review and coordinate their ownership before further writes. Then finish the documented shared PillPlayer hidden glow/cover-rotation fix; it has not been coded. Keep playback/queue/Connect/design unchanged, verify callers with graft, run separate mobile gates, and report actual device evidence or limitations. Proceed through the master plan one measured vertical slice at a time. No APK, commit, push or deployment has been made by Codex.
