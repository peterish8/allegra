# Handoff — live update watcher (PR #79) and downloads that no longer wait for lyrics (PR #80)

**Written:** 2026-11-12
**Repo:** `C:\dev\allegra` (GitHub `peterish8/allegra`)
**Area:** LuvLyrics Android app (`apps/mobile`)
**Status in one line:** both fixes are finished, pushed and green in CI. Neither is merged. The playback work in the main checkout is a separate, unfinished job.

## 1. Read first

1. This handoff.
2. `CLAUDE.md` (repo root), then `apps/mobile/CLAUDE.md`, `apps/mobile/DESIGN.md`.
3. `docs/current-codebase.md` (map of owners and entry points).
4. For the playback work only: `.planning/playback-glitches/HANDOFF-2026-11-11-mobile-audit-continuation.md` and `.planning/playback-glitches/PLAN.md`.
5. Run `git status --short --branch` in each checkout listed in section 6 before touching anything. Other agents were editing the main checkout.

## 2. Project context

- Monorepo, npm workspaces, one root lockfile. `apps/mobile` is not a workspace member (own lockfile; `npm install` inside it).
- Gates from the repo root: `npm run typecheck`, `npm run lint`, `npm test`. Mobile: `npm run mobile:check` (do not run it at the same time as `npm.cmd run convex:test`; learning-log item 20).
- Single mobile test file: `cd apps/mobile && npx jest src/components/BackgroundDownloader.test.ts`.
- CI on a PR runs: Typecheck/lint/test/build, Build APK, Secrets/lint/typecheck/test, Kotlin unit tests, Opens on an emulator. "Publish main APK" is skipped on PRs and runs only from `main`.
- Rule from `CLAUDE.md`: anything that rebuilds the APK bumps `expo.version` in `apps/mobile/app.json` in the same change. No AI attribution footer on commits.

## 3. Goal and current status

The user asked for two things on the phone app:

1. While the app is open, a new build should show up by itself, "like a listener", without using Convex or any server of ours.
2. A download must never sit "forever searching" for lyrics. The song should be saved and appear in Downloads first; lyrics are then searched in the background and attached.

Both are built, pushed as separate PRs from `main`, and every CI check is green. Merging is the remaining step for each, and the user has not yet said to merge #80. For #79 the previous agent asked "merge once CI is green, as with the earlier PRs?" and got no answer in the part of the thread I can see.

## 4. Decisions and approvals

