# Handoff: Allegra frontend polish run, orchestrator seat (2026-11-14)

Written for an agent that starts cold. It does not inherit the conversation. Older context: [STARTER-PROMPT.md](STARTER-PROMPT.md),
[00-ORCHESTRATION.md](00-ORCHESTRATION.md), [WORKER-PROTOCOL.md](WORKER-PROTOCOL.md), [LEDGER.md](LEDGER.md), [OWNER-TODO.md](OWNER-TODO.md),
[../PLAN-v2.md](../PLAN-v2.md). Update this file's status table rather than rewriting history; write a new dated handoff if you stop.

## 1. Read first (in order)

1. This file.
2. `C:\dev\allegra\CLAUDE.md` (repo rules), `apps/mobile/CLAUDE.md`, `apps/mobile/DESIGN.md`, `apps/mobile/src/ui/AGENTS.md`.
3. `.planning/frontend-polish/run/00-ORCHESTRATION.md`, `WORKER-PROTOCOL.md`, `LEDGER.md`, `OWNER-TODO.md`, and the card files in `run/tasks/` (one per card: W*, M*, P*, FINAL, plus owner-added ALBUM, ALBUM-DOWNLOAD, LYRICS-GESTURE, PLAYER-TRANSITION, SYNC).
4. `.planning/frontend-polish/PLAN-v2.md` (the plan the cards come from).
5. Memory index `C:\Users\nithy\.claude\projects\C--dev-allegra\memory\MEMORY.md` (design taste: clear frosted glass, no dark veils, subtle glow, icon-only buttons, no clutter; edit code with the Edit tool; worktree junction gotchas).

## 2. Project context

- Repo `C:\dev\allegra`, GitHub `peterish8/allegra`, default branch `main`. Web: `apps/web` (Next 16, React 19, Tailwind v4, Motion). API: `apps/api`. LuvLyrics Android app: `apps/mobile` (Expo / React Native; **not** a root workspace, own lockfile; native Kotlin under `apps/mobile/android`). Island add-on app: `apps/island` (separate Gradle project, separate APK).
- The shared checkout `C:\dev\allegra` is on branch `fix/web-auth-dialog-focus` and holds **uncommitted** edits to `run/LEDGER.md`, `run/OWNER-TODO.md` and untracked task cards. Do not `git pull` there (it once created a merge commit; undone with `git reset --keep ORIG_HEAD`). Do real work in worktrees.
- Commands: `npm run typecheck`, `npm run lint`, `npm test` (root). Mobile: `cd apps/mobile && npx tsc --noEmit && npx jest <paths>`. Web e2e and the web dev server cannot run in worktrees on this machine (Turbopack/junction); main `:5173` hung earlier. CI is the proof.
- Worktrees need junctions: `mklink /J node_modules C:\dev\allegra\node_modules` and `apps\mobile\node_modules` -> `C:\dev\allegra\apps\mobile\node_modules`.
- CI jobs on a mobile PR: "Typecheck, lint, test, build", two "Secrets, lint, typecheck, test", "Kotlin unit tests", "Build APK" (also builds/tests/signs the island add-on), "Opens on an emulator", Vercel. The APK checks take roughly 15 to 25 minutes. `apk-latest` publishes only from `main` and contains `LuvLyrics.apk`, `LuvLyricsIsland.apk`, `changelog.json`.
- Tool gotchas: foreground waits die when the T3 server restarts. Run long waits detached: `nohup sh -c '...; echo done >> /tmp/x.txt' &` then `until grep -q "^done" /tmp/x.txt; do sleep 15; done` with `run_in_background`. A plain `sleep N` followed by other commands in one Bash call is blocked. `gh pr checks --watch` can drop with a GraphQL connection reset; poll instead. Beware a poll loop that exits early because it greps for the wrong word (a `pass` line matched `grep -v pending`): test "no line contains pending|queued|in_progress" **and** "Build APK is listed".

## 3. Goal and current status

