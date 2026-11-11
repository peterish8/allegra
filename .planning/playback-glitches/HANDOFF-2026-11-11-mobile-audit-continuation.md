# Detailed Handoff — Allegra Playback, Mobile Audit, and Playlist Reordering

**Updated:** 2026-11-11 (Asia/Calcutta)  
**Repository:** C:\dev\allegra  
**Branch:** fix/playback-skip-glitches  
**HEAD:** 9081dea8 — fix(mobile): reset the playhead on skip, one previous path, classic bar lyrics after quick skips (1.45.2)  
**Working app version:** 1.45.3  
**Commit/push:** implementation is uncommitted. No merge, push, APK build, release, or deployment occurred.

## 1. Read first

Read in this order:

1. This handoff.
2. .planning/playback-glitches/PLAN.md — original playback defect list and acceptance plan.
3. AGENTS.md and CLAUDE.md.
4. apps/mobile/AGENTS.md, apps/mobile/CLAUDE.md, and apps/mobile/DESIGN.md.
5. docs/architecture.md, docs/api-contract.md, docs/workflows.md, and apps/mobile/README.md.
6. The older .planning/playback-glitches/HANDOFF-2026-11-11-skip-glitches.md.
7. User audit prompt: C:\Users\nithy\.codex\attachments\5a5b9f5b-1628-4234-a616-9ab715c73d86\Pasted text.txt, if accessible.
8. Recheck git status --short --branch, git diff --stat, remotes, and live source before editing.

Use Graft before source exploration/refactoring; verify coverage if graph results conflict with source. Audit snapshot line numbers may be stale.

## 2. Project context and commands

Allegra is a monorepo. This task spans Expo/React Native and Kotlin Media3 in apps/mobile, the Node API in apps/api, the React web app in apps/web, and shared Connect queue logic in packages/connect.

From the repository root:

    npm install
    npm run typecheck
    npm run lint
    npm test
    npm run mobile:check

Install only at the root. Required root gate: npm run typecheck && npm run lint && npm test. Kotlin tests from apps/mobile/android:

    .\gradlew.bat --no-daemon '-Dorg.gradle.jvmargs=-Xmx1536m' :app:testDebugUnitTest

Use the documented local app at http://localhost:5173 for visual checks. Check API health at http://localhost:8080/api/health before starting duplicate servers. Do not run production release/deploy workflows as tests.

## 3. Goal and current status

The user wants the playback skip/queue defects completed, the supplied P1–P5 phone-app audit addressed, playlist song reordering made easy and responsive across lists longer than one screen, and an itemized completion report. Playback, API security, account-scoped outbox, signing safeguards, Genius token removal, and some library/playlist improvements have code changes in this dirty worktree. The new audit changes have not had the full regression gates rerun. Several P2/P3 tasks and all physical-device/performance acceptance remain incomplete. The latest user instruction was to write this handoff and stop; no implementation, tests, commit, or push followed that instruction.

The last known origin/main was f2223c66143f02d2d871d783b1029bf3b5e783f4. Recheck it. That main revision has tracked audit/CODEBASE-KNOWLEDGE.md, audit/FIX-BACKLOG.md, and docs/current-codebase.md. This worktree has untracked copies at audit/ and docs/current-codebase.md. Preserve local copies before integration; reconcile with the newer upstream docs rather than overwriting either set.

## 4. Decisions and approvals

| Date | Decision | User wording / status |
|---|---|---|
| 2026-11-11 | At 10 seconds, a right cover swipe restarts the current song. | User answered “Restart this song”. Approved. Keep the 3-second previous-button restart threshold consistent. |
| 2026-11-11 | Make playlist editing easier, faster, snappier, and able to drag past one viewport. | User described it as glitching and unable to drag more than one screen of songs. Approved; only partial implementation and no device proof yet. |
| 2026-11-11 | Finish the broader audit, bump, commit, and push/merge main. | User explicitly requested “commit all work” and “push to main”. Approved earlier. |
| 2026-11-11 | Most recent instruction to this session: write the skill-based detailed handoff and stop. | Followed; this session did not commit/push. |
| 2026-11-11 | Do not expose real secrets or alter production credentials. | From supplied audit prompt. Still binding. |

The attached audit initially said not to commit/push/publish/deploy; the user later explicitly authorized commit and push. A push to main triggers .github/workflows/mobile-apk.yml. Do not manually dispatch a release. Keep signing fail-closed and report workflow effects. Do not inspect, print, rotate, or guess secrets or signing material.

## 5. Work already in the worktree

### Playback and queue behavior

Source changes cover explicit skip playhead reset, shared previous/next routing, right-swipe restart behavior, stale status protection, mini-player skip motion, marquee direction, Up Next following, native list interaction signaling, web media-event/recovery guards, shared queue rules, and motion tokens.