| Date | Decision | User's words | Status |
|---|---|---|---|
| 2026-11-12 | Update watcher on its own branch and PR, not held with playback fixes | "Yes, own branch and PR" | approved, done (#79) |
| 2026-11-12 | Downloads save first, lyrics search runs after in the background | "let download the song and the lyrics searching let it happen in bg ... then later like next sec itself you search lyrics in background and attach" | approved, done (#80) |
| 2026-11-12 | Do the work on the right branch | "do in ryt branch" | done: `fix/download-without-lyrics` |
| 2026-11-12 | Merge #79 once CI is green | asked, no recorded reply | open |
| 2026-11-12 | Merge #80 | not asked yet | open |

Authorised without asking again: commit, push to the feature branches, run checks. Needs the user: merging either PR (the user's earlier PRs were merged on request; confirm), building or releasing anything, and touching the playback files.

## 5. What was done

### A. Update watcher — PR #79, branch `feat/mobile-update-watcher`, version 1.49.1
- `apps/mobile/src/services/updateWatcher.ts` (new, 182 lines) and `updateWatcher.test.ts` (12 tests).
- While the app is in front it downloads the release's small `changelog.json` (about 700 bytes) from GitHub's download CDN. That is a plain file download, not the GitHub API, so the 60-requests-per-hour API limit does not apply.
- When the commit in that file differs from the installed build, it runs the one full update check the app already had. The profile dot and an open About → Updates panel update on their own.
- Polling: 45 s normal, 15 s with the Updates panel open, 3 min on Battery Saver, 5 min once an update is already known, backoff up to 10 min after failures. It stops entirely in the background or when automatic checks are off, and checks straight away on returning to the app.
- It never downloads or installs anything; the tap stays with the user.
- Small hooks in `apps/mobile/src/App.tsx` and `apps/mobile/src/components/about/UpdatePanel.tsx`; version bump in `apps/mobile/app.json`.
- Limits: detection is polling, so a build shows up 15 to 45 s after CI publishes it. A phone must already be on 1.49.1 to have the watcher.

### B. Download before lyrics — PR #80, branch `fix/download-without-lyrics`, version 1.49.2
Cause: `BackgroundDownloader` started a lyrics search in parallel, then after the audio finished it awaited that search. If a provider never answered, the job stayed on "Processing lyrics..." and the song was never added to the library.

Fix (`apps/mobile/src/components/BackgroundDownloader.tsx`, commit `cb0f55c1`):
- Removed the inline `lyricaService.fetchLyrics` call and the whole "Processing lyrics" phase, and the `FileSystem` / `lyricaService` imports.
- Download progress now maps 0 to 100% to the audio and cover (it was scaled to 80%).
- `addSong(newSong)` runs first; only then is the job marked `completed`. (Before, it was marked done before the library write.)
- The existing lyrics queue handles lyrics afterwards: when the saved song has no synced lyrics, `useLyricsScanQueueStore.getState().addToQueue(newSong, true)` queues it, and `processLyricsScanQueue()` (`lyricsScanWorker`) searches and attaches in the background. That path already existed; the change makes it the only path.
- Tests: `BackgroundDownloader.test.ts` (new, 66 lines) proves the job completes and is saved while `fetchLyrics` never resolves, that lyrics are queued after the save, and that a failed save neither reports completed nor queues lyrics. `lyricsScanWorker.test.ts` (new, 63 lines) covers the worker.

## 6. Where everything lives

| Item | Location |
|---|---|
| Watcher PR | https://github.com/peterish8/allegra/pull/79 — branch `feat/mobile-update-watcher`, one commit `e0d88511` on top of `f6645616` |
| Download PR | https://github.com/peterish8/allegra/pull/80 — branch `fix/download-without-lyrics`, commit `cb0f55c1`, worktree `C:\dev\allegra-download-lyrics` |
| Main checkout | `C:\dev\allegra`, branch `fix/playback-edge-cases`, HEAD `161d505c` (the watcher commit, a duplicate of #79) |
| Other worktrees | `C:\dev\allegra-discovery-polish`, `C:\dev\allegra-mini-song-menu`, `C:\dev\allegra-mobile-responsiveness`, plus archive and backup folders |
| Older playback handoffs | `.planning/playback-glitches/` |

The watcher worktree was removed after the PR was opened; the branch is on GitHub.

## 7. How to work with the artifacts

```
# PR status (clear stale tokens first, as the earlier agent did)
unset GITHUB_TOKEN GH_TOKEN; gh pr view 79 --json state,mergeable,statusCheckRollup
gh pr view 80 --json state,mergeable,statusCheckRollup

# tests for the download fix
cd C:\dev\allegra-download-lyrics\apps\mobile
npx jest src/components/BackgroundDownloader.test.ts src/services/lyricsScanWorker.test.ts
```

Gotchas:
- **Both PRs edit `apps/mobile/app.json` line 5** (`1.49.0` to `1.49.1` in #79, to `1.49.2` in #80). GitHub reports each as mergeable now; whichever merges second will conflict on that one line. Merge #79 first, then update #80's branch from `main` and keep `1.49.2`.
- Remove a worktree's junctions before `git worktree remove` (it once wiped the main checkout; see the memory note "Worktree junction gotchas").
- Do not rewrite source with python/sed scripts; use the Edit tool.

## 8. Verified facts

Checked on 2026-11-12:
- PR #80: state OPEN, mergeable, base `main`; checks Typecheck/lint/test/build, Build APK, Secrets/lint/typecheck/test (twice), Kotlin unit tests, Opens on an emulator, and Vercel Preview Comments all SUCCESS; "Publish main APK" SKIPPED (expected on a PR).
- PR #79: same result.
- `BackgroundDownloader.tsx:184-185` calls `addSong` and then `updateItem(... 'completed' ...)`; lines ~207-219 queue the lyrics scan when the song has no synced lyrics.
- The working copy of `app.json` in the main checkout reads `1.50.0` (uncommitted playback work).

Not verified: neither change has run on a physical phone. The watcher was not exercised against a real GitHub release. The full `mobile:check` was not run locally because playback agents were editing the same files. CI is the only full run.

## 9. Known problems and findings

1. **Lyrics may still be missing right after a download.** That is intended now. If the lyrics queue gives up (all providers fail) the song stays without lyrics; the existing retry behaviour in `lyricsScanWorker` decides what happens next. Not changed here.
2. **The failure was a never-resolving provider.** The new test models it. There is still no timeout inside `lyricaService.fetchLyrics` itself; the scan worker is the one that now waits on it, in the background. If background scans pile up behind one hung provider, add a deadline there (project rule 9: bound outbound work).
3. **Duplicate watcher commit.** `161d505c` on `fix/playback-edge-cases` is the same change as #79's `e0d88511`. Rebasing the playback branch onto `main` after #79 merges should drop it.
4. **Playback work is unfinished and uncommitted** in the main checkout (about 30 modified files and 11 new files in `apps/mobile` and `apps/web`: player sheet motion, lock-screen metadata, now-playing load, skip rules, web play intent and Connect view, version `1.50.0`). It was being edited by two other agents. Treat it as theirs.

## 10. Remaining work, prioritised

1. Merge #79, then bring #80 up to date on `app.json` and merge it. Done when `main` shows 1.49.2 and the `Publish main APK` job on `main` succeeds, publishing to `apk-latest`.
2. Check the result on a phone running 1.49.2: start a download of a song whose lyrics cannot be found. Done when it appears in Downloads within seconds and lyrics attach later or stay absent without blocking anything.
3. Check the watcher on a phone running 1.49.1 or later: publish a newer build and watch the About → Updates panel and the profile dot change on their own within 15 to 45 s.
4. Finish and ship the playback work in the main checkout, from its own handoff (see the older files under `.planning/playback-glitches/`). Not part of this handoff.

## 11. Plan for the next agent

1. `gh pr view 79` and `80`; confirm checks are still green and the PRs are open.
2. Ask the user once whether to merge. If yes: squash-merge #79; in `C:\dev\allegra-download-lyrics` run `git fetch origin && git merge origin/main`, resolve `apps/mobile/app.json` to `1.49.2`, run the two jest files above, push, wait for CI, squash-merge #80.
3. Confirm the `main` run published `apk-latest` and that About → Updates shows 1.49.2.
4. Remove `C:\dev\allegra-download-lyrics` (junctions first) and delete merged branches only after the user agrees.

## 12. Open questions

- Merge both PRs now? Default: ask once; if no answer, leave them open.
- Add a timeout inside `lyricaService.fetchLyrics`? Default: no; raise it as a follow-up only if background scans are seen stalling.

## 13. Rules and guardrails

- `CLAUDE.md`: conventional commits, no AI footers; a phone build needs a new `expo.version`; `main` stays green; squash-merge, small PRs.
- Do not touch the playback files in the main checkout or run `mobile:check` there while other agents are active.
- Do not push to `main` directly; do not release or build an APK by hand (GitHub Actions owns release builds).
- Report faithfully: say what was run and what was not.

## 14. Continuation instruction

Start with section 11. Re-check both PRs on GitHub first, because merges may have happened since this was written. Do not start new feature work; the two fixes are complete and only need merging and a phone check.