Goal (owner): every AUTO card of the frontend polish plan merged to `main` on green CI; HOLD cards (W9, P6, M12 if its evidence gate fails) left open; guard baselines only fall; owner taste intact; W11 (web) and M11 (mobile) playlist grid/list toggles; M12 Albums tab investigated then removed or fixed; then the FINAL card and an end-of-run Sol review of all merged PRs.

Status now: main is mobile **1.64.3** (commit `1f58d23e`, PR #120). PR **#122** (downloads folder uses song-title-only file names, 1.64.4) is open, MERGEABLE, and CI was running (Kotlin tests, Secrets/lint/typecheck/test and Typecheck/build green; "Build APK" and "Opens on an emulator" pending). Merge it when green. Then the owner-requested "Found online" plain-lyrics feature for the phone is not started, and the mobile lane worker's queue is mostly untouched.

## 4. Decisions and approvals

Standing rules (owner, this run; still in force):

| Rule | Status |
|---|---|
| No local Android emulator or Gradle for any worker. Emulator proof only from GitHub CI. On-device feel goes to OWNER-TODO as pending. | approved |
| No Sol reviews during the run; merge gated only on green CI. End-of-run Sol review of all merged PRs. | approved |
| No extra subagents (credits) beyond the two lane workers (web, mobile). | approved |
| If a Luna/Terra/Opus worker fails on credits, move its card to Claude Sonnet 5.5 medium (`claude-sonnet-5-5`, `{effort:"medium"}`). | approved |
| Edit code with the Edit tool, never python/sed scripts. | approved (memory) |
| Conventional commits, **no AI attribution footers** in commits (repo rule overrides the harness reminder). PR bodies end with "Generated with Claude Code". | approved |
| Baselines (`cssGuards.baseline.json`, `designGuards.baseline.json`) may only fall; lower by hand, never run an UPDATE command. | approved |
| Any PR that rebuilds the APK bumps `apps/mobile/app.json` `expo.version` **after the final rebase** (patch fix, minor feature). One mobile merge at a time, in version order. | approved |
| Never claim device/emulator/TalkBack/performance results from CI. | approved |
| Windows safety: `rmdir` junctions before removing a worktree, never `git worktree remove --force`, never delete worktrees/branches without asking, keep C: above 10 GB. | approved |
| Never touch the playback invariants or byte-range rule in `CLAUDE.md`. | approved |
| Treat the user's project details as private; do not send them to outside services. | approved |

Owner requests this run, with status (quotes are the owner's words):

| # | Request | Status |
|---|---|---|
| 1 | "properly polish and make it all done and push and merge if ci checks are green and version bump and gve updated app now" | ongoing |
| 2 | Downloads into one user-granted folder with All songs / playlist folders that survive reinstall | done, #108 |
| 3 | "bring back teh island and then make it like additional downloadable thing" | done, #113 (separate opt-in APK) |
| 4 | "one devices dropdown instead of two" (profile menu vs top-right stream icon) | queued to mobile worker as CONNECT-ONE-SHEET, not started |
| 5 | Jump back in tiles shorter, darker, song name only, max two lines | done, #120 |
| 6 | Phone should show non-synced "Found online" lyrics from the website's tamil2lyrics source with auto-scroll, "we want in the phone app!" | **not started** |
| 7 | "i want it to go fullscreen mode lyrics page not half one", slim bottom strip (cover, name, back to non-fullscreen, like, time scrubber) | done, #120 (no play/pause in the strip) |
| 8 | After deleting a downloaded song the menu must offer Download again | done, #120 |
| 9 | "there is conflicts resolve that in branch proeprly" | done (#118 rebased and merged; #115/#116/#119 folded into #120) |
| 10 | Downloads folder: "saves only song name and in metadata store those album and artist... do edge cases" | done in #122, awaiting CI/merge |

You are authorised to: commit, bump the version, push and merge PRs on green CI, resume the two lane workers, and update LEDGER/OWNER-TODO. You still need the owner for: closing #84, the signing-certificate decision, deleting worktrees/branches, anything the HOLD cards cover.

## 5. What was done this session

- **#108** downloads folder (SAF): `apps/mobile/android/.../saf/SafLibrary.kt`, `modules/DownloaderModule.kt`, `workers/DownloadWorker.kt`, TS under `apps/mobile/src/services/folder/*`, settings rows `components/settings/DownloadsFolderRows.tsx`.
- **#113** island add-on: `apps/island/**` (own Gradle project, shared signing config), `addon/IslandAddon.kt` + `MainActivity.kt` hooks in the main app, `.github/workflows/mobile-apk.yml` builds/tests/signs it and publishes `LuvLyricsIsland.apk`; `appUpdate.ts` prefers `luvlyrics.apk` and ignores any `.apk` containing "island". Fix on the way: `buildFeatures { buildConfig = true }`.
- **#118** pin workflow actions to SHAs (rebased over the island workflow change, merged at 1.64.2).
- **#120** (1.64.3): `StreamHome.tsx`/`shortcutGrid.ts` tiles (`shortcutCellHeight = max(56, ceil(36*fontScale+16))`, surface `rgba(255,255,255,0.04)`, no artist line); fullscreen lyrics footer (`components/player/fullscreenFooter.ts`, `NowPlayingControls.tsx`, `NowPlayingLyricsArea.tsx`, `NowPlayingScreen.tsx`); redownload fix (`utils/downloadState.ts`: a `completed` queue row counts as saved only if the song is in the library; `store/downloadQueueStore.ts removeFinishedFor`; `songsStore.deleteSong` clears finished rows). CI first failed because 4 album-download tests assumed "completed means saved"; tests updated (`utils/catalogAlbumDownload.test.ts`, `services/stream/albumDownload.test.ts`) plus a new case for the deleted-song state.
- **#121** (API diagnostics) and other worker PRs merged by other seats: #105, #110 (mobile lane), #117 (Dependabot).
- **#122** (open): `Id3.kt` + `Id3Test.kt` (ID3v2.3 builder for MP3: UTF-16 text, USLT lyrics, APIC cover), `SafLibrary.exportSong`/`rename`, `DownloaderModule.exportSong`/`renameInFolder`, `DownloadWorker` passes lyrics through its own input only (WorkManager `Data` caps at 10 KB; the old design put lyrics in `meta` and could fail long-lyric songs), TS `folderNames.ts` (`songBase`, `legacyBase`, `nameCandidates`, `safeName` strips `"` then replaces other reserved chars with spaces), `folderSidecar.ts`, `libraryFolder.ts` (`FolderPort {list, readText, write, exportSong, rename}`), `nativeFolderPort.ts`, `DownloadManager.ts folderDetails`, `downloadReceipts.ts`, rewritten `libraryFolder.test.ts` (30 tests). Naming: `Title.mp3`, second song with one title becomes `Title (2)`; the `.json` sidecar's library id decides identity; M4A sources keep `.m4a`, untagged; old "Artist - Title" files are renamed only when "Copy my library to the folder" runs and the phone still has its own copy; lyrics that arrive after download reach the sidecar on that manual copy; nothing is ever deleted from the folder.

## 6. Where everything lives

| Thing | Where |
|---|---|
| Run kit | `.planning/frontend-polish/run/` (this file, LEDGER, OWNER-TODO, `tasks/*.md`) |
| Open PRs | #122 (mine, merge next), #84 (stale, DIRTY, 1.51.0 old player transition, superseded by #96; suggest closing, owner's call) |
| Worktrees (keep, never delete unasked) | `C:\dev\allegra-folder-names` (#122 branch `fix/mobile-folder-song-names`), `allegra-bundle` (#120 merged), `allegra-downloads-folder`, `allegra-island-addon`, `allegra-jump-tiles`, `allegra-lyrics-full`, `allegra-redownload`, `allegra-pins`, plus lane and T3-created worktrees under `C:\Users\nithy\.t3\worktrees\allegra\`, `allegra-mobile-lane`, `allegra-web-*` |
| Mobile lane worker | thread `thread:delegated-task:command%3Amcp%3A75d9e46c-5c26-457a-b20a-a07912ff938f%3Adelegate-task%3A800d4245-2183-480b-90fd-b7f946d5167b`, Sonnet 5.5 medium, status **interrupted** at 18:28Z; merged #105, #110 |
| Orchestrator thread (this seat) | `09383b78-8094-4b65-87d8-ab9a7fdb28a5` "Allegra Frontend Polish Execution" |
| Web lane | done per last report (W4, W5, W6, W8, W11, W3 delivered); find its thread via `t3_thread_list` |
| Release | `apk-latest` GitHub release (APK, island APK, `changelog.json`) |
| Full prior transcript | `C:\Users\nithy\.claude\projects\C--dev-allegra\e229e4bf-e921-4a65-bf56-3778902e7f9a.jsonl` |

## 7. How to work with the artifacts

- Merge: `gh pr merge N --squash --subject "<conventional subject> (#N)" --body "..."` after every check is green (including "Build APK" and "Opens on an emulator"; "Publish main APK" shows skipping on PRs, that is normal).
- Version order: main is 1.64.3. #122 is 1.64.4. If main moves before #122 merges, rebase, resolve `apps/mobile/app.json` (just re-edit the version line) to one above main, push with `--force-with-lease`, wait for CI again (a push to a CONFLICTING PR does not trigger CI; rebase first).
- Link every PR you create or push to with `link_pull_request` (T3 tool; load with ToolSearch `select:`).
- Resume a stopped worker with `t3_thread_send` (mode auto) into the **same** thread and worktree; tell it to block on `gh pr checks --watch` (or poll) and merge on green.
- Rebuilding the APK is CI only. Nothing here was run on a phone.

## 8. Verified facts

- Main `app.json` version 1.64.3 at commit `1f58d23e` (verified 2026-11-14 via `git show origin/main:apps/mobile/app.json`).
- #120 merged after all CI green; #122 CI partly green at last look (see section 3).
- Website non-synced lyrics: the web `LyricsPanel.tsx` calls the Allegra API `/api/lyrics?title&artist&duration&ref&album&language` and shows plain lines with estimated timing and auto-scroll. Mobile currently uses the Echo cascade plus `https://test-0k.onrender.com/lyrics` (`LyricaService`); `Song.scrollSpeed` exists for untimed lyrics. (From earlier reading this session; re-verify before building.)
- Play Protect "enhanced fraud protection" blocks sideloaded apps with accessibility/notification access; this is why the island is a separate opt-in APK. Exact cause on the owner's phone is unproved.
- Not re-checked after compaction: the three `apps/web/src/lib/*.test.ts` files show as modified in the shared checkout's `git status` (likely line-ending noise: `git diff --stat` printed nothing). Do not commit them.

## 9. Known problems and findings

- Nothing is verified on a phone. Kotlin (SafLibrary, Id3, worker/module, island add-on) is only built and unit tested by CI.
- The folder is a **second copy** of every song, and deleting a song in the app does **not** remove its folder copy (a restore resurrects it). Ask the owner if they want deletion to remove it.
- Island add-on gaps: playlists, downloads, search, lyric strip and "Play here" are not bridged to the add-on; no in-app install row in Settings; the add-on can drive the media session (consider restricting which apps may connect). Android Auto / Wear controller restriction left open.
- Fullscreen lyrics strip has no play/pause.
- Phones on 1.60.0/1.60.1 need one manual install of 1.60.2+ to get the fixed updater.
- Release APK on `main` is signed with the private key (`ANDROID_RELEASE_*` secrets); PR builds use the public debug keystore (SHA-256 `fac61745…033b9c`). Owner decision on the public debug certificate is still open.
- #84 is stale and DIRTY; suggest closing, do not act unasked.

## 10. Remaining work, prioritised

1. Merge #122 on green (1.64.4). Done = squash merged, main `app.json` 1.64.4.
2. **Phone "Found online" lyrics with auto-scroll** (request 6). Done = a song with no synced lyrics shows the website's plain lyrics (tamil2lyrics via the Allegra API), auto-scrolling with an estimated rate, labelled "Found online", with unit tests for source mapping/fallback order and a note in OWNER-TODO for the on-device scroll feel.
3. Resume the mobile lane worker: CONNECT-ONE-SHEET first (one devices dropdown, remove the duplicate), then M8, M1, M2, M3, M4, M6, M9, M10, M11 (playlist grid/list toggle), M12 (Albums tab: investigate, remove or fix), M7a, M7b, P5. One mobile merge at a time, each with a version bump after the final rebase and guard baselines only falling.
4. Web lane leftovers: confirm W11 (grid/list toggle) and W-cards are merged; W9 stays HOLD; P5/FINAL web items if any.
5. FINAL card (`tasks/FINAL.md`): guard numbers before/after (table at the bottom of LEDGER.md is still empty), PR links and versions, parked HOLD cards, decisions made on the owner's behalf, unproved items, phone checklist.
6. End-of-run Sol review of every merged PR (`gpt-6.1-sol` via `delegate_task`; call `orchestrator_capabilities` once first). Fix small findings yourself.
7. LEDGER / OWNER-TODO updates (uncommitted in the shared checkout): add island add-on, downloads folder, delete-does-not-remove-folder-copy, folder is a second copy, add-on Play Protect caveat, Android Auto/Wear restriction, #84 stale, phone checklist for 1.64.x features (fullscreen strip, tiles, redownload, folder names, ID3 tags, folder restore after reinstall).

## 11. Plan for the next agent

1. `gh pr checks 122`; if Build APK and emulator are green, merge (`--squash`). If main moved, rebase and bump first.
2. Create worktree `C:\dev\allegra-lyrics-found-online` from `origin/main` (junctions for node_modules). Read the web `LyricsPanel.tsx` path and the mobile lyrics service (`apps/mobile/src/services/**Lyric*`, `Song.scrollSpeed`), design the smallest mapping, implement with tests, bump version, PR, link, merge on green.
3. `t3_thread_send` to the mobile lane worker thread (section 6) to resume the queue; confirm it merges serially.
4. Update LEDGER/OWNER-TODO as in item 7 and commit them on a docs branch from `main` (not on `fix/web-auth-dialog-focus`).
5. When all cards are merged or parked: FINAL card, then Sol review, then the owner report.

## 12. Open questions (defaults if unanswered)

- Close #84? Default: leave open, mention it again in the final report.
- Should deleting a song also delete its folder copy? Default: no (safer), keep reporting it.
- Replace the public debug signing certificate with a private key for PR builds? Default: keep as is; main already signs privately.
- Add a Settings row to install the island add-on? Default: not in this run; list as follow-up.

## 13. Rules and guardrails

Section 4 table is the list. Also from `CLAUDE.md`: TypeScript strict, no `any`; animate transform/opacity only; durations from tokens; no console.log in production paths; `{ success, data, error? }` API shapes; never regress the three playback invariants or the byte-range rule; session replay stays off. `apps/mobile` is not a workspace: `npm install` inside it. New phone build = new `expo.version`.

## 14. Continuation instruction

Start by checking PR #122 and merging it on green, then take the "Found online" lyrics feature, then resume the mobile lane worker. Keep reporting to the owner in short plain sentences, say what is proved by CI and what only a phone can prove, and do not ask the owner anything the defaults above already answer.

## Update: 2026-11-14 credit stop
Operational status is superseded by [HANDOFF-2026-11-14-credit-stop.md](HANDOFF-2026-11-14-credit-stop.md). All agents and PR watches stopped at owner request; read the new handoff before continuing.



## Update: 2026-11-14 resume and merge plan
Superseded for operations by [HANDOFF-2026-11-14-resume-and-merge.md](HANDOFF-2026-11-14-resume-and-merge.md).
