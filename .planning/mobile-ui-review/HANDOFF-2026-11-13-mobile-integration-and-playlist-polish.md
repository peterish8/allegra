# Handoff 2026-11-13: mobile integration, album/artist work, playlist polish and unified song menu

Written at the end of a Codex session that ran out of credits. The owner asked for everything to be committed and pushed to GitHub with no further checks, so a cloud Claude session can read the code. **Nothing in the uncommitted work below was verified on a device or APK.** Treat it as unverified until you prove it.

## 1. Read first

1. This file.
2. `C:\dev\allegra\.planning\mobile-ui-review\STARTER-PROMPT-mobile-integration-and-playlist-polish.md`
3. `CLAUDE.md` (repo root), `apps/mobile/CLAUDE.md`, `apps/mobile/DESIGN.md`, `apps/mobile/src/ui/AGENTS.md`
4. `.planning/MOBILE-INTEGRATION-PLAN-2026-11-13.md` (product contract: LightFM, Quick Picks, Daily Discovery, Made for You, Luvs, native transport)
5. `.planning/mobile-ui-review/QA-LOG-SUMMARY-2026-11-13.md` (what the archived logs do and do not prove)
6. Older handoffs, still relevant: `.planning/HANDOFF-2026-11-12-update-watcher-and-download-lyrics.md`, `.planning/mobile-ui-review/HANDOFF-2026-11-12-player-create-transition.md`, `.planning/IMPLICIT-STATE-MACHINES-2026-11-13.md`
7. `.planning/mobile-ui-review/HANDOFF-2026-11-06-round6.md` (approved design direction)

## 2. Project context

Allegra monorepo, repo `peterish8/allegra`. Mobile app is LuvLyrics (Expo, React Native, Android) in `apps/mobile`, not an npm workspace: run `npm install` inside it. GitHub Actions builds the APK (`mobile-apk.yml` publishes `apk-latest` from main after checks and emulator launch). Any change that rebuilds the APK bumps `expo.version` in `apps/mobile/app.json` (patch for fixes, minor for features).

Commands (from `apps/mobile`): `node_modules/.bin/tsc.cmd --noEmit`; full check from repo root `npm.cmd run mobile:check`; Convex tests `npm.cmd run convex:test` (do not overlap with `mobile:check`). Commits are conventional, no AI footers in this repo's own convention, short imperative subject. (The harness may add a Co-Authored-By line; the repo rule says no AI attribution footers, so the repo rule wins unless the owner says otherwise.)

## 3. Goal and current status

Overall goal: ship the mobile integration plan one vertical slice at a time, with neat, finger-controlled, magical animation and no "vibe-coded slop". Status: the Media3 crash fix is merged-ready in PR 85 (proved: 10 rounds, 0 crashes, "cardigan" with canvas on). Album/artist work, discovery/Quick Picks work and native transport work exist as uncommitted changes in three worktrees that this session committed and pushed (section 6). The new playlist and menu requests in section 5 are **not started**.

## 4. Decisions and approvals

| Date | Decision | Owner's words | Status |
|---|---|---|---|
| 2026-11-13 | Integration, polish, version bumps and merges authorised after checks pass | (plan doc, "Owner authorized integration, polish, version bumps and merges after passing checks") | approved |
| 2026-11-13 | Commit everything to GitHub, skip checks, because credits ran out | "do now dont do any checks and stuffs just commit! as we dont have credits" | approved, done |
| 2026-11-13 | Cloud Claude continues from GitHub | "so it will continue from there like it can see code not just in my local laptop" | approved |
| 2026-11-13 | Keep Quick Picks list, name grid Daily Discovery, keep Jump back in | integration plan | approved |
| 2026-11-13 | Playlist, scan, flip-card and unified menu requests (section 5) | quoted there | requested, open design |
| 2026-11-06 | Mobile redesign: neat, minimal, modern, frosted, depth | memory `mobile-redesign-direction-approved` | approved |

