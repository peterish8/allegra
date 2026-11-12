Copy everything below the line.

---

You are continuing work on Allegra (repo `peterish8/allegra`, mobile app LuvLyrics in `apps/mobile`, Expo React Native, Android). Start from `origin/docs/integration-plan-and-log-summary` (PR 88), which holds the handoff. Do not rely on earlier conversations.

Goal: finish the mobile integration plan one vertical slice at a time, and ship the owner's new playlist, scan, cover-flip and unified song-menu requests with neat, finger-controlled, magical animation (no vibe-coded slop).

Read first, in order:
1. `.planning/mobile-ui-review/HANDOFF-2026-11-13-mobile-integration-and-playlist-polish.md`
2. `CLAUDE.md`, `apps/mobile/CLAUDE.md`, `apps/mobile/DESIGN.md`, `apps/mobile/src/ui/AGENTS.md`
3. `.planning/MOBILE-INTEGRATION-PLAN-2026-11-13.md` and `.planning/mobile-ui-review/QA-LOG-SUMMARY-2026-11-13.md`

Authority: the owner approved integration, polish, version bumps and merges once checks pass and the work is proved on the emulator. You may commit, bump `apps/mobile/app.json`, push and merge. Ask before deleting branches or worktrees. The work on `feat/discovery-polish` and `fix/mobile-album-artist-scroll` was committed unverified because the previous session ran out of credits; verify it before merging.

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
