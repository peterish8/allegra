Copy everything below the line.

---

You are continuing work on Allegra (repo `peterish8/allegra`, mobile app LuvLyrics in `apps/mobile`, Expo React Native, Android). Start from `origin/docs/integration-plan-and-log-summary` (PR 88), which holds the handoff. Do not rely on earlier conversations.

Goal: finish the mobile integration plan one vertical slice at a time, and ship the owner's new playlist, scan, cover-flip and unified song-menu requests with neat, finger-controlled, magical animation (no vibe-coded slop).

Read first, in order:
1. `.planning/mobile-ui-review/HANDOFF-2026-11-13-mobile-integration-and-playlist-polish.md`
2. `CLAUDE.md`, `apps/mobile/CLAUDE.md`, `apps/mobile/DESIGN.md`, `apps/mobile/src/ui/AGENTS.md`
3. `.planning/MOBILE-INTEGRATION-PLAN-2026-11-13.md` and `.planning/mobile-ui-review/QA-LOG-SUMMARY-2026-11-13.md`

Authority: the owner approved integration, polish, version bumps and merges once checks pass and the work is proved on the emulator. You may commit, bump `apps/mobile/app.json`, push and merge. Ask before deleting branches or worktrees. The work on `feat/discovery-polish` and `fix/mobile-album-artist-scroll` was committed unverified because the previous session ran out of credits; verify it before merging.

Method (Theo's T3 Stack principles, applied to this repo's existing stack; see "Architecture decisions" in `.planning/MOBILE-INTEGRATION-PLAN-2026-11-13.md`):
- Modular and optional: small narrow modules, one job each, one owner per concern. One action model and one presenter, not two menus.
- End-to-end type safety: strict TypeScript, no `any`, shared DTOs in `packages/shared`, runtime validation at every boundary (provider responses, scanned codes, API data), explicit error and empty states.
- One contract per feature (recommendations, song actions, share codes). Change the contract doc first, then both sides.
- Do not bolt on a second stack (no tRPC, no second auth or database) just to match a name. Convex, Express and Expo stay.
- Ship small and often: one vertical slice per PR, tests with it, deploy-ready at every merge.

Cook (for every animation slice: scan flow, cover flip, playlist header pull-down, unified menu sheet):
- Use the Cook Loop (`/cook` skill if you have it): write a `cook/BRIEF.md` with a numeric bar (9/10 per dimension: composition, light and glow, color, glass and materials, detail, motion), capture stills of each state, have fresh zero-context critic subagents score them (Sonnet, medium effort, at least two per round), fix the weakest dimension, log every round in `cook/ROUNDS.md`, repeat until the bar holds. Do the building yourself; give the cooking and critique to the subagents.
- The previous run (player transition, rounds 1 to 3) is copied to `.planning/mobile-ui-review/cook-2026-11-13/` (BRIEF, SHOTS, ROUNDS) because the real `cook/` folder is git-ignored and exists only on the owner's laptop. Read it for the bar, the rules, the critic setup and the lessons (for example: a quadratic ease let the cover escape the sheet; keep moving parts clamped inside their container). Its working branch was `feat/mobile-player-cook`.
- Rebuilds need a CI APK (about 15 minutes), so batch several fixes per round. A local Android build is broken; rely on CI.
- Cook state lives in `cook/` (git-ignored). Commit nothing from it except summaries under `.planning/`.

Merge authority: you may merge each PR yourself when you are satisfied, meaning typecheck, lint, tests and `mobile:check` pass, CI is green, the APK launches, and you have emulator or phone evidence for the change. Squash-merge, then continue to the next slice. If you cannot prove a slice (for example no emulator), do not merge it; say what is unproved and ask the owner to test the CI APK.

Work order:
1. Check out `origin/feat/discovery-polish` and `origin/fix/mobile-album-artist-scroll`. Run typecheck, lint and tests. Fix failures. Open PRs, wait for the CI APK, exercise the new screens on the emulator, merge.
2. Unified song menu: one action model and one presenter used by long press on any song row and by the mini-player three dots; big Download button; keep categories; delete the duplicate menus.
3. Playlist header: no find bar on open, pull-down reveals it; plain back and options icons without the round discs.
4. Scan with a LuvLyrics code: reproduce on the emulator, make it work, show the result instantly, allow saving, and design the scan-to-result-to-save animation.
5. CoverFlipCard: finger-tracked flip and deck swipe, spring on release, interruptible.
6. Remaining items of the integration plan.

Each slice: its own branch and PR, tests, `tsc --noEmit`, lint, `npm.cmd run mobile:check`, version bump, CI APK, emulator proof, then merge. Animate `transform` and `opacity` only, with tokens; reduced motion collapses to opacity.

Open questions: use the defaults in section 13 of the handoff and tell the owner what you chose. Otherwise ask once.

Report after each merged slice: PR link, version, what was proved and how (emulator screenshot or recording), and anything left unproved.
