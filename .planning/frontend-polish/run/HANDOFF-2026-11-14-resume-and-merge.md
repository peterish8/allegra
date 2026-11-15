# Allegra handoff: where everything stands, how to resume each worktree, and how to merge with two version bumps (2026-11-14)

This file is the operational follow-up to `HANDOFF-2026-11-14-credit-stop.md`. That file stays valid for rules, evidence tiers and the Stream-header spec. This one adds three things the first did not have: a live re-check of every worktree and PR (taken after the credit stop), a worktree-by-worktree resume guide, and a merge plan that ships the existing work as **two** version bumps instead of one bump per PR.

## 1. Read first
1. This file.
2. `.planning/frontend-polish/run/HANDOFF-2026-11-14-credit-stop.md` (Stream updates-dropdown spec in section 11E, backend plan inventory in 11F, rules in 13).
3. `CLAUDE.md`, `apps/mobile/CLAUDE.md`, `apps/mobile/DESIGN.md`, `apps/mobile/src/ui/AGENTS.md`, `docs/current-codebase.md`.
4. `.planning/frontend-polish/run/pause-2026-11-14/` (see section 6): `worktrees.json`, `pull-requests.json`, `apk-release.json`, `agent-reports.json`, plus the five patch backups made for this handoff.
5. `.planning/frontend-polish/PLAN-v2.md`, `run/WORKER-PROTOCOL.md`, `run/tasks/<card>.md` for any card you touch.
6. `.planning/echo-backend-port/README.md` only if you pick up a backend slice (section 10, item 8).

## 2. Project context
- Repo `C:\dev\allegra`, GitHub `peterish8/allegra`, default branch `main`. Web `apps/web`, API `apps/api` (Express, ships as one Vercel function), Android app `apps/mobile` (Expo / React Native plus Kotlin Media3; own lockfile, not a root workspace), Convex backend in `convex/`, island add-on `apps/island`.
- **The shared checkout `C:\dev\allegra` is on `fix/web-auth-dialog-focus` at `8a084c07`, 39 commits behind `main`, with 17 dirty paths** (planning docs, three web test files that show only line-ending noise, the untracked `.planning/echo-backend-port/` folder). Never pull, reset, checkout, stash or `git add -A` there. Its `.env` files (`apps/api/.env`, `apps/web/.env.local`) were lost in an earlier worktree-removal accident and are still missing; ask the owner before recreating them.
- Commands: `npm run typecheck`, `npm run lint`, `npm test` from the root; then `npm run mobile:check` (run it alone, after Convex tests finish). Mobile single-file: `cd apps/mobile && node_modules\.bin\tsc.cmd --noEmit` and `node_modules\.bin\jest.cmd <paths>`. `npm run sync:shared` after any `packages/**` edit. No local Gradle, no local emulator (owner rule); emulator proof comes only from GitHub CI.
- CI on a mobile PR: "Typecheck, lint, test, build", two "Secrets, lint, typecheck, test", "Kotlin unit tests", "Build APK", "Opens on an emulator" (the APK and emulator jobs take 15 to 25 minutes), Vercel. "Publish main APK" is skipped on PRs and runs only from `main`.
- Disk: C: had 16.86 GB free at the time of writing (it was 7.4 GB before the sweep removed the old worktrees).

## 3. Goal and current status
Goal: get the finished frontend polish and approved backend slices onto `main` on green CI, with **no more than two mobile version bumps for everything that already exists**, then do the unfinished work, then the final report and review.