Main paths: apps/mobile/src/store/playerStore.ts, contexts/PlayerContext.tsx, components/MiniPlayer.tsx, PillPlayer.tsx, NowPlayingControls.tsx, screens/NowPlayingScreen.tsx, components/player/UpNextPanel.tsx, components/player/NativeQueueList.tsx, Android NativeQueueListModule.kt and NativeQueueListView.kt; apps/web/src/hooks/useAudioPlayer.ts, App.tsx, PlayerPanel.tsx, motion/index.ts and styles/global.css; packages/connect/src/queueRules.ts.

New focused helper tests include mobile playback/positionPrediction.test.ts, playback/swipeRule.test.ts, player/queueFollow.test.ts, web audioPlayerRules.test.ts and motionGuards.test.ts, and packages/connect/src/queueRules.test.ts. The original full checklist is in PLAN.md. These must be rerun after current audit changes.

### Playlist reorder request

apps/mobile/src/screens/PlaylistDetailScreen.tsx now configures explicit drag autoscroll threshold/speed, item overflow while dragging, custom-order edit entry with search cleared, haptic feedback, and reloads saved data after failed reorder persistence. There is no focused regression test yet. Dragging several screens down and back, cancellation, and device feel are not verified. Mark partial.

### P1 account/server fixes

- apps/mobile/src/database/db.ts, database/syncQueries.ts and services/sync/LibrarySync.ts add account_user_id to play outbox rows and freeze account/token generation for a sync attempt. Legacy unowned rows stay unowned. Regression tests were added in syncQueries.test.ts and LibrarySync.test.ts; rerun them.
- Root package.json overrides body-parser to 2.4.0. apps/api/src/app.ts and oauth/router.ts disable compressed request inflation; new app.bodyParser.test.ts covers compression and normal requests. Verify installed and lockfile resolution before claiming complete.
- apps/api/src/oauth/clients.ts bounds DNS, fetch, and streamed metadata body under one deadline/size cap, rejects redirects, and cancels bodies. New oauth/oauth.test.ts fixtures cover timeout, size, redirect, and valid metadata; rerun.
- apps/api/src/lib/logger.ts and app.ts use allowlisted request serialization; new lib/logger.test.ts uses fake credentials. Logging middleware is mounted before routes, but no production secret exposure was established. Do not inspect production secrets.

### P1 signing, Genius, and library work

- .github/workflows/mobile-apk.yml, apps/mobile/android/app/build.gradle, scripts/mobile-signing-policy.mjs, and tests/infra/infra-files.test.mjs add a main-release private signer requirement, public certificate fingerprint comparison, APK signature check, separate PR/debug signer, and non-cancellable workflow concurrency. The current public APK signer was not inspected and required owner configuration is unverified.
- apps/mobile/app.json is bumped from 1.45.2 to 1.45.3. Gradle derives versionCode 1,045,003 from 1.45.3. Installed device compatibility and signer continuity are unverified.
- Genius token-dependent search and public bundle wiring were removed in apps/mobile/src/services/GeniusService.ts, types/providerResponses.ts, apps/mobile/README.md, and the workflow. Public scraping/conversion remains. A fake-marker export scan remains.
- apps/mobile/src/screens/LibraryScreen.tsx and new screens/libraryCollections.ts/test.ts add pre-indexed artist/album grouping and FlashList. Verify counts, navigation, empty states, accessibility, and large-library behavior.

### P3 work begun

apps/mobile/src/navigation/v6Shell.ts and v6Shell.test.ts make JS shell navigation height respond to font scale. Native V6TabBar.tsx/NativeTabBarView.kt geometry and uncapped SP support are not complete. Mini-player Reanimated changes exist but the complete busy-JS, cancel, RTL, reduced-motion, and accessibility journey is unverified. Do not re-enable the prior Android tab animation until the old native scene flash/lifecycle cause is fixed.

## 6. Artifacts

| Path | Purpose |
|---|---|
| .planning/playback-glitches/PLAN.md | Original playback audit and acceptance plan. |
| .planning/playback-glitches/HANDOFF-2026-11-11-skip-glitches.md | Older playback handoff; this document supersedes its status. |
| .planning/playback-glitches/HANDOFF-2026-11-11-mobile-audit-continuation.md | Current status, verified facts, remaining work, and execution plan. |
| .planning/playback-glitches/STARTER-PROMPT-mobile-audit-continuation.md | Cold-start prompt for the next agent. |
| User attachment path in §1 | Full P1–P5 checklist. |
| .planning/recommendations/ | Unrelated untracked Quick Picks proposal; preserve and do not stage. |
| audit/ and docs/current-codebase.md | Untracked local audit/map copies; preserve and reconcile with upstream tracked docs. |

## 7. Verification and handoff state

