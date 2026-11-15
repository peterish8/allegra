Copy everything below the line.

---

You are continuing the Allegra frontend polish run. Project `C:\dev\allegra` (GitHub `peterish8/allegra`, default branch `main`; web `apps/web`, API `apps/api`, Android app `apps/mobile`). The shared checkout is on `fix/web-auth-dialog-focus` at `8a084c07` and is dirty: never pull, reset, checkout, stash or commit in it. Goal in one sentence: ship the existing open mobile work as **one** version bump (1.65.0), then finish the unfinished player/Connect and Stream-header work as a **second** bump (1.66.0), on green CI with regular merges, and clean up the worktrees safely.

Do not rely on earlier conversations. Read, in order:
1. `C:\dev\allegra\.planning\frontend-polish\run\HANDOFF-2026-11-14-resume-and-merge.md` (state of every worktree and PR, resume steps, the merge plan)
2. `C:\dev\allegra\.planning\frontend-polish\run\HANDOFF-2026-11-14-credit-stop.md` (rules, evidence tiers, Stream updates-dropdown spec in section 11E, backend inventory)
3. `C:\dev\allegra\CLAUDE.md`, `apps\mobile\CLAUDE.md`, `apps\mobile\DESIGN.md`, `apps\mobile\src\ui\AGENTS.md`
4. `C:\dev\allegra\.planning\frontend-polish\run\pause-2026-11-14\` (JSON evidence plus the five `.patch` / `.untracked` backups of every unpushed or uncommitted change)
5. `.planning\frontend-polish\PLAN-v2.md`, `run\WORKER-PROTOCOL.md` and the card file in `run\tasks\` for any card you touch.

What the owner approved: commit, bump the version, push, link PRs, regular-merge on green CI (**no squash**, use `gh pr merge N --repo peterish8/allegra --merge --match-head-commit <sha>`), and delete finished worktrees with the safe procedure in section 13 of the handoff. Their words: "u do mainain all neatly and push merge and del worktrees if done" and "how properly to combine and merge properly as a single or two version bumps only". Still needs the owner: dropping the Albums tab (M12 stays on HOLD), closing stale #84, recreating the lost `.env` files. Work solo; start delegates only if the owner clearly says to (credits were the reason work stopped).

Work order:
1. `git fetch origin`; re-check `origin/main` (was `6a7873a5`, source version 1.64.5, published `apk-latest` 1.64.5), `gh pr list`, `git worktree list`. If main moved, adapt the plan; do not guess.
2. Delete the merged #129 worktree `C:\dev\allegra-web-recovery` and its local branch with the safe procedure (PowerShell, delete junction/links non-recursively, prove they are gone, check the main checkout is intact, no `--force`).
3. **Batch A (1.65.0):** build one integration branch `chore/mobile-polish-1.65.0` from `origin/main` in a new worktree (`C:\dev\allegra-batch-a`, node_modules junctions). Merge with `--no-ff`, in this order: `feat/shared-track-version` (#123), `fix/mobile-nav-label-scaling` (#128), `fix/mobile-blend-polish` (#127), `fix/mobile-luvs-motion` (#130), `fix/mobile-luvlink-import-polish` (#131), `fix/mobile-mini-player-polish` (M1, local only), `feat/mobile-found-online-lyrics` (#126). The dry run predicts exactly two conflicts: `designGuards.baseline.json` (lowest value per key, baselines may only fall) and `LyricsResumePill.tsx` (M1's Tactile wrapper plus #126's `iconOnly`). Then one commit setting `apps/mobile/app.json` `expo.version` to `1.65.0`, `npm run sync:shared` (no diff), `npm run typecheck`, `npm run lint`, `npm test`, `npm run mobile:check` alone, mobile `tsc`. Push, one PR, link it, wait for a fresh fully green run (including "Build APK" and "Opens on an emulator"), regular merge, then verify each original PR is MERGED (else close it with a comment naming the integration PR) and delete the batch's worktrees and branches safely.
4. **Batch B (1.66.0, only after batch A merged):** finish the grouped M2 + M3 + one Devices sheet worktree (22 uncommitted paths; commit WIP, rebase on main, keep both sides in `NowPlayingLyricsArea`, `SynchronizedLyrics`, `ConnectRemotePlayer`, fold the older mobile-lane Devices edit into the grouped one), build the Stream header and updates dropdown in its clean worktree, audit `feat/discovery-polish` for genuinely missing work, integrate into one PR with one bump, merge, clean up.
5. Then, as budget allows: M4 and M9 (now unblocked), P5, the FINAL card, LEDGER and OWNER-TODO on a docs branch from `main`, the end-of-run review, the owner report.

Quality gates for every PR: root `npm run typecheck`, `npm run lint`, `npm test`, `npm run mobile:check` (alone, after Convex tests), mobile `tsc --noEmit`, `npm run sync:shared` after `packages/**` edits, every GitHub check green on the exact head, version bumped once after the final rebase, PR linked. Baselines only fall. No local Gradle or emulator. Never claim phone, TalkBack, 200% text, frame-rate, audio-sync or live-cut results from tests or CI; list them as "pending, needs a phone". Conventional commits, no AI attribution lines in commits or PR text. Do not touch the playback invariants, the byte-range rule, the Android audio owner or the sheet spring physics.

Open questions: ask the owner once, in plain words, only if a choice has no default in the handoff (section 14); otherwise use the defaults and continue.

Report progress in short plain sentences: what merged (PR number and version), what CI proved, what only a phone can prove, and what is next. No recap of this prompt.