The next agent may commit, bump versions, push and merge once typecheck, lint and tests pass and the work is proved on the emulator. It must ask the owner before anything destructive (deleting branches or worktrees; see the junction warning in section 13).

## 5. New requests from the owner (verbatim, then reading)

> if opened playlist directly it shld not show search bar horizontal only if we swipe up to down then it opens in up that smartness! and three dots there no need the round overlay same for the arrow in left

- On open, the playlist screen hides the "Find in playlist" bar. Pulling down (overscroll at top) reveals it, like iOS list search. Remove the round disc backing from the back arrow and the three-dots button (use plain icons, readable over the hero).
- Today: `PlaylistDetailScreen.tsx:427` always renders the find bar (`findBar`); `:524` back is `IconButton ... shape="disc" variant="secondary"`; `:529` options is the same. `isSearchActive` state is at `:108`.

> make sure the scan with luvlyrics custom code shld work ! and instantly they shld get result and they could save and that process the animation u make it wonderful and like magic like proper web search best neat magic like animations and do it! no vibe coding slop i want! i want neat ui animation for that !

- Scan flow must work end to end and return a result instantly, then let the user save it. The scan to result to save sequence gets a designed animation (scanner lock-on, code resolves into the shared playlist card, save confirms). Animate `transform` and `opacity` only, durations and easing from tokens, reduced-motion collapses to opacity (apps/mobile/CLAUDE.md governs mobile motion; check it for the mobile token location).
- Code: `apps/mobile/src/screens/ScanCodeScreen.tsx` (uses `readCodeFromPhoto`, `SCAN_BUDGET_MS` from `services/share/scanImage.ts`, `checkShareTarget` and `openShareTarget` from `services/share/openShare.ts`, `targetForPayload` from `services/share/shareService.ts`), `components/share/LuvCode.tsx`, `screens/SharedPlaylistScreen.tsx`, shared codec `packages/shared` `luvCode`. **Unverified:** whether scanning currently fails and where. Reproduce on the emulator first with a code generated by the app's own share sheet (`components/share/ShareSheet.tsx`).

> and the swiping in cover art in playlist after double tapping the cover art cover it flips to swipeable thing that one make the animation magical again wonderful animation neat smooth snappier and controllable in fingers neatly!

- `components/playlist/CoverFlipCard.tsx`: double tap flips the cover to a swipeable song deck. Rework so the flip and the swipe track the finger (gesture-driven shared values, spring release with velocity, interruptible mid-flip), snappier than the current `withTiming(FLIP_MS)` at `:57`. Pure helpers live in `components/playlist/playlistPage.ts` (`deckStartIndex`, `FLIP_MS`, `settledCard`, `swipeChangesSong`); keep their tests green.

> and inside the playlist if i long press a song it shows all the options play next find lyrics and stuffs but i wanted those global things to show download song big btn and stuffs that thing ! maybe all those and this all together u combine into one big proper thing! and yeah u can keep categories too! and show a global dropdown for any song long pressed or those three btns in the mini player!

- One unified song menu used everywhere: long press on any song row (playlist, library, search, stream) and the three-dots button in the mini player open the same sheet. It combines the playlist menu actions (play next, find lyrics, add to queue and so on) with the "global" mini-player menu (a big Download song button and its neighbours). Keep action categories. 
- Existing pieces to merge: `components/player/MiniSongMenu.tsx` (the mini-player menu, branch `feat/mini-song-menu`), `components/player/NativeSongActions.tsx`, `components/library/useSongActions.tsx`, `components/stream/useStreamSongActions.tsx`, row long press in `ui/SongRow.tsx`, `ui/ListRow.tsx`, `components/stream/NativeTrackRow.tsx`, `components/PlaylistItem.tsx`.
- Build one action model (one list of actions with category, availability per song/context) and one presenter, then delete the duplicates. Do not leave two menus.

## 6. What was done this session and where it lives