The following results are historical, from before the latest audit/security/playlist additions; they do not verify the current worktree:

- Root typecheck, lint, and npm test passed for the earlier playback-only changes.
- mobile:check passed earlier with 162 suites / 1,288 tests, before the latest additions.
- git diff --check passed before the most recent additions.
- A prior Android Gradle attempt failed on malformed PowerShell/JVM argument parsing before compiling source. It is not a Kotlin test result.
- Browser CUA attempts failed with a kernel asset path error; localhost:5173 was not running then.
- Earlier emulator smoke had an ADB TCP connection refusal; treat as runner reliability unless logs show an app crash/assertion.
- No APK was built or published; no emulator/physical device validation or performance baseline exists.
- Do not inspect, print, or record any real secret.

Rerun focused tests, then root typecheck/lint/test and mobile:check; run Kotlin unit tests with the command in §2. Verify the fake Genius marker is absent from an Android export. Browser-check web at 360, 768, 1280, and 1920 widths. Do not claim device or performance results without measurement.

## 8. P1–P5 status

Status: Fixed means source and focused verification are complete. Partial means code exists but acceptance is incomplete. Open means implementation remains. Blocked means external owner/device action is needed.

| Audit item | Current status |
|---|---|
| Playback skip/queue task | Partial pending complete current rerun and visual/device acceptance. |
| Playlist long-list reorder | Partial: tuning and failure recovery added; test and device drag verification missing. |
| P1-A signing | Partial: fail-closed code exists; current signer and owner secrets/fingerprint must be verified. |
| P1-B account outbox | Partial: migration, generation guards, and tests added; rerun pending. |
| P1-C body parser | Partial: override, inflate false, tests added; verify resolution/lock and rerun. |
| P1-D OAuth metadata | Partial: deadline, stream cap, cancellation, and fixtures added; rerun pending. |
| P1-E logging | Partial: allowlist and fake-secret test added; rerun pending. |
| P2-F updater release identity/digest | Open: mutable latest URL and fixed staged filename remain; identity/digest eligibility binding absent. VersionCode bump exists. |
| P2-G MediaSession policy | Open. |
| P2-H network recovery episode | Open: current onAvailable may resume despite no real network loss. |
| P2-I serialized queue empty/tombstone | Open: empty save skipped and clear is outside serialized writer. |
| P2-J native Up Next cost | Partial: interaction signals exist; visible-row caching/large-queue measurement absent. |
| P2-K Genius token | Partial: token path removed; fake-marker compiled bundle scan missing. |
| P2-L atomic APK promotion | Open: inspect workflow promotion; versioned candidate/verification/rollback absent. |
| P3-M virtualized library | Partial: FlashList/indexing code added; test/visual/a11y/perf verification pending. |
| P3-N mini-player UI-thread drag | Partial: work exists; busy JS, cancel, RTL, reduced-motion and device acceptance missing. |
| P3-O safe tab continuity | Open: diagnose native scene flash before reintroducing transitions. |
| P3-P large text tab bar | Partial: JS shell scaling only; native SP/bar/touch geometry missing. |
| P4 regression journeys | Partial: tests added; full current gates and device cases missing. |
| P5 baselines | Blocked until a release device and measurements are available. |

## 9. Known problems and exact evidence

- Queue persistence: apps/mobile/android/app/src/main/java/com/lyricflow/app/playback/QueueEngine.kt:229-235 deletes store directly; :410-443 returns early when mediaItemCount is zero. Serialize snapshots and tombstones through one writer; add clear-during-write, remove-last/restart, and deleted/hidden local item tests.
- Network recovery: apps/mobile/android/app/src/main/java/com/lyricflow/app/services/PlaybackService.kt:185-215 registers onAvailable and may resume without observing a true offline-to-online transition. Model bounded episode/loss/usable restore; clear on pause, stop, track change, service teardown, and expiry.
- Updater: apps/mobile/src/services/appUpdate.ts:11-16,130-147 and Android RescueActivity.kt:137,256-257 use mutable apk-latest. AppUpdateWorker.kt:16-65 stages a fixed filename from only a URL. Bind release identity/version and trusted digest through eligibility, WorkManager, staged file, retry, and install; preserve package and signer checks.
- MediaSession: no explicit role/command policy has been added. Use supported Media3 trust APIs, preserve system surfaces, and do not guess based on package names.
- P2J: native list currently lacks measured large-queue parsing/ellipsize optimization; do not claim frame improvement without timing.
- Release workflow: concurrency is non-cancellable and signing checks exist, but atomic stable-channel promotion/rollback is not proven.
- Large type: shell helper is only one half; align JS and native geometry at 100%, 130%, 200%, and smaller screens.
- Playlist: auto-scroll values exist but no test proves a drag can cross several screen heights.
- Integration: last known main has tracked docs that conflict by path with local untracked snapshots. Preserve and reconcile.
- Environment: prior CUA browser tool failed due kernel asset path and server was down. Prior ADB TCP refusal is not a product defect by itself.