Where it stands (verified live, 2026-11-14, after the credit stop):
- `origin/main` is `6a7873a5`, source version **1.64.5**. The latest published `apk-latest` release is **also 1.64.5** (the credit-stop handoff said 1.64.3; that was true then, and the release has since caught up. Re-check with `gh release view apk-latest --repo peterish8/allegra --json name`).
- Merged this run: #118, #117 (CI pins), #120, #121 (diagnostics), #122, #124 (Last.fm rules only), #125 (stream resolver), #129 (web mid-song recovery).
- **Open and ready or nearly ready:** #123, #126, #127, #128, #130, #131 (six PRs, section 5).
- **Finished on a branch but never pushed:** M1 mini player (`c6b9f1fe`).
- **Unfinished, local only:** grouped M2 + M3 + one Devices sheet (22 dirty paths), the older one-Devices-sheet patch, the new Stream updates dropdown (clean worktree, no feature code yet).
- **Held:** M12 (drop the Albums tab). The evidence gate failed; keep it on hold.
- No agents or PR watches are running. Do not restart old agents from their original prompts.

## 4. Decisions and approvals
| Date | Owner words | Status |
|---|---|---|
| 2026-11-14 | "u do mainain all neatly and push merge and del worktrees if done" | Approved: push, regular-merge on green CI, delete completed worktrees. |
| 2026-11-14 | "continue the handoff in detail ... properly where to resume each worktrees and how properly to combine and merge properly as a single or two version bumps only" | Approved target: **one or two** mobile version bumps for the existing work. This file's merge plan (section 11) follows it. |
| earlier | "dont squash pls from now onwards" | Standing rule: `gh pr merge N --repo peterish8/allegra --merge`. It overrides the "squash-merge" lines in `CLAUDE.md` and the old starter prompt. |
| 2026-11-14 | "remove tat completely / two btns / updates only / even after updating it shld shwo whats the chanegs" | Approved Stream header: remove the Stream explanation, Devices button left, rounded LuvLyrics logo right, logo opens an updates-only dropdown that always shows the real latest release notes, even when already up to date. Spec: credit-stop handoff 11E. |
| 2026-11-14 | "as ur low of credits stop all agents ..." | Agents stopped. Resume only on explicit owner go-ahead; solo continuation is the default. |
| open | Drop the Albums tab? | Keep HOLD (no evidence either way). Do not remove it without the owner. |
| open | Close stale #84? | Leave open and report. |

Authorised once resumed: commit, bump the version, push, link PRs, regular-merge on green CI, delete worktrees that are merged or patch-equivalent using the safe procedure in section 13. Needs the owner: dropping Albums, closing #84, recreating `.env` files, anything outside the plans.

## 5. Live PR state (checked 2026-11-14 on GitHub)
Every PR: base `main`. "CI" = checks on the PR head, which is **not** a check on the integrated result.

| PR | Branch | Head | Version in PR | Mergeable | CI at check time |
|---|---|---|---|---|---|
| #123 | `feat/shared-track-version` | `88c69ef3` | 1.64.6 (bumps) | UNSTABLE | all green except "Build APK" and "Opens on an emulator" still running |
| #126 | `feat/mobile-found-online-lyrics` | `2c84f040` | 1.64.4 (no bump) | CLEAN | all green |
| #127 | `fix/mobile-blend-polish` | `018cb438` | 1.64.4 (no bump) | CLEAN | all green |
| #128 | `fix/mobile-nav-label-scaling` | `8d6065b4` | 1.64.4 (no bump) | CLEAN | all green |
| #130 | `fix/mobile-luvs-motion` | `f49fef05` | 1.64.4 (no bump) | UNSTABLE | emulator job still running, rest green |
| #131 | `fix/mobile-luvlink-import-polish` | `b75fb949` | 1.64.4 (no bump) | UNSTABLE | emulator job still running, rest green |
| #84 | `feat/mobile-player-transition` | `d6c5d4fe` | 1.51.0 | DIRTY | stale (months old); leave open |

Only #123 touches `apps/mobile/app.json`. The other five PRs carry no version bump (the card brief told the workers not to bump).