Merged-ready / pushed:
- PR 85 `fix(mobile): stop canvas videos...` (Media3 alignment, song menu, shelf rename, reorder fix). Proved on APK 1.52.0: 10 rounds, same PID, 0 fatal, 1,625 canvas video events. The emulator cannot decode the HEVC clip, so the final frame shows the cover; this proves no crash, not physical-device codecs.
- PR 86 (merged) polished the player transition (1.52.1).
- PR 84 `feat/mobile-player-transition` still open; branch `feat/mobile-player-cook` and `feat/mobile-player-transition` have the same `apps/mobile` tree (`8f8bec56`).
- PR 88 `docs/integration-plan-and-log-summary` (this branch): plan, QA log summary, and now these handoff files.

Committed this turn only to preserve work (unverified, no checks run):
- `C:\dev\allegra-player-release`, branch `fix/mobile-album-artist-scroll`: catalog album screen, artist releases screen, artist discovery, `YTMusicClient`/`browse.ts` changes, `app.json` version change. Typecheck passed and 19 focused tests passed before the commit; not built into an APK and not looked at on the emulator.
- `C:\dev\allegra-discovery-polish`, branch `feat/discovery-polish`: Quick Picks screen and store, live quick picks, mood recommendations, search categories and session store, native transport module (Kotlin `NativeTransportModule.kt`, `NativeTransportView.kt`, `NativePlaybackControl.tsx`), saved Quick Picks, generated playlist queries, mini player changes. Unverified. The native Kotlin files have never been compiled in CI.
- Source backups on the owner's laptop only (not in git): `cook/verify/discovery-source-backup-2026-11-13.zip`, `cook/verify/album-artist-source-backup-2026-11-13.zip`, `output/recommendations/enriched/playlist-model.json` (3.5 MB LightFM model output, not committed).

## 7. Where everything lives

| Artifact | Purpose |
|---|---|
| `C:\dev\allegra` branch `docs/integration-plan-and-log-summary` | plan, handoffs, this file (PR 88) |
| `C:\dev\allegra-player-release` / `fix/mobile-album-artist-scroll` | album and artist work |
| `C:\dev\allegra-discovery-polish` / `feat/discovery-polish` | discovery, Quick Picks, native transport |
| `C:\dev\allegra-mini-song-menu` / `feat/mini-song-menu` | mini-player song menu (clean, 14d1fec1) |
| `C:\dev\allegra-download-lyrics` / `fix/download-without-lyrics` | download independent of lyrics (clean) |
| `C:\dev\allegra-webfix` / `fix/web-review-followups` | web follow-ups (clean) |
| `C:\dev\allegra\.claude\worktrees\agent-a063ba2a5d74ad04b` / `feat/mobile-player-cook` | cook agent worktree, locked |

All local worktrees are siblings of `C:\dev\allegra`. On a cloud machine only the pushed branches exist; check them out from `origin`.

## 8. How to work with the artifacts

- Open a branch in a fresh worktree: `git worktree add ../allegra-<topic> -b <branch> origin/main`.
- APK: push a branch with a PR; `mobile-apk.yml` builds `LuvLyrics-apk`. Download with `gh run download <run-id> -R peterish8/allegra -n LuvLyrics-apk -D <dir>`. Install on the emulator, then drive it with the mobile MCP tools or adb.
- Crash stress test: open the player on "cardigan" (Taylor Swift) with canvas on, flip the cover, 10 rounds, record the app PID each round, read logcat for `FATAL`/`AbstractMethodError`. Ignore `UiAutomationService ... already registered` noise (see the QA log summary).
- Gotcha: worktrees use junctions for `node_modules`. `rmdir` the junctions before `git worktree remove`, or it wipes the main checkout (memory `worktree-junction-gotchas`).

## 9. Verified facts

- `PlaylistDetailScreen.tsx:427,521-543` find bar, back and options buttons as described in section 5 (read this session).
- `CoverFlipCard.tsx:57` flip uses `withTiming(next ? 1 : 0, { duration: FLIP_MS, easing: Motion.ease.standard })`; `:82` double tap gesture (read this session).
- `ScanCodeScreen.tsx` imports at lines 13-17 (read this session).
- PR 85 crash fix evidence: section 6.
- `git rev-parse origin/feat/mobile-player-cook:apps/mobile` equals `origin/feat/mobile-player-transition:apps/mobile` = `8f8bec5636e8fcaa55ad0adc3f21d135103a3daa`.

