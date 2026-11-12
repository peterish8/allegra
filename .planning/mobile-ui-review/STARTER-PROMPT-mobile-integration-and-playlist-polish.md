Copy everything below the line.

---

# Task: finish the LuvLyrics mobile integration and ship the playlist, scan, cover-flip and unified-menu work

You are a cloud Claude session continuing work on **Allegra** (GitHub `peterish8/allegra`). The mobile app is **LuvLyrics** in `apps/mobile` (Expo SDK 54, React Native 0.81, Reanimated 4, Gesture Handler 2.28, Android). You have no memory of earlier sessions. Everything you need is in the repo on branch `docs/integration-plan-and-log-summary` (PR 88). Check that branch out first.

## 1. Read first, in this order

1. `.planning/mobile-ui-review/HANDOFF-2026-11-13-mobile-integration-and-playlist-polish.md` (state, decisions, file pointers, open questions)
2. `CLAUDE.md`, `apps/mobile/CLAUDE.md`, `apps/mobile/DESIGN.md`, `apps/mobile/src/ui/AGENTS.md` (hard rules)
3. `.planning/MOBILE-INTEGRATION-PLAN-2026-11-13.md` (product contract) and `.planning/mobile-ui-review/QA-LOG-SUMMARY-2026-11-13.md` (what old logs do and do not prove)
4. `.planning/mobile-ui-review/cook-2026-11-13/` (BRIEF, SHOTS, ROUNDS of the previous cook run) and `.planning/mobile-ui-review/HANDOFF-2026-11-06-round6.md` (approved design direction)

## 2. End result expected

When you are done, all of this is merged to `main`, built by CI into an APK that launches, and proved on an emulator or phone:

1. **Two unverified branches landed.** `feat/discovery-polish` (Quick Picks, Daily Discovery grid, search categories, mood recommendations, native transport controls) and `fix/mobile-album-artist-scroll` (catalog album screen, artist releases). They were pushed without any checks. Both contain `CatalogAlbumScreen.tsx` and `catalogSearch.ts`; resolve that conflict deliberately.
2. **One unified song menu.** Long press on any song row (playlist, library, search, stream) and the three dots in the mini player open the **same** sheet. It combines the playlist actions (play next, add to queue, find lyrics and so on) with the global actions, including a **big Download song button**. Action categories are kept. One action model, one presenter; the older duplicate menus are deleted.
3. **Playlist header.** Opening a playlist directly shows no find bar. Pulling down from the top (overscroll) reveals it, tracked by the finger, with focus. The back arrow and the three-dots button lose their round disc overlay (plain icons readable over the hero). Pointers: `apps/mobile/src/screens/PlaylistDetailScreen.tsx` lines about 427 and 521 to 543.
4. **Scan with a LuvLyrics code works.** Scanning a code made by the app's own share sheet returns a result almost instantly, the user can save it, and the scan, resolve and save sequence has a designed, "like a magic web search" animation. Pointers: `screens/ScanCodeScreen.tsx`, `services/share/scanImage.ts`, `services/share/openShare.ts`, `services/share/shareService.ts`, `components/share/LuvCode.tsx`, `screens/SharedPlaylistScreen.tsx`, `packages/shared` luvCode. First reproduce whether it fails today.
5. **Cover flip and swipe deck.** Double tap on a playlist cover flips it to the swipeable song deck. The flip and the swipes track the finger, release with a spring using the gesture velocity, are interruptible mid-motion, and feel snappy. Pointer: `components/playlist/CoverFlipCard.tsx` (currently `withTiming(FLIP_MS)`), helpers in `components/playlist/playlistPage.ts`.
6. **Rest of the integration plan** as time allows: Daily Discovery grid, Made for You daily persistence, Luvs card stack, native transport responsiveness.
7. **Evidence** on every PR (screenshot or recording, CI run link, test output) and a final report to the owner.

"Done" for an animation means: it passed the cook bar (section 5), it holds at 60 fps on the emulator trace, reduced motion collapses to opacity, and the owner's taste is respected (neat, minimal, clear frosted glass, subtle glow, icon-only buttons, no clutter, no dark veils).

## 3. Method: Theo's T3 Stack principles on this repo's stack

- Modular and optional: small narrow modules, one job each, one owner per concern.
- End-to-end type safety: strict TypeScript, no `any`, shared DTOs in `packages/shared`, runtime validation at every boundary (provider responses, scanned codes, API data), explicit error and empty states.
- One contract per feature (recommendations, song actions, share codes). Change the contract doc first, then both sides.
- Do not add a second stack (no tRPC, no second auth or database) just to match a name. Convex, Express and Expo stay.
- Ship small and often: one vertical slice per PR, tests with it, deployable at every merge.

## 4. Skills to use (load with the Skill tool if present; skip any that are missing)

| Need | Skill |
|---|---|
| Animation slices (loop, bar, critics) | `cook` |
| Motion design and gesture feel | `cinematic-ui-motion`, `micro-interactions`, `web-animation-design` |
| React Native / Expo rules | `expo-react-native-expert`, `vercel-react-native-skills`, `building-native-ui` |
| UI taste, anti-slop | `unslop-ui`, `design-taste-frontend`, `unslop` (for PR text and docs) |
| Logic with tests first | `tdd` |
| A bug you cannot explain | `systematic-debugging`, `diagnosing-bugs` |
| Before merging | `verifying-agent-work`, `code-review` |
| Convex files (if touched) | read `convex/_generated/ai/guidelines.md` first |