## 6. Where everything lives
| Item | Location | State |
|---|---|---|
| Pause evidence | `.planning/frontend-polish/run/pause-2026-11-14/*.json` | Exact SHAs, check runs and agent activity at the credit stop. |
| Patch backups (new) | same folder: `grouped-m2-m3-devices.dirty.patch` (+ `grouped-ConnectDropdown.test.ts.untracked`), `mobile-lane-connect-dropdown.dirty.patch` (+ `mobile-lane-ConnectDropdown.test.tsx.untracked`), `m1-mini-player-c6b9f1fe.patch` | Safety copies of every uncommitted or unpushed change. Apply with `git apply --3way <patch>` if a worktree is ever lost. |
| Handoffs | `run/HANDOFF-2026-11-14-orchestrator.md` (history), `run/HANDOFF-2026-11-14-credit-stop.md`, this file | Latest wins. |
| Plans | `.planning/frontend-polish/PLAN-v2.md`, `run/tasks/*.md`, `.planning/echo-backend-port/*.md` | Untracked in the shared checkout; preserve all of them. |
| Worker brief | `C:\Users\nithy\AppData\Local\Temp\claude\45b25dbe5e1a3483\c17980c8-c7d8-4e8c-8a78-2345df9c6354\scratchpad\LUNA-BRIEF.md` | Worktree and junction rules for card workers (may be cleaned; its rules are repeated in section 13). |