Not re-checked: that the scan flow currently works or fails; that the Kotlin native transport compiles; that the unified menu's duplicate components are all the ones listed.

## 10. Known problems and findings

- Release-build immunity to the React Native dev-inspector NPE is not established (QA log summary).
- The emulator cannot decode HEVC canvas video; physical-phone codec behavior is untested.
- Uncommitted-then-committed work was never run in CI. Expect type or lint errors; fix them before merging.
- Two song menus exist today (playlist long-press menu and the mini-player menu); behavior differs.

## 11. Remaining work, prioritised

1. Get `feat/discovery-polish` and `fix/mobile-album-artist-scroll` green (typecheck, lint, tests, CI APK, emulator launch), open PRs, merge. Done = CI green and an emulator screenshot of each new screen.
2. Unified song menu (section 5). Done = one component and one action model; long press anywhere and the mini-player dots open it; Download is a large button; categories kept; old menus deleted; tests for the action model; emulator proof on a playlist row, a search row and the mini player.
3. Playlist header: hide find bar until pull-down, plain icons without discs. Done = opens without the bar, pull-down reveals it with a finger-tracked transition, Cancel hides it, no layout jump, reduced-motion safe.
4. Scan flow: reproduce, fix, instant result, save, designed animation. Done = scanning an app-generated code on the emulator reaches the result card and saves; a short screen recording.
5. CoverFlipCard rework: finger-tracked flip and deck swipe with spring and velocity. Done = flip is interruptible, 60 fps trace on the emulator, existing `playlistPage` tests pass.
6. Remaining product contract items in the integration plan (Daily Discovery grid, Made for You daily persistence, Luvs card stack, native transport responsiveness).

## 12. Plan for the next agent

Work one slice per PR, branched from fresh `origin/main` unless a slice depends on an unmerged branch. Order: 1, then 2 (3 and 4 can reuse its sheet and header primitives), then 3, 4, 5, 6. For each slice: tests first where logic exists, typecheck, lint, `npm.cmd run mobile:check`, version bump in `app.json`, push, wait for CI APK, install and exercise on the emulator, attach evidence to the PR, then merge.

Design guidance for the animations: `apps/mobile/DESIGN.md`, the clear-glass taste memory (frosted glass, no dark veils, subtle glow, icon-only buttons, no clutter), and the `cinematic-ui-motion`, `micro-interactions` and `web-animation-design` skills. Use Reanimated shared values driven by gestures; spring on release; never animate layout properties.

## 13. Open questions (use the default if the owner does not answer)

- Should the pull-down reveal also focus the input? Default: reveal and focus.
- Should the unified menu be a bottom sheet or a dropdown? The owner said "global dropdown"; default: a bottom sheet anchored from the bottom with the same visual language as `MiniSongMenu`, since a true dropdown does not fit a one-handed phone layout. Tell the owner.
- Should the scan result auto-save? Default: no; show the result card with a Save button.

## 14. Rules and guardrails

- `CLAUDE.md` hard rules: animate `transform` and `opacity` only; durations and easing from tokens; reduced motion collapses to opacity; TypeScript strict, no `any`; no `console.log` in production paths; never edit source with python/sed scripts (use the Edit tool).
- Version bump on every APK-affecting change. Conventional commits.
- Every bug fix ships a regression test. Run a full local check before merging a feature.
- Do not delete branches or worktrees without asking; rmdir junctions first.
- Privacy: no session replay SDKs.

## 15. Continuation instruction

Read the starter prompt, then check out `origin/feat/discovery-polish` and `origin/fix/mobile-album-artist-scroll`, run typecheck and tests on each, and fix what breaks. Report to the owner after each merged slice with the PR link and emulator evidence. Ask the owner only if a question in section 13 blocks you.
