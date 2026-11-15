# Allegra handoff: credit stop, PR integration and Stream updates (2026-11-14)

## 1. Read first
1. This file. It supersedes operational status in the older handoff.
2. C:/dev/allegra/docs/current-codebase.md, C:/dev/allegra/CLAUDE.md, C:/dev/allegra/AGENTS.md.
3. C:/dev/allegra/apps/mobile/CLAUDE.md, apps/mobile/DESIGN.md, apps/mobile/src/ui/AGENTS.md.
4. .planning/frontend-polish/run/HANDOFF-2026-11-14-orchestrator.md (historical context; its versions, merge modes and wait commands are outdated).
5. .planning/frontend-polish/PLAN-v2.md; run/WORKER-PROTOCOL.md; run/LEDGER.md; run/OWNER-TODO.md; relevant run/tasks/*.md.
6. .planning/echo-backend-port/README.md and the individual plan for any backend item.
7. pause-2026-11-14/worktrees.json, pull-requests.json, apk-release.json and agent-reports.json next to this handoff. These preserve exact checkout provenance and saved agent activity.

## 2. Project context
Repo C:/dev/allegra, origin https://github.com/peterish8/allegra.git, default main. Web Next/React in apps/web; Express API in apps/api; Android Expo/React Native and Kotlin Media3 in apps/mobile; Windows wrapper in apps/desktop; optional island APK in apps/island.
Shared checkout is STILL fix/web-auth-dialog-focus at 8a084c077b434a5d537222525ebf7276b97567dd, with unrelated dirty files. Its local app version is 1.60.0; this is NOT main or the published APK version. Do not pull, reset, checkout, stash or indiscriminately commit in that checkout.
Fetched origin/main at pause: 6a7873a552e22cd3d48caa84a71975c299096187, source mobile version 1.64.5. Latest published apk-latest release is 1.64.3, published 2026-11-13 18:48:33 UTC from 1f58d23. Main source, PR artifact and published release are separate facts.
Root commands: npm run typecheck; npm run lint; npm test. Then npm run mobile:check, sequentially after Convex tests finish. Mobile owns its own lockfile. No local Gradle or emulator per owner. npm run dev serves web :5173 and API :8080; check health before starting another server.

## 3. Goal and current status
Finish authorized frontend polish, selected Echo-inspired backend improvements, push/merge green PRs with serialized mobile version bumps, and safely remove completed worktrees. Latest owner addition: replace mobile Stream explanation with Devices then a rounded LuvLyrics logo at the top right; logo opens an updates-only dropdown retaining actual latest release notes after updating. Owner then explicitly STOPPED all agents due to low credits and requested this handoff. No more implementation, merges or cleanup was performed after that stop. All 11 delegated task families were cancelled; saved completed results remain. PR watches for #123 and #129 were removed (#124 was already unwatched). Active-thread inspection showed only the parent running. Do not automatically restart workers from old run instructions.

## 4. Decisions and approvals
| Date | User words / instruction | Status and effect |
|---|---|---|
| 2026-11-14 | "u do mainain all neatly and push merge and del worktrees if done continue all those subagents now" | Approved push, merge on green checks and completed-worktree cleanup; preserve unfinished work. |
| Historical, supplied 2026-11-14 | "whatever worktrees old ones see through it polish it and then just merge those and del those worktrees" | Approved auditing and integrating old work before deletion. |
| Historical, supplied 2026-11-14 | "give tnis work to a agent luna 6 xhigh" | Requested Luna xhigh for sweep. No silent model substitution. |
| 2026-11-14 | "remove tat completely" / "two btns" / "updates only" / "even after updating it shld shwo whats the chanegs" | Approved Stream header and persistent latest release notes; full spec below. |
| 2026-11-14 | "as ur low of credits stop all agents ... properly do $detail-handoff" | Latest controlling instruction: stop agents and preserve work. |
| Prior run, see older handoff | No local Android emulator/Gradle; CI gates; review at end | Continue these restrictions. Actual phone proof stays pending. |
| Prior conversation recorded in merge-captain brief | Regular merge commits, no squash/rebase merge | Use regular merge despite root CLAUDE.md's generic squash convention. |
| Open | Drop Albums tab (M12) despite failed evidence gate? | Keep HOLD. No removal approved. |

On a future explicit continuation, authority to finish, bump, push and merge remains; do not ask again for routine authorized actions. Budget stop takes precedence now. No new credit-consuming workers until the user resumes.

## 5. What was done
- Recovered ten interrupted workers in their SAME threads/worktrees after provider switch, then stopped them again at owner's request. Started one isolated Stream-header worker, now stopped before any implementation.
- Merged #124 Last.fm RULES ONLY as 9e898611ac2e7213d0f07396166130ed33b7ec8f, version 1.64.5. Full Last.fm account linking/scrobbling is not built. Reviewer fixed fully accepted batch responses without per-entry detail being retried. Parent ran shared scrobble tests: 9/9 pass. Worker reported Last.fm provider tests 20/20.
- Safely removed C:/dev/allegra-lastfm-rules plus local/remote feat/lastfm-rules. Explicit main ancestry checked first. Workspace junctions inside its real node_modules were removed non-recursively. Main status/dependencies unchanged afterward.
- Merged #129 web mid-song recovery as 6a7873a552e22cd3d48caa84a71975c299096187 after all 3 checks passed at 1d7b44af637172a25f4ef2db0c1f0610e8a1e9ee. Vercel comment was a Ready preview notification, no defect. Cleanup remains.
- #129 reviewer fixed a seek during recovery being overwritten. Bounded two recoveries per song; 3-second threshold; 1-second floor; pause/skip respected. Reported typecheck, lint and 394/394 web tests pass. No real stream-cut browser check.
- #123 rebased after #124; conflicts resolved retaining BOTH scrobble.ts and trackVersion.ts in scripts/sync-shared.mjs. Version 1.64.6; pushed head 88c69ef365f28114a6cb7d60af807f2bc79cb9bd; shared trackVersion tests 21/21 reported. Unmerged.
- Earlier #125 stream resolver hardening merged 804841d153247551da9c85003cf2570aea089924; worktree removed before this pause. Case-sensitive stream:v2 keys, refusal memory/dead-song backoff; do not silently downgrade bitrates under the same Range identity.
- Sweep removed many old merged/superseded worktrees. Player-release removed after comparing album/release/search source to main; dirty mobile-lane preserved. Discovery investigation remains.
- Captured actual worktree, PR and APK metadata in pause-2026-11-14. No new tests or builds were run solely for writing the handoff.

## 6. Where everything lives
Every PR URL is https://github.com/peterish8/allegra/pull/NUMBER. Exact full SHAs/status/check runs: pause-2026-11-14/pull-requests.json.
| PR / work | Branch / path | Status |
|---|---|---|
| #123 track-version | feat/shared-track-version; C:/dev/allegra-track-version | Clean at 88c69ef3; 1.64.6; CI pending at snapshot. |
| #126 plain lyrics | feat/mobile-found-online-lyrics; C:/Users/nithy/.t3/worktrees/allegra/t3-8451adb0-8c16b28a6e7fe2cf | Clean 2c84f040; open; version still 1.64.4. |
| #127 Blend M7a | fix/mobile-blend-polish; C:/Users/nithy/.t3/worktrees/allegra/t3-fbad25f8-4a2b2ecc71dc236c | Clean 018cb438; open; version 1.64.4. |
| #128 nav scaling M10 | fix/mobile-nav-label-scaling; C:/Users/nithy/.t3/worktrees/allegra/t3-978e65c4-cf4d18c36ef240d9 | Clean 8d6065b4; open; version 1.64.4. |
| #130 Luvs M6 | fix/mobile-luvs-motion; C:/Users/nithy/.t3/worktrees/allegra/t3-a40e9216-8ae8d8ad69defaca | Clean f49fef05; open; version 1.64.4. |
| #131 LuvLink/import M7b | fix/mobile-luvlink-import-polish; C:/Users/nithy/.t3/worktrees/allegra/t3-617ae0f1-5303f8b3145ce152 | Clean b75fb949; open; version 1.64.4. |
| M1 mini player | fix/mobile-mini-player-polish; C:/Users/nithy/.t3/worktrees/allegra/t3-215f79ea-2de6c3af239fa799 | Clean committed c6b9f1fe; version 1.64.5; no PR in open snapshot; final check interrupted, verify whether pushed. |
| M2+M3+one Devices sheet | fix/mobile-player-connect-polish; C:/Users/nithy/.t3/worktrees/allegra/t3-e0109042-c4f2e9754b70e46c | DIRTY: 21 modified source/guard files plus untracked ConnectDropdown.test.ts, base e509de17. Full gate interrupted. |
| Older one Devices sheet | fix/mobile-one-devices-sheet; C:/dev/allegra-mobile-lane | DIRTY ConnectDropdown.tsx plus untracked ConnectDropdown.test.tsx. Reconcile with group worker, do not discard. |
| Stream header new request | t3/stream-updates-dropdown; C:/Users/nithy/.t3/worktrees/allegra/t3-194afcaf-c859279f9eb95409 | Clean at 6a7873a5; worker read guidance; NO feature code yet. |
| Discovery old work | feat/discovery-polish; C:/dev/allegra-discovery-polish | Clean c7dd4301, 7 commits ahead / 49 behind during sweep; compare patches to current main before transplant. |
| M12 Albums HOLD | chore/mobile-library-drop-albums; C:/Users/nithy/.t3/worktrees/allegra/t3-d695b735-0fa0ae89d26a85cd | Clean e509de17; no changes; evidence gate failed. |
| #129 cleanup | fix/web-midsong-recovery; C:/dev/allegra-web-recovery | Clean 1d7b44af; merged; worktree and branch still present. |
| #84 stale | feat/mobile-player-transition, remote head d6c5d4f | Still open; no local matching worktree. Leave open unless owner authorizes closing. |

Source pointers for new request: apps/mobile/src/screens/StreamScreen.tsx (StreamScreen at line 91 in old root snapshot); components/about/UpdatePanel.tsx (Notes at line 47); services/appUpdate.ts (ReleaseNotes at line 24, LatestBuild at line 32, parseChangelog at line 114). These line numbers came from old root Graft lookup, not a fresh source audit of main; re-query in active checkout.
Echo plans: .planning/echo-backend-port/*.md, untracked in shared checkout. Preserve all 13 files.
Worker threads/links, task IDs, stopped statuses and last activity are in pause-2026-11-14/agent-reports.json. Context source thread: 50707311-de72-42ef-b8f9-612ecf7817f4; use t3_thread_read to recover omitted reports. No need to restart agents to read their saved messages.

## 7. How to work with artifacts
Read worktrees.json before touching any branch. Refresh with git fetch origin, git status --short, git worktree list --porcelain, gh pr view N --repo peterish8/allegra --json state,headRefOid,mergeStateStatus,statusCheckRollup,reviews.
Use existing worktrees, preserve dirty work, and inspect both local/remote commits before rebasing. No force push except an intentional rebase with --force-with-lease after checking current remote head.
On continuation: rebase ONE mobile PR onto current main, then bump apps/mobile/app.json expo.version above current main (patch fixes, minor features), run required gates and push. Old green checks do not cover a new rebase/version commit.
For packages/shared changes run npm run sync:shared and inspect semantic parity, not only line endings. Rebase of #123 must retain scrobble.ts AND trackVersion.ts.
Merge regular commit only with exact head guard, e.g. gh pr merge N --repo peterish8/allegra --merge --match-head-commit SHA. Link immediately after create/push. Parent watches PR checks, delegates never watch. No polling loops or gh --watch.
Cleanup: check absolute target is exactly the intended worktree; ensure clean and merged/patch-equivalent; enumerate reparse points without following them; delete junctions non-recursively; confirm main node_modules and root status unchanged; git worktree remove PATH without --force; git branch -d BRANCH only after merge verification. A real node_modules can contain workspace junctions too. Never recursively delete through one. Delete remote branch only for the merged PR and after head verification.
No cleanup is authorized while current stop remains in effect.

## 8. Verified facts and evidence tiers
Live GitHub and Git snapshots were collected on local date 2026-11-14 (GitHub timestamps UTC 2026-11-13).
- #124 and #129 merge SHAs verified with gh pr view. Main source 1.64.5; published apk-latest 1.64.3, not 1.64.5/1.64.6.
- Open PR snapshots #123/#126/#127/#128/#130/#131 contained pending checks and zero failed checks at capture. They may have finished since. #84 is stale; no runtime inference.
- Worker reports: #126 root typecheck/lint, mobile TS, 73 focused tests across 8 suites pass; plain lyrics via Allegra API, estimated auto-scroll. Full phone feel unverified.
- #127 mobile:check 208 suites / 1,670 tests, 0 lint errors / 161 warnings; focused 23; TS pass.
- #128 mobile:check 207 suites / 1,669 tests, focused 28; TS pass. Kotlin SP geometry tests added for 100/130/200% font scale. No local compile/emulator.
- #130 mobile:check 208 suites / 1,673 tests, focused 31; TS pass; Reduce Motion for equalizer/camera/hints/artwork; baselines lowered.
- #131 mobile:check 208 suites / 1,670 tests, 0 errors / 160 warnings; focused 23; TS pass; destructive Spotify disconnect sheet, tactile accessible controls.
- These are saved worker-reported automated results, not parent reruns or device proof. Snapshot JSON does not contain all full test logs; read worker thread activity for exact logs.
- M1 and grouped M2/M3 suite was interrupted; do not claim final green on current heads.
- Stream dropdown worktree is clean: no implementation yet.
- C: at pause had 17,701,216,256 bytes free (about 16.49 GiB). Earlier observed 17.69 GiB, so refresh rather than quoting that as current.
- No new phone, audible-sync, TalkBack, visual, frame-rate or production playback validation.

## 9. Known problems and findings
- Root ledger table is stale and still labels previously merged cards queued/running. Later appended notes help but Git/GitHub are authoritative. Preserve it, reconcile it at final documentation step.
- Root's three web test files show modified status with no semantic diff in diff --stat. Treat as unrelated line-ending/index noise; do not commit them.
- Two competing dirty ConnectDropdown implementations exist; carefully reconcile older lane test .tsx and group test .ts; do not overwrite either blindly.
- #126 edits NowPlayingLyricsArea/SynchronizedLyrics/ConnectRemotePlayer, overlapping grouped player/Connect files. Integrate sequentially, rerun behavior tests after conflict resolution.
- M1 also shares player dependencies with group work. Keep its seven-path scope; source tests/guard baselines may conflict after all merges.
- #129 cannot guarantee every truncation becomes recoverable: some browsers shorten duration on early EOF. No real cut test. Repeat-one retains per-song recovery counter.
- #125 backlog BE-001 not marked fixed; historical report says known-dead preview check and explicit 60-second expiry test were not run.
- APK publication lags main. Diagnose main Mobile APK publication workflow and signing before claiming a newer downloadable release. PR APKs can be debug-signed; they are not the production update.
- Older folder/island caveats remain: folder backups are second copies, deletion does not remove folder copy; island add-on needs separate installation and device checks; update behavior on old 1.60.0/1.60.1 installs required manual update. Revalidate against current source before changing.
- End-of-run independent review not done. No false device or CI claims.

## 10. Remaining work, prioritized
1. Preserve this stopped state until user resumes. Keep agent and PR watches off.
2. On continuation, audit release publication lag and finish #123 (1.64.6 if main version unchanged). Done: final-head checks pass, regular merge, main checks/release evidence separately recorded.
3. Integrate existing mobile PR queue #126 -> #127 -> #128 -> #130 -> #131, one at a time, each with final rebase/version bump and fresh gates. #126 is a feature: minor bump; later fixes patch from whatever main actually is.
4. Finish M1 from c6b9f1fe, then grouped M2/M3/CONNECT-ONE-SHEET from dirty worktree after reconciling legacy mobile-lane patch. Done: tested PRs, no duplicate picker, existing routing preserved.
5. Implement new Stream header/dropdown in its existing clean worktree. Requirements below; ship as its own PR.
6. Finish discovery audit: distinguish patch-equivalent/superseded code from genuinely missing functionality before porting. Do not merge the old seven-commit branch wholesale.
7. Safely remove #129 worktree and future completed worktrees after verified merge. Keep M12 HOLD unless explicitly overridden.
8. Reconcile every AUTO card against live merged PRs and PLAN-v2, including M11 playlist grid/list toggle, P5 and FINAL. Do not redo merged W11 (#112). W9/P6 HOLD.
9. Complete backend plans only within their approved scope; see next section. No presumption all plans already shipped.
10. Finish run ledger, owner checklist, guard before/after counts, end-of-run review and factual release report.

## 11. Next-agent plan and acceptance checks
A. First refresh Git, PR heads/checks and release metadata. Read saved reports without relaunching workers. Keep shared checkout dirty work intact.
B. #123: verify exact head/version, sync parity and 21 trackVersion tests; root gates and mobile gates as required; all final-head CI checks including APK/emulator. Merge and cleanup safely.
C. Each existing mobile PR gets one independent integration slice. Rebase, preserve both sides of overlapping files, bump version, targeted behavior tests plus mandatory gates, inspect UI when allowed; phone-only proof stays pending if unavailable. Link/push/watch then regular merge on green. Release checks separate.
D. M1 and grouped player work: inspect committed/dirty diff first. Resume from saved patches; final mobile gate was interrupted. Reconcile both Devices picker implementations. Playback invariants, no changed sheet physics, baselines only decrease. No new blanket tests mirroring implementation.
E. Stream header spec: entirely remove Stream explanation entry/experience (keep shared explanations used elsewhere); top-right two existing-sized tactile controls, Devices LEFT, rounded real LuvLyrics brand logo RIGHT. Devices action retains routing. Logo opens a neat anchored updates-only dropdown, real current/latest version and changelog categories/items (features/fixes), actual update/install action as applicable. Latest release notes remain visible when already updated, after reopening; no fabricated changelog or updateAvailable gate hiding notes. Reuse real release feed/changelog.json and existing safe native updater; token colors/spacing/type/radii/motion; Reduce Motion; accessible labels/targets; Android Back/outside-tap dismissal; bounded scrolling and font scaling; loading/error/empty/retry states. Focused regression for current==latest notes visibility. Version bump at integration, root/mobile gates and CI. No local Gradle/emulator.
F. Backend master plan inventory:
- P1-1 Android disk stream cache and resuming data source: no implementation verified; read P1-1-android-stream-cache.md; native tests/Range/security/version gates.
- P1-2 web portion merged #129; Android cutoff guard remains unverified/unbuilt here. Read P1-2-premature-end-recovery.md; coordinate after cache slice.
- P1-3 Last.fm: rules only merged #124; Convex -> API -> web -> mobile remain. Read P1-3-lastfm-scrobbling.md; auth/secret handling, provider acceptance/retry behavior, scrobble timing tests; no claim feature complete.
- P1-4 Actions pins and Dependabot merged #118/#117 (live merged list checked); verify CodeQL remainder, do not redo configs. Read P1-4-supply-chain-ci.md.
- P2-1 diagnostics merged #121; verify current implementation against plan before adding anything.
- P2-2 resolver merged #125; close documented acceptance gaps/backlog evidence without relaxing Range/206.
- P2-4 #123 pending. Shared module alone does not prove all provider matchers use tags.
- P2-3 BYOK lyrics translation, P2-5 Paxsenix probe: plans only unless live code proves otherwise. Read exact corresponding files; no provider integration on assumptions.
- P3-1 proxy mid-body resume: gated on diagnostic evidence; do not start speculatively. OPTIONAL-FEASIBILITY.md and REJECTED.md record parked/do-not-port items.
G. Reconcile remaining frontend tasks via PLAN-v2 and merged history. FINAL requires before/after guard counts, PR/version list, open holds, owner decisions, and honest phone checklist. End-of-run review only after authorized continuation/budget is available.
H. Preserve untracked planning docs and write scoped docs commits from an appropriate branch after code integration. Do not commit unrelated root tests.

## 12. Open questions and defaults
- Albums tab: keep HOLD. Local data supports albums, no evidence on completeness/usage; owner has not overridden gate.
- Stale #84: leave open and report, do not close automatically.
- Duplicate old/new Connect patches: preserve both until behavior comparison, favor current grouped implementation only after equivalence and tests.
- Latest APK lag: inspect workflow, do not relabel/reupload arbitrary PR artifacts.
- Folder delete semantics/private PR signing/island settings entry: preserve current behavior; record owner follow-ups.
- Credits: no new workers now. A new session should confirm user has resumed before billable delegation; use solo continuation by default if unclear.

## 13. Rules and guardrails
Source: root CLAUDE.md, apps/mobile/CLAUDE.md, ui/AGENTS.md, owner overrides above.
- Root and mobile quality gates before completion; source checks, CI, published artifacts and actual-device behavior are separate evidence tiers.
- Preserve three web playback invariants: requestPlayback owns play/pause; load effect never depends on isPlaying then calls play; seek preserves/resumes prior playing intent. One audio element. Preserve Range and 206 identity; no silent source/bitrate fallback for an existing Range.
- Serverless API has no durable in-process timers/locks. Convex Auth owns users; listener records belong elsewhere. Read convex/_generated/ai/guidelines.md before Convex edits.
- No session replay. No attribution footers in commits or PR text for this run.
- One mobile merge at a time. Final version after rebase; patch fixes/minor features. Root default squash instruction is overridden by owner's regular-merge choice.
- Windows junction safety is mandatory; never --force worktree removal, never recursive deletion through reparse points. Do not erase .env files or shared dependencies.
- Use Graft first for code discovery, callers before multi-file edits. If using codebase-memory, check coverage for relied files and read missing spans.
- Stop means stop: no agents, no watches, no builds/merges/cleanup until resumed. Historical docs' polling/gh --watch/background wait guidance is obsolete; use native PR watch only during active authorized work.
- No credit-consuming delegate review at stop. Saved terminal summaries are evidence; don't restart agents just to ask them to repeat them.

## 14. Continuation instruction
Read this handoff and evidence JSON first, then refresh exact Git and GitHub state. When the user explicitly resumes, finish the existing patches and PRs in small serialized slices, implement the Stream update dropdown, then complete the remaining authorized plan and evidence ledger. Report exact SHAs, checks, release version and remaining device gaps; never confuse main's source version with the published APK.



## Update: 2026-11-14 resume and merge plan
Live worktree and PR state, per-worktree resume steps and the two-version-bump merge plan (1.65.0 then 1.66.0) are in [HANDOFF-2026-11-14-resume-and-merge.md](HANDOFF-2026-11-14-resume-and-merge.md). Starter prompt: [STARTER-PROMPT-resume-and-merge.md](STARTER-PROMPT-resume-and-merge.md). Corrections to this file: published apk-latest is now 1.64.5, not 1.64.3; the merged-#129 worktree is the only one safe to delete today.