### Worktrees (the full list; `git worktree list` is authoritative)
`T3` below means `C:\Users\nithy\.t3\worktrees\allegra\`.

| Worktree | Branch | Head | vs main | Dirty | On origin? | What it holds | Resume action |
|---|---|---|---|---|---|---|---|
| `C:\dev\allegra` | `fix/web-auth-dialog-focus` | `8a084c07` | 39 behind, 1 ahead | 17 | yes | Owner's checkout, planning docs | Do not touch. |
| `T3\t3-8451adb0-8c16b28a6e7fe2cf` | `feat/mobile-found-online-lyrics` | `2c84f040` | 7 behind, 1 ahead | 0 | yes (#126) | Found-online lyrics, 15 files | Part of batch A (section 11). Delete after batch A merges. |
| `T3\t3-fbad25f8-4a2b2ecc71dc236c` | `fix/mobile-blend-polish` | `018cb438` | 7 behind, 1 ahead | 0 | yes (#127) | Blend screens | Batch A. Delete after. |
| `T3\t3-978e65c4-cf4d18c36ef240d9` | `fix/mobile-nav-label-scaling` | `8d6065b4` | 7 behind, 1 ahead | 0 | yes (#128) | Native tab-label scaling, Kotlin + test | Batch A. Delete after. |
| `T3\t3-a40e9216-8ae8d8ad69defaca` | `fix/mobile-luvs-motion` | `f49fef05` | 7 behind, 1 ahead | 0 | yes (#130) | Luvs Reduce Motion | Batch A. Delete after. |
| `T3\t3-617ae0f1-5303f8b3145ce152` | `fix/mobile-luvlink-import-polish` | `b75fb949` | 7 behind, 1 ahead | 0 | yes (#131) | LuvLink + Spotify import controls | Batch A. Delete after. |
| `C:\dev\allegra-track-version` | `feat/shared-track-version` | `88c69ef3` | 3 behind, 2 ahead | 0 | yes (#123) | Shared track-version rules, real `node_modules` (npm ci) | Batch A. Delete after (real install: use the safe procedure). |
| `T3\t3-215f79ea-2de6c3af239fa799` | `fix/mobile-mini-player-polish` | `c6b9f1fe` | 3 behind, 1 ahead | 0 | **no** | M1 mini player, 7 files, committed | Batch A. Push first (or merge the local branch into the integration branch). |
| `T3\t3-e0109042-c4f2e9754b70e46c` | `fix/mobile-player-connect-polish` | `e509de17` (= old main) | 9 behind, 0 ahead | **22** | **no** | M2 + M3 + one Devices sheet, **uncommitted** | Batch B (section 12, step B1). |
| `C:\dev\allegra-mobile-lane` | `fix/mobile-one-devices-sheet` | `1f58d23e` | 10 behind, 0 ahead | 2 | **no** | Older one-Devices-sheet edit (superseded, see section 12) | Compare, then drop. Keep until the grouped work lands. |
| `T3\t3-194afcaf-c859279f9eb95409` | `t3/stream-updates-dropdown` | `6a7873a5` (= main) | 0 / 0 | 0 | **no** | Clean cut for the Stream header and updates dropdown, no code yet | Batch B (step B2). |
| `C:\dev\allegra-discovery-polish` | `feat/discovery-polish` | `c7dd4301` | 49 behind, 7 ahead | 0 | yes (no PR) | Old Quick Picks / search categories / transport controls | Audit only (step B4). Do not merge wholesale. |
| `T3\t3-d695b735-0fa0ae89d26a85cd` | `chore/mobile-library-drop-albums` | `e509de17` | 9 behind, 0 ahead | 0 | no | M12 HOLD, no changes | Keep until the owner decides; it is cheap. |
| `C:\dev\allegra-web-recovery` | `fix/web-midsong-recovery` | `1d7b44af` | 5 behind, 0 ahead | 0 | yes (#129 merged) | Merged; real `node_modules` | **Delete now** with the safe procedure (section 13). |

Branches that exist only locally are at risk if someone prunes branches: `fix/mobile-mini-player-polish`, `fix/mobile-player-connect-polish`, `fix/mobile-one-devices-sheet`, `t3/stream-updates-dropdown`, `chore/mobile-library-drop-albums`. Push them (or merge them) before any cleanup.

## 7. How to work with the artifacts
- Refresh first: `git fetch origin`; `git worktree list`; `gh pr list --repo peterish8/allegra --state open`; `gh pr view N --repo peterish8/allegra --json headRefOid,mergeStateStatus,statusCheckRollup`; `gh release view apk-latest --repo peterish8/allegra --json name`.
- Junction setup for a fresh worktree (no `npm ci`, saves disk): PowerShell `New-Item -ItemType Junction -Path <wt>\node_modules -Target C:\dev\allegra\node_modules` and the same for `apps\mobile\node_modules`. Check first that the lockfiles did not change since the shared checkout was installed: `git diff --stat 8a084c07 origin/main -- package-lock.json apps/mobile/package-lock.json` (at the time of writing only a one-line root `package.json` change; no lockfile change, so the junctions are valid). If a lockfile changed, run `npm ci` in the new worktree instead.
- A one-command conflict preview that touches no checkout: `git merge-tree --write-tree --no-messages <commit> <branch>`; exit code 1 lists the conflicted paths. This is how section 11's predictions were made.
- Detached CI waits: start a background shell that loops `gh pr checks N --repo peterish8/allegra` and treat the wait as done only when no line says pending, queued or in_progress **and** "Build APK" and "Opens on an emulator" are listed. Do not use `gh --watch`.

## 8. Verified facts
- Dry-run of merging the seven mobile branches (#123, #128, #127, #130, #131, M1, #126) into `origin/main` in that order with `git merge-tree` (2026-11-14): **three** conflict points, nothing else.
  1. `apps/mobile/src/designGuards.baseline.json` conflicts when #131 and M1 are added (#127, #130, #131 and M1 all lower different lines of the same file).
  2. `apps/mobile/src/components/LyricsResumePill.tsx` conflicts between #126 and M1.
  3. `apps/mobile/app.json` merges cleanly but ends at 1.64.6 (from #123); it must be set to the batch version at the end.
- `LyricsResumePill.tsx`, the two sides: #126 adds an optional `iconOnly` prop and uses `Control.glyph.sm` / `Control.target`; M1 swaps `Pressable` for `Tactile` with `wrapperStyle={styles.place}` (the absolute-position styles move to a `place` wrapper) and `fontSize: TypeScale.meta`. Resolution: keep M1's `Tactile` + `place` wrapper + `TypeScale.meta`, add #126's `iconOnly` prop, the `Control` import, the icon-only size and the `iconOnly` style on the inner pill.
- Only two files appear in more than one open branch: `LyricsResumePill.tsx` (#126, M1) and `designGuards.baseline.json` (#127, #130, #131, M1). Everything else is disjoint, so the six PRs plus M1 integrate cleanly.
- The grouped worktree also edits `NowPlayingLyricsArea.tsx`, `SynchronizedLyrics.tsx`, `ConnectRemotePlayer.tsx` (all three also touched by #126) and `designGuards.baseline.json` / `designGuards.test.ts`. That is why it goes in batch B, after batch A.
- The grouped `ConnectDropdown.tsx` and the older mobile-lane one take the **same approach**: the Stream header button calls `connect.openDevices()` and the component no longer owns a second `Sheet`; the app-level `ConnectDeviceSheet` (mounted once in `RootNavigator`) is the only picker. The grouped version additionally sets `accessibilityState.expanded = connect.devicesVisible` and has a source-level test asserting a single `<ConnectDeviceSheet />`. The lane version additionally swaps the trigger's hard-coded rgba colours for `Glass.fillLight` / `Glass.hairline` and has a behaviour test (renders only the trigger, calls `openDevices` once). Treat the grouped version as the base and fold in the lane's token swap and its behaviour test.
- There is **no CI check that enforces a version bump**. Only the project convention (`CLAUDE.md`) does. `mobile-apk.yml` reads `expo.version` at line 291 to name the release. This is what makes a single bump per batch legal.
- Reported test results are the workers' own, not parent reruns: #126 73 focused tests across 8 suites; #127 `mobile:check` 208 suites / 1,670 tests; #128 207 suites / 1,669 tests plus Kotlin geometry tests; #130 208 suites / 1,673 tests; #131 208 suites / 1,670 tests. M1 and the grouped work never completed a final gate. None of this is phone proof.
- Plain-lyrics (#126) comes from the Allegra API; the auto-scroll is an estimate, not synced to the audio. Not verified on a phone.
- #129's recovery has no real mid-stream cut test (needs a browser: block `/api/stream` for about 35 s).

## 9. Known problems and findings
- Individual PR CI does not prove the combined result: seven branches that each pass alone can still fail together (guard baselines, shared theme tokens in `allegraTheme.ts`). The integration PR must run the full gate set.
- Guard baselines may only fall. When resolving `designGuards.baseline.json`, the result for every key must be the lowest value any branch set, and a key any branch removed must stay removed. Then run the guard suite to confirm it still passes (it fails if the real count is above the baseline, and the file is only allowed to shrink).
- The Stream updates dropdown asks for the real current and latest release notes; `services/appUpdate.ts` (`parseChangelog`, `LatestBuild`, `ReleaseNotes`) and `components/about/UpdatePanel.tsx` already parse the release feed. Do not invent a changelog; line numbers in the credit-stop handoff came from an old graph and must be re-found.
- Published release lag was real earlier (1.64.3 while main was 1.64.4 to 1.64.5) and is gone now; if it comes back, read the "Publish main APK" job on the merge commit before blaming anything else.
- The `apps/api/.env` and `apps/web/.env.local` files are gone (owner action needed). Three web test files in the shared checkout show as modified with no real diff; do not commit them.

## 10. Remaining work, prioritised
1. **Free the stale worktree now:** remove `C:\dev\allegra-web-recovery` (merged #129) with the safe procedure. Done = worktree and local branch gone, shared checkout unchanged.
2. **Batch A, version 1.65.0:** integrate #123, #128, #127, #130, #131, M1 and #126 into one integration branch and one PR (section 11). Done = PR green on a fresh run (all checks including "Build APK" and "Opens on an emulator"), regular merge, `apk-latest` shows 1.65.0 after the main run.
3. **Clean up batch A:** delete the seven worktrees and local branches, and the remote branches of the PRs whose heads are now ancestors of `main`. Confirm each PR shows MERGED (or close it with a comment pointing at the integration PR).
4. **Batch B, version 1.66.0 (or 1.65.1 if it only contains fixes):** grouped M2 + M3 + one Devices sheet, the Stream updates dropdown, and anything from item 6 that is ready (section 12).
5. **Audit the old discovery branch:** keep only genuinely missing functionality (likely the `Quick Picks, search categories and native transport controls` commit, `c7dd4301`); the other six commits look like content already merged through #80 and #81. Verify by patch comparison before porting.
6. **Not started, in the PLAN-v2 queue:** M4 (confirmations, depends on M6/M7a/M7b, now unblocked once batch A merges), M9 (copy and empty states, same dependency), M11 (library playlist layout, depends on M12 which is on hold), P5 (UX findings doc, goes last), FINAL card. Fold M4 and M9 into batch B only if they are done before batch B merges; otherwise they get a later bump.
7. **Docs:** update `LEDGER.md` and `OWNER-TODO.md` on a docs branch cut from `main` (not on `fix/web-auth-dialog-focus`). OWNER-TODO items: island add-on, downloads folder, "delete does not remove the folder copy", the folder is a second copy, add-on Play Protect caveat, Android Auto and Wear restriction, stale #84, a phone checklist for the 1.64.x and 1.65.x features, the lost `.env` files.
8. **Backend (only with the owner's go-ahead):** P1-1 Android stream cache, P1-2 Android half, Last.fm slices 2 to 5, P2-3 translation, P2-5 probe, P3-1 gate, optional CodeQL. Inventory in the credit-stop handoff 11F.
9. End-of-run Sol review (`gpt-6.1-sol` through `delegate_task`) and the owner report. Not before the owner resumes billable work.

## 11. Plan A: ship the six open PRs plus M1 as ONE bump (1.65.0)
Why 1.65.0: #126 is a feature (minor bump). Everything else in the batch is a fix.

Approach: one **integration branch**, one **PR**, one CI run, one `Publish main APK`. The merged PR heads keep their original SHAs, so GitHub normally shows each original PR as merged once the integration PR lands.

Steps (each is small and checkable):
1. Refresh `origin/main`. Confirm it is still `6a7873a5` and still 1.64.5. If main moved, rebase the plan onto the new head; set the final version to (main version) with the minor bumped once.
2. Create the worktree: `git -C C:\dev\allegra worktree add C:\dev\allegra-batch-a -b chore/mobile-polish-1.65.0 origin/main`. Make the two `node_modules` junctions (section 7).
3. Merge in this order with `git merge --no-ff -m "merge: <PR title>" <branch>` (order puts the two files with conflicts next to the PRs that cause them):
   `feat/shared-track-version` (#123) → `fix/mobile-nav-label-scaling` (#128) → `fix/mobile-blend-polish` (#127) → `fix/mobile-luvs-motion` (#130) → `fix/mobile-luvlink-import-polish` (#131) → `fix/mobile-mini-player-polish` (M1) → `feat/mobile-found-online-lyrics` (#126).
4. Resolve the two predicted conflicts by hand with the Edit tool, never with a scripted rewrite: baseline = lowest value per key, removed keys stay removed; `LyricsResumePill.tsx` as described in section 8. Do not edit the PR commits themselves.
5. Final commit on the integration branch: set `apps/mobile/app.json` `expo.version` to `1.65.0` (the merge will have left 1.64.6 from #123). `chore(mobile): bump version to 1.65.0`.
6. `npm run sync:shared` and confirm no diff (this batch touches `packages/shared/trackVersion.ts`; #123 must keep both `scrobble.ts` and `trackVersion.ts` entries in `scripts/sync-shared.mjs`, which is already true on main plus #123).
7. Local gates, from the integration worktree: `npm run typecheck`, `npm run lint`, `npm test`, then `npm run mobile:check` on its own, plus `cd apps/mobile && node_modules\.bin\tsc.cmd --noEmit` and the guard suites. Fix failures; if one also fails on `origin/main`, say so.
8. Push (`git push -u origin chore/mobile-polish-1.65.0`), open one PR: title `feat(mobile): polish batch one, Found online lyrics and shared track versions (1.65.0)`, body lists the seven included PRs/branches and what only a phone can prove. Link it with `link_pull_request` (full URL). No AI footer in the commits or the body.
9. Optional saving: cancel the still-running CI runs on #123, #130 and #131 (`gh run cancel <id>`); the integration run supersedes them.
10. Wait for a fresh, fully green run on the integration head, then `gh pr merge N --repo peterish8/allegra --merge --match-head-commit <sha>`. Regular merge, not squash.
11. Verify: `gh pr view` of each of #123, #126, #127, #128, #130, #131 says MERGED. If one still says OPEN, close it with a comment naming the integration PR and its merge commit; do not claim GitHub merged it. For each merged head, `git merge-base --is-ancestor <head> origin/main` before deleting that PR's remote branch.
12. Watch the "Publish main APK" run on the merge commit and record the published version separately from the source version.

Fallback if the integration merge turns ugly (more than the two predicted conflicts, or a combined failure that cannot be fixed fast): merge the PRs serially (#128, #127, #130, #131, #126, then M1 and #123) as separate regular merges with **no** bump on any of them, and put the single 1.65.0 bump on the last one only. Accept that `main` carries the same version across several commits and the APK publishes once per merge; this is worse than the integration route and only a fallback.

## 12. Plan B: the second bump (1.66.0)
Do this only after batch A has merged and `origin/main` shows 1.65.0.

- **B1. Grouped M2 + M3 + one Devices sheet** (`T3\t3-e0109042-c4f2e9754b70e46c`, branch `fix/mobile-player-connect-polish`, branched from `e509de17`, 22 uncommitted paths: 21 modified plus untracked `ConnectDropdown.test.ts`).
  1. Safety copy already exists in `pause-2026-11-14/grouped-m2-m3-devices.dirty.patch`.
  2. Read the card files `run/tasks/M2.md` and `run/tasks/M3.md` and the diff (`git diff --stat`): reduced-motion work across `components/player/*` and the NowPlaying components, press feedback in `components/connect/*`, two baseline reductions, one added baseline note about the Up next panel spring (K9, "player sheet physics unchanged").
  3. Commit the dirty tree as a local WIP commit, `git fetch origin`, `git rebase origin/main`. Expect conflicts in `NowPlayingLyricsArea.tsx`, `SynchronizedLyrics.tsx`, `ConnectRemotePlayer.tsx` (from #126) and `designGuards.baseline.json`; keep **both** sides' behaviour; re-run the behaviour tests after resolving.
  4. Reconcile the two Devices implementations as described in section 8: grouped is the base; fold in the lane's `Glass.fillLight` / `Glass.hairline` token swap if the grouped file lacks it; keep one test file for the dropdown (the grouped `.ts` source test plus, optionally, the lane's behaviour test renamed so the two do not duplicate each other). Then the older `allegra-mobile-lane` worktree can be removed.
  5. Gates: `tsc`, the touched suites, `designGuards`, then `npm run mobile:check`. Never change the sheet spring physics or the playback owner.
- **B2. Stream updates dropdown** (`T3\t3-194afcaf-c859279f9eb95409`, branch `t3/stream-updates-dropdown`, clean at main). Spec: credit-stop handoff 11E. Summary: remove the Stream explanation entry; header has the existing-size tactile Devices button on the left and a rounded real LuvLyrics logo on the right; the logo opens an updates-only dropdown with the real current and latest version, the real release categories and items, and the existing safe updater action; the latest release notes stay visible when already up to date; loading, error, empty and retry states; token colours, spacing and radii; Reduce Motion; accessible labels and targets; Back and outside-tap dismissal; bounded scroll and font scaling. Regression test: current equals latest still shows the notes. Re-find `StreamScreen.tsx`, `components/about/UpdatePanel.tsx`, `services/appUpdate.ts` in the live tree. Feature, so it sets the batch to a minor bump.
- **B3. Integrate B1 and B2** the same way as batch A: one integration branch off the then-current main, one PR, final bump to **1.66.0** (use 1.65.1 if the owner drops B2 and only fixes remain), one fresh CI run, regular merge, then delete the worktrees.
- **B4. Discovery audit** (no PR required unless something is missing). In `C:\dev\allegra-discovery-polish`: `git log --oneline origin/main..feat/discovery-polish` shows seven commits; compare each against main with `git cherry -v origin/main feat/discovery-polish` and by reading the touched files. Port only what is not already there, as a fresh branch off main and only if batch B is still open to take it; otherwise it becomes its own later PR. Delete the old worktree after the audit.
- **B5. If time and budget remain:** M4 and M9 (now unblocked), then P5 and FINAL. Each one that lands before B3 merges rides on the 1.66.0 bump; anything later needs a new bump.

## 13. Rules and guardrails
- Regular merges only; no squash, no rebase-merge. Commits and PR text carry **no AI attribution lines**. Conventional subjects.
- Do not touch the three playback invariants, the byte-range rule (206 stays 206), the Android audio owner, or the sheet spring physics.
- Guard baselines only fall. Do not run an "update baseline" command; edit by hand.
- One mobile merge at a time. Version is set after the final rebase of the batch, never inside individual card branches.
- Never claim phone, TalkBack, 200% text, frame-rate, audio-sync or live-cut results from tests or CI. List them as "pending, needs a phone".
- **Worktree deletion, the safe way (a recursive delete through a `node_modules` junction wiped the owner's checkout twice):**
  1. Confirm the worktree is clean and its branch is merged (`git merge-base --is-ancestor <branch> origin/main`) or patch-equivalent (`git cherry`).
  2. PowerShell only (in Git Bash `cmd /c` is mangled; use PowerShell, or `cmd //c`). List reparse points: `Get-ChildItem <wt> -Force -Recurse -Attributes ReparsePoint -Depth 3 | select FullName,Target`. For worktrees made with junctions the two `node_modules` links point at `C:\dev\allegra\...`; for real installs (`allegra-track-version`, `allegra-web-recovery`) the `node_modules\@allegra\*` links point inside the same worktree. If any target is outside the worktree and you do not intend to remove it, stop.
  3. Remove each link non-recursively: `[System.IO.Directory]::Delete('<link>')`; prove it with `Test-Path`.
  4. Confirm `C:\dev\allegra\node_modules\@allegra\api` and `C:\dev\allegra\apps\api\src\app.ts` still exist.
  5. `git -C C:\dev\allegra worktree remove <wt>` **without** `--force`. Then `git -C C:\dev\allegra branch -d <branch>` (a "not merged to HEAD" warning is normal while the shared checkout is on another branch). Confirm `git -C C:\dev\allegra ls-files -d` prints nothing and report free space with `(Get-PSDrive C).Free/1GB`.
- Do not edit, checkout, reset, stash or pull in `C:\dev\allegra`. Read only.
- Treat the owner's project details as private; send nothing to outside services. No session-replay SDKs.
- Owner taste for any UI: clear frosted glass, no dark veils, subtle glow, icon-only buttons where they fit, no clutter, sentence-case copy, no emoji or sparkle wording.

## 14. Open questions and defaults
- Albums tab (M12): keep on hold. Default: do nothing.
- Close #84: default leave open and mention it in the report.
- Integration branch vs separate merges: default is the integration branch (section 11). Only fall back if it fails for a stated reason.
- Does the owner want M4, M9, M11, P5 inside batch B or a later bump? Default: include M4 and M9 only if finished before batch B merges; otherwise a third bump later, and say so in the report.
- Recreating `.env` files: ask once; default is to leave them missing and note it.
- Credits: the user must clearly resume before any paid delegate runs. Default when unclear: work solo with the tools you have, no delegates.

## 15. Continuation instruction
Start with the refresh commands in section 7, then do item 1 of section 10 (delete the merged #129 worktree) and run Plan A in section 11 end to end, because it unblocks everything else with a single version bump. Report each step in short plain sentences: what merged (PR and version), what CI proved, what only a phone can prove, what is next.
