Copy everything below the line into a new session.

---

You are continuing work on Allegra (monorepo at `C:\dev\allegra`, GitHub `peterish8/allegra`). Work in the second
checkout `C:\dev\allegra-nav-stats`, branch `feat/web-player-ytm-style`. Goal: ship the website's YouTube Music–style
full player (flat full-width bar with a thin progress line, time beside the tools, one karaoke control, a single
cover-colour background wash), then bring the open phone PR #71 up to date with `main`.

Read these first, in order, and do not rely on any earlier conversation:
1. `C:\dev\allegra-nav-stats\.planning\web-player-ytm\HANDOFF-2026-11-11-web-player-ytm.md`
2. `C:\dev\allegra\CLAUDE.md`
3. `C:\dev\allegra\docs\current-codebase.md`
4. `C:\Users\nithy\.claude\projects\C--dev-allegra\memory\worktree-junction-gotchas.md`

What the owner approved: copy YouTube Music's calm player and leave out its clutter; the bar style for our buttons
including karaoke; the background gradient formula. They rejected touching lyric line-wrapping. You may commit, push the
feature branches and open or update PRs. Ask before merging anything to `main` (it publishes the phone APK).

Work order:
1. Preview the branch (`preview_start mock-8080`, `preview_start web-ytm`, or the headless Edge script named in the
   handoff). Check 1920 wide, reduced motion and the black-background setting; fix anything off.
2. Revert the local-only line: `git checkout -- apps/web/next.config.ts`.
3. Gates: `tsc --noEmit`, eslint, `node --import tsx --test "src/lib/*.test.ts"` in `apps/web`; then root
   `npm run typecheck`, `npm run lint`, `npm test`.
4. `git rebase origin/main`, resolve conflicts keeping both sides, rerun the gates.
5. Commit `feat(web): YouTube Music player bar and cover-colour wash` (no attribution footer), push using the
   `env -u GITHUB_TOKEN` workaround in the handoff, open the PR with screenshots at 360/768/1280/1920.
6. PR #71 (`feat/create-sheet-stats-design`): rebase on `origin/main`, keep phone version 1.46.0, rerun
   `npm run mobile:check`, push with `--force-with-lease`.

Open questions (website romanised lyrics, Song/Video switch, phone Romanised and Related chips): ask the owner once;
if there is no answer, use the defaults in the handoff (§12).

Report back in plain sentences: what you changed, the PR links, which checks passed (with counts), what you checked in a
browser and at which widths, and what is still unverified.
