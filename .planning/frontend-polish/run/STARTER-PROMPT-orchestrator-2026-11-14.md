Copy everything below the line into a new session.

---

You are taking over the orchestrator seat of the Allegra frontend polish run. Project: `C:\dev\allegra` (GitHub `peterish8/allegra`, default branch `main`; web `apps/web`, Android app `apps/mobile`, island add-on `apps/island`). Goal in one sentence: get every AUTO card merged to `main` on green CI, leave HOLD cards open, then deliver the FINAL report and the end-of-run Sol review.

Do not rely on earlier conversations. Read, in order:
1. `C:\dev\allegra\.planning\frontend-polish\run\HANDOFF-2026-11-14-orchestrator.md` (full state, rules, decisions, plan)
2. `C:\dev\allegra\CLAUDE.md`, `C:\dev\allegra\apps\mobile\CLAUDE.md`, `apps\mobile\DESIGN.md`
3. `.planning/frontend-polish/run/00-ORCHESTRATION.md`, `WORKER-PROTOCOL.md`, `LEDGER.md`, `OWNER-TODO.md`, `tasks/*.md`
4. `.planning/frontend-polish/PLAN-v2.md`

What the owner approved and you may do without asking: commit, bump `apps/mobile/app.json` version, push, and squash-merge PRs when every CI check is green; resume the two lane workers; update LEDGER and OWNER-TODO. Standing rules (full table in the handoff, section 4): no local emulator or Gradle; no Sol reviews until the end; no extra subagents beyond the two lane workers; failed Luna/Terra/Opus workers move to Sonnet 5.5 medium; edit code with the Edit tool; conventional commits with no AI footers; guard baselines only fall; one mobile merge at a time with the version bumped after the final rebase; never claim phone/emulator results from CI; never delete worktrees or branches without asking; never touch playback invariants or the byte-range rule.

Work order:
1. Merge PR #122 (downloads folder song-title-only names, 1.64.4) once "Build APK" and "Opens on an emulator" are green. If main moved, rebase, set the version one above main, push, wait again.
2. Build the phone "Found online" plain lyrics with auto-scroll like the website (handoff section 10 item 2) in a new worktree; tests; version bump; PR; link it; merge on green.
3. Resume the mobile lane worker (thread id in handoff section 6) with `t3_thread_send`; its queue: CONNECT-ONE-SHEET, M8, M1, M2, M3, M4, M6, M9, M10, M11, M12, M7a, M7b, P5. Make sure merges stay serial and versions increase.
4. Update LEDGER and OWNER-TODO (list in handoff item 7) on a docs branch from `main`.
5. FINAL card, then the Sol review of all merged PRs, then report.

Quality gates for every PR: `npx tsc --noEmit` and the relevant jest suites in `apps/mobile` (root `npm run typecheck/lint/test` for web), every GitHub check green, version bumped, PR linked with `link_pull_request`. For long waits run detached and poll; do not block on foreground sleeps.

Open questions: ask the owner at most once, in plain words; otherwise use the defaults in handoff section 12.

Report progress in short plain sentences: what merged (PR number and version), what CI proved, what only a phone can prove, and what is next. No recap of this prompt.
