Copy everything below the line into the next agent session.

---

You are continuing Allegra in `C:\dev\allegra` on branch `fix/playback-skip-glitches`. The full playback-glitches roadmap is documented in `.planning/playback-glitches/HANDOFF-2026-11-11-skip-glitches.md`. Complete only the approved first mobile PR now: explicit-skip playhead reset, shared previous/next routing, and classic mini-player lyrics after rapid skips; bump Expo version to 1.45.2, run checks, and commit locally. Use the detailed PR 2–5 roadmap in the handoff for the subsequent Android, shared/web, web-motion, and remaining mobile work after this slice is accepted.

Do not rely on earlier conversation. Read these first, in order:

1. `C:\dev\allegra\.planning\playback-glitches\HANDOFF-2026-11-11-skip-glitches.md`
2. `C:\dev\allegra\.planning\playback-glitches\PLAN.md`
3. `C:\dev\allegra\CLAUDE.md`
4. `C:\dev\allegra\apps\mobile\CLAUDE.md`
5. `C:\dev\allegra\apps\mobile\DESIGN.md`
6. `C:\dev\allegra\apps\mobile\src\ui\AGENTS.md`
7. `C:\dev\allegra\docs\architecture.md`

The user approved the implementation, regression tests, version bump, `npm run mobile:check`, and local commit for PR 1. They asked for a detailed plan for the whole audit, but have not approved implementing PRs 2–5 yet. They explicitly said not to add AI attribution footers. Push and PR are not approved; finish the local work first, then ask before either. Begin with `git status --short --branch`, `git diff --stat`, and review the whole diff. Preserve existing uncommitted work.

Work order:

1. Correct resetPlayhead to take a numeric duration and ensure Android previous restart passes the current song duration. Filter stale reports in both provider status paths. Reset only explicit skips; never passive queue adoption, restore, initial load, or recovery.
2. Review `src/services/player/skipControls.ts` and tests. Both MiniPlayer and Now Playing must call it. Keep LuvLink owner routing first, Android previous delegated to native queue, and JS restart using seek notifications plus `requestPlayback(true)` when previously playing.
3. Correct the lyrics helper to the requested `{ shownId, currentId, sameObject, expanded }` decision API. Ensure the A→B→A branch cancels/replaces the fade, updates the displayed song if needed, and restores opacity. The fade completion must read `latestSongRef`. Use Motion tokens.
4. Bump `apps/mobile/app.json` from 1.45.1 to 1.45.2.
5. Run `npm run mobile:check` from repo root. If npm fails, use the local `tsc`, `eslint`, and `jest` commands documented in `apps/mobile/CLAUDE.md`.
6. Review all tracked and untracked files, include `.planning/playback-glitches/PLAN.md`, and commit with: `fix(mobile): reset the playhead on skip, one previous path, classic bar lyrics after quick skips (1.45.2)`.

After PR 1 is committed and the user has reviewed it, use the five-PR implementation plan in the handoff. Reproduce each later defect before changing it; preserve queue/audio ownership; bump the mobile patch version for every APK-reaching PR; run `npm run sync:shared` after shared-package work; use web viewport and motion checks for browser changes; and record physical-device evidence separately. Ask the user before the swipe-behavior decision in PR 2 and before pushing or opening any PR.

Follow repository playback ownership, LuvLink routing, animation token, and version rules. If a genuine product decision is needed, ask once; otherwise use the handoff's recommended defaults. Do not push or open a PR without approval. Report progress concisely, include test output and what remains unverified on a physical device/emulator, then ask whether to push/open the PR.
