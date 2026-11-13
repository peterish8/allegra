Copy everything below the line into a new session.

---

You are continuing work on **LuvLyrics** (Android app in `apps/mobile`) in the repo `C:\dev\allegra`, branch `fix/playback-edge-cases`. The goal: finish the Apple Music style mini player to Now Playing transition and the new full-width Create sheet, both already implemented in the working tree but not verified or committed.

Do not rely on earlier conversations. Read, in order:
1. `C:\dev\allegra\.planning\mobile-ui-review\HANDOFF-2026-11-12-player-create-transition.md`
2. `C:\dev\allegra\CLAUDE.md`, `C:\dev\allegra\apps\mobile\CLAUDE.md`, `C:\dev\allegra\apps\mobile\DESIGN.md`, `C:\dev\allegra\apps\mobile\src\ui\AGENTS.md`
3. `C:\Users\nithy\.t3\scratch\luvlyrics-player-prototype\index.html` (the prototype the owner approved)
4. `apps/mobile/src/navigation/usePlayerSheetMotion.ts`, `playerTransition.ts`, `sheetProgress.ts`, `components/player/CoverGhost.tsx`, `components/nav/CreateSheet.tsx`

What the owner approved: applying the prototype's motion to the app ("ok i like the animation do same now for our app!") and a full-width Create sheet that hides the mini player. What the owner has **not** approved: commit, push, merge, version bump, new dependencies. Ask before any of those.

Work order:
1. Run `git status` and `git diff --stat`. The tree contains unrelated unfinished playback work; leave it alone and never stash, reset or stage it by accident.
2. Fix `ConnectRemotePlayer.tsx` worklet calls (`settle`, `beginDrag`) so `apps/mobile/src/workletSafety.test.ts` passes.
3. Restore `MiniPlayerGlow` in `MiniPlayer.tsx` so `src/ui/round7.test.ts` passes, and update `src/navigation/fluidPlayerGuard.test.ts` to check `usePlayerSheetMotion.ts`.
4. Run `npm run typecheck`, `npm run lint`, `npm test`, `npm.cmd run mobile:check`; then `npm.cmd run convex:test` on its own. All must exit 0.
5. Get the app running on an emulator or phone (debug build from `apps/mobile/android`, see handoff section 9 item 4) and walk the validation list in handoff section 11 step 4. Confirm audio does not reload and the queue does not change.
6. Resolve or document the `CoverGhost` transform-only rule conflict. Add a regression test for each bug you fix.

Open questions: ask the owner once if you must; otherwise use the defaults in handoff section 12.

Report back with: which suites pass, what you saw on the device (or exactly why you could not run one), what changed, and what you need approved. Keep replies short and concrete. Wait for approval before committing.