## 10. Remaining implementation plan

Complete small vertical slices and verify each before moving on.

1. Recheck live status/remotes and review every tracked and untracked change. Preserve recommendations and local audit copies. Integrate current origin/main safely; do not reset/clean.
2. Close P1 and playback regressions. Run focused API/sync/player tests; verify actual body-parser resolution and lockfile; fix failures; run root and mobile gates.
3. Finish playlist drag UX. Add a regression for custom-order edit mode, long-list autoscroll configuration, and failed persistence recovery. Confirm search clears before editing and saved order matches dragged order. On device drag rows several screens down and back; verify cancel, feedback, and failure path.
4. Complete updater and release channel together. Define immutable version/commit metadata and SHA-256 manifest; thread through update eligibility, worker progress/result, staged file/metadata, retry, ready UI, RescueActivity, and install. Revalidate digest, release identity, package and signer at install. Add cases for current/older/unknown release, changed channel, wrong digest, staged identity mismatch, and failed retries. Build immutable versioned artifact first; promote latest pointer serially only after validation; retain rollback and old pointer on failure.
5. Fix recovery with testable episode state: ignore already-active onAvailable, require a real loss and usable restoration, bound the episode, and clear on listener pause/stop, track change, teardown, expiry. Preserve capped retries and expired-link refresh.
6. Serialize queue snapshots and empty tombstone writes through one persistence owner. Ensure old writes cannot recreate a cleared queue. Reject restored local items missing from current library. Add deterministic clear/write race, remove-last, restart, deleted/hidden item tests.
7. Add Media3 controller role/command policy. Preserve notification, lock-screen, Bluetooth/headset, Auto and Wear behavior. Restrict unrelated queue mutation with supported trust/role APIs, not package allowlists. Add native tests and device validation.
8. Reduce Up Next UI-thread parsing/ellipsize via visible-row cache or immutable off-thread prep, invalidated by width/font/content/handle state and protected by generation/lifecycle. Preserve accessibility, reorder and filtered indexes. Add large-queue check and measure.
9. Finish P3-M/N/P: verify virtualized artist/album experience; test mini drag under busy JS, cancel, RTL, reduced motion and accessibility; make JS/native tab font and hit geometry agree at 100/130/200% and narrow screens.
10. Diagnose P3-O old native scene flash; fix lifecycle issue before adding short opacity transition. Keep player shell mounted and respect reduced motion.
11. Run P4 journeys: account A offline then B login; updater channel change across failure/reopen; clear last queue row during save then restart; still-online stream failures and explicit pause; large queue/library; rapid controls/seek, audio focus, route, background/foreground/process death; TalkBack, Reduce Motion, large type, narrow screen; system controllers.
12. Capture P5 device/API-level baseline with p50/p95 cold launch, frame misses, artwork decode, queue update, memory, battery, and recovery; record device and setup. Do not claim optimization without comparison.
13. Review all diffs and docs; verify version compatibility, released versionCode and signing continuity. User previously authorized bump/commit/push. Main push triggers the APK workflow; never dispatch release manually. If owner signing configuration/fingerprint is missing or mismatches the current public signer, leave release fail-closed and state owner action. Report exact commit/push and all check results.

## 11. Open questions and defaults

- Current public signer and owner private signing configuration are unverified. Default: do not rotate or substitute a debug key; ask owner to confirm public SHA-256 and configure secrets/ANDROID_RELEASE_CERT_SHA256 via secure repo settings.
- Release pointer format is open. Default: immutable versioned APK plus digest manifest and serialized pointer promotion with rollback.
- Media3 trusted external controller definition is open. Default: use official Media3 controller trust APIs and preserve Android system surfaces; no package-name guesses.
- Restoring local songs no longer in library: default to drop stale local IDs, while preserving remote/stream validation behavior.
- No device is verified. Default: run deterministic tests and label device-dependent acceptance as blocked if no device can connect.

## 12. Guardrails and continuation

AGENTS.md says read CLAUDE.md, follow architecture/API docs, work one issue at a time in vertical slices, and verify before claiming done. API contract changes require proposing first. Preserve Media3 ownership and user command routing. Preserve every unrelated dirty/untracked file; never reset or clean. Keep root-only install. Never print/copy real credentials or rotate production settings. No manual release/deploy workflow.

Start from live Git state, then follow the numbered plan. Final response must contain a simple P1–P5/playback/playlist table with fixed/partial/blocked status, exact changed files and migration/version implications, exact checks, device evidence, and owner actions. This handoff is a status snapshot, not evidence that pending work passed.