Use the code-graph tools if the cloud environment has them; otherwise grep.

## 5. How to follow: the cook loop for every animation slice

Applies to the playlist header pull-down, the scan animation, the cover flip and the menu sheet.

1. Write `cook/BRIEF.md` (git-ignored; copy the format from `.planning/mobile-ui-review/cook-2026-11-13/BRIEF.md`). Bar: **9/10 per dimension**: composition, light and glow, color, glass and materials, detail, motion.
2. Build the slice yourself. Capture stills (and a short recording for motion) of each state: closed, mid-gesture at about 35% and 70%, open.
3. Spawn at least two fresh **zero-context critic subagents** (Sonnet, medium effort) per round. Give each only the stills, the brief and the bar. They score each dimension and name the weakest.
4. Fix the weakest dimension, log the round in `cook/ROUNDS.md` (scores, what changed, what stayed unproved), repeat until the median clears the bar.
5. Summarize the final rounds into `.planning/mobile-ui-review/` and commit that summary; do not commit `cook/` itself.
6. A local Android build is broken; every round that needs a rebuild needs a CI APK (about 15 minutes). Batch several fixes per round.
7. Lesson from the previous run: keep moving parts clamped inside their container (a quadratic ease once let the cover escape the sheet).

For non-animation slices (merging the two branches, the action model, the scan fix) use tests first and skip the cook loop.

## 6. Constraints (do not break these)

- **Motion:** animate `transform` and `opacity` only. Every duration and easing comes from the token file (`Motion` in `apps/mobile/src/constants/allegraTheme.ts`). `prefers-reduced-motion` collapses to opacity and never disables a feature. Worklet safety (`src/workletSafety.test.ts`). Use UI from `src/ui`. No new dependencies.
- **Playback invariants (CLAUDE.md):** all play and pause through `requestPlayback`; load effects never depend on `isPlaying`; a seek pauses and then resumes. Keep the single audio owner; do not remount it.
- **Code:** TypeScript strict, no `any`, no `console.log` in production paths. Edit code with the Edit tool, never python or sed rewrites. A matcher or scorer change bumps its cache key version. `packages/shared` changes need `npm run sync:shared`. `docs/api-contract.md` is the contract; update it before changing a response shape.
- **Privacy:** no session replay or Sentry replay SDKs.
- **Version:** every change that rebuilds the APK bumps `expo.version` in `apps/mobile/app.json` (patch for fixes, minor for features). The previous branches already bumped to 1.52.x; take the next free number, check `main` before bumping.
- **Commits:** conventional (`feat(mobile):`, `fix(mobile):`, `docs:`), short imperative subject, no AI attribution footers. Work on `feat/`, `fix/`, `chore/`, `docs/` branches, small PRs, squash-merge.
- **Tests:** every bug fix ships a regression test. Run the full local check before merging a feature: `node_modules/.bin/tsc.cmd --noEmit` in `apps/mobile`, then from the repo root `npm run typecheck`, `npm run lint`, `npm test`, and `npm.cmd run mobile:check` (do not overlap it with `npm.cmd run convex:test`).
- **Never** delete branches or git worktrees without asking the owner. If you use worktrees, `rmdir` the `node_modules` junctions before `git worktree remove`.
- Do not present a control that does nothing as a feature. Do not claim something works unless you ran it. Report skipped checks honestly.

## 7. Merge authority

You may merge each PR yourself when you are satisfied: typecheck, lint, tests and `mobile:check` pass, CI is green, the APK launches, and you have emulator or phone evidence for the change. Squash-merge, then continue to the next slice. If you cannot prove a slice (for example there is no emulator in your environment), do not merge it: say exactly what is unproved and ask the owner to test the CI APK. The owner authorised integration, polish, version bumps and merges on these terms.

## 8. Work order

1. `git fetch`; check out `origin/feat/discovery-polish` and `origin/fix/mobile-album-artist-scroll`. Run typecheck, lint and tests on each; fix failures; resolve the shared-file overlap; open PRs; wait for the CI APK; exercise the new screens; merge.
2. Unified song menu (end result 2). Build the action model with unit tests first, then the sheet, then replace every call site and delete the old menus. Existing pieces: `components/player/MiniSongMenu.tsx`, `components/player/NativeSongActions.tsx`, `components/library/useSongActions.tsx`, `components/stream/useStreamSongActions.tsx`, `ui/SongRow.tsx`, `ui/ListRow.tsx`, `components/stream/NativeTrackRow.tsx`, `components/PlaylistItem.tsx`.
3. Playlist header (end result 3), cook loop.
4. Scan flow (end result 4): reproduce, fix, instant result, save, cook the animation.
5. Cover flip (end result 5), cook loop, keep the `playlistPage` tests green.
6. Remaining items of the integration plan.

One slice per branch and PR. For each: tests, checks, version bump, push, CI APK, install and exercise on the emulator, attach evidence, merge.

## 9. Open questions

Use these defaults and tell the owner what you chose. Ask once only if a question blocks you.
- Pull-down reveal also focuses the input: yes.
- "Global dropdown": build a bottom sheet with the same visual language as `MiniSongMenu`, because a true dropdown does not fit one-handed use.
- Scan result auto-save: no; show the result card with a Save button.

## 10. Reporting

After each merged slice tell the owner: PR link, version, what was proved and how (screenshot or recording), what is still unproved, and the next slice. Finish with a summary of everything merged and a list of anything the owner must test on a physical phone (HEVC canvas video, native transport controls, release-build behavior).
