Copy everything below the line.

---

You are continuing work on Allegra (`C:\dev\allegra`, GitHub `peterish8/allegra`), the LuvLyrics Android app in `apps/mobile`. The goal: land two finished fixes — a live "new build" watcher (PR #79) and downloads that save before searching for lyrics (PR #80).

Read these first, in order, and do not rely on earlier conversations:
1. `C:\dev\allegra\.planning\HANDOFF-2026-11-12-update-watcher-and-download-lyrics.md`
2. `C:\dev\allegra\CLAUDE.md`, then `apps\mobile\CLAUDE.md`
3. `docs\current-codebase.md`

What the user approved: the watcher on its own branch and PR (done), and downloads saving first with lyrics searched in the background (done). You may run checks and push to the two feature branches. You need the user's yes before merging either PR, building or releasing anything, or touching the playback files in the main checkout (`fix/playback-edge-cases`; other agents were editing it).

Work order:
1. `gh pr view 79` and `gh pr view 80` (run `unset GITHUB_TOKEN GH_TOKEN` first). Confirm both are open and green.
2. Ask the user once: "Merge #79, then update and merge #80?" If they say yes, squash-merge #79. Then in `C:\dev\allegra-download-lyrics` merge `origin/main`, resolve `apps/mobile/app.json` to version `1.49.2`, run `npx jest src/components/BackgroundDownloader.test.ts src/services/lyricsScanWorker.test.ts` from `apps/mobile`, push, wait for CI, squash-merge #80.
3. Confirm the `main` run published `apk-latest` and report the version About → Updates should show (1.49.2).
4. Tell the user what to check on the phone: a download with no findable lyrics completes within seconds; a newer build appears in About → Updates on its own within 15 to 45 seconds.
5. Only after the user agrees, remove `C:\dev\allegra-download-lyrics` (delete junctions before `git worktree remove`) and the merged branches.

Gates: CI must be fully green. Run `npm run typecheck`, `npm run lint`, `npm test` before any new PR. No AI attribution footers; conventional commits.

Open questions: ask once; otherwise use the handoff's defaults (leave PRs open if unanswered; no timeout change in `lyricaService`).

Report progress to the user in short plain sentences: what you ran, what passed, what you did not run, and what needs their decision.
