# Handoff 2026-11-12: Apple Music style player transition and Create sheet (LuvLyrics)

Status: **implementation started, not finished, nothing committed.** Automated checks are red (3 failing suites) and no
Android visual validation has happened. Written from the T3 thread "Research Apple Music Player Transition"
(thread id `4462b047-64e7-41b0-a51a-34ed22d078f0`, runs 1-6) after the Codex run hit its usage limit.

## 1. Read first

1. This file.
2. `C:\dev\allegra\CLAUDE.md` (hard rules, the three playback invariants, motion rules 5-7, "New phone build = new version number").
3. `C:\dev\allegra\apps\mobile\CLAUDE.md`, `apps\mobile\DESIGN.md`, `apps\mobile\src\ui\AGENTS.md`.
4. `C:\dev\allegra\.planning\mobile-ui-review\HANDOFF-2026-11-06-round6.md` (the approved mobile design direction) and `memory/mobile-redesign-direction-approved.md`.
5. The prototype the owner approved: `C:\Users\nithy\.t3\scratch\luvlyrics-player-prototype\index.html` (single file, was served at http://localhost:5199; the server is probably stopped, serve the folder statically or open the file).
6. Source of the motion: `apps/mobile/src/navigation/usePlayerSheetMotion.ts` (new), `playerTransition.ts`, `sheetProgress.ts`, `components/player/CoverGhost.tsx`.
7. To recover the full conversation: `t3_thread_read({threadId:"4462b047-64e7-41b0-a51a-34ed22d078f0", view:"activity", limit:20, maxCharsPerItem:4000})`.

## 2. Project context

- Repo `C:\dev\allegra`, branch `fix/playback-edge-cases`, HEAD `161d505c` (feat(mobile): notice a new build while the app is open, 1.49.1). `main` is the PR base.
- App: `apps/mobile` (LuvLyrics, Android). Expo SDK 54.0.33, React Native 0.81.5, React 19.1.0, Reanimated 4.1.6, Worklets 0.7.4, Gesture Handler 2.28.0 (lockfile-resolved, checked in thread run 1). Zustand store, Media3 owns audio, JS mirrors state.
- Other worktrees: `C:\dev\allegra-mini-song-menu` (`feat/mini-song-menu`, three-dot song sheet, **PR #81 still open, not merged**), `allegra-discovery-polish`, `allegra-download-lyrics`.
- Commands (from repo root unless noted): `npm run typecheck`, `npm run lint`, `npm test`, `npm.cmd run mobile:check`, `npm.cmd run convex:test` (do not run it concurrently with `mobile:check`). Single mobile test: `cd apps/mobile && npx jest src/navigation/playerTransition.test.ts`.
- Debug APK build: `cd apps/mobile/android && ./gradlew.bat :app:assembleDebug -PreactNativeArchitectures=x86_64 -x lint -x test` with `JAVA_HOME='C:/Program Files/Eclipse Adoptium/jdk-21.0.9.10-hotspot'`. Run it from `apps/mobile/android`; the previous run failed because of a wrong relative path inside a combined command.

## 3. Goal and current status

The owner wants the mini player to expand into Now Playing the way Apple Music does: one connected surface and artwork, soft spring, no repeated bounce, reversible mid-flight. Later they asked for the Create (+) button in the nav bar to open a full-width sheet above the nav bar while the mini player hides, modelled on a Spotify screenshot they supplied (image `image_0f91bd94...`, not stored in the repo), with Allegra's own Create actions inside.

Where it stands: research done and a recommendation given (improve the existing architecture, no new dependency). A web prototype was built and the owner said "ok i like the animation do same now for our app!". Codex then edited the app (player transition, Connect player, Create sheet, new tests). Root typecheck, lint and tests were reported green, but the later `mobile:check` run shows **3 failing suites** (section 9). The Android build failed in CMake before any visual check.

## 4. Decisions and approvals

| Date | Decision | Owner's words | Status |
|---|---|---|---|
| 2026-11-12 | Research first, no install or edits before approval | "Do not implement, install dependencies, edit files ... until I approve" | Superseded by the next two rows |
| 2026-11-12 | Show a phone-viewport prototype before touching the app | "can u properlu show a prototype just this part alone ... and if its satisfiend apply the same in our phone app" | Approved, prototype built |
| 2026-11-12 | Apply the prototype motion to the app | "ok i like the animation do same now for our app!" | Approved, in progress |
| 2026-11-12 | Create sheet behaves like the player: mini player hides, sheet opens smoothly, our buttons inside | "if clicked ! it shld hide the mini player and open it properly" | Approved, in progress |
| 2026-11-12 | Create sheet is full screen width | "the widthe shld be full not like rn which is not full!" | Approved, in progress |
| 2026-11-12 | No new dependency (Gorhom, etc.) | Recommendation in run 1, owner proceeded with it | Treated as approved |
| open | Commit, push, merge, version bump | Not requested | **Needs the owner**; see section 12 |

## 5. What was done this session

All edits are uncommitted working-tree changes on `fix/playback-edge-cases`. The tree also holds unrelated unfinished playback work (web `useAudioPlayer`, `playerStore`, lock-screen metadata, skip rules, `app.json` 1.49.1 to 1.50.0). **Do not revert or stage those by accident.**

Player transition (mobile):
- New `apps/mobile/src/navigation/usePlayerSheetMotion.ts` (+ `.test.ts`): `sheetY`, `progress`, `closing`, a `generation` counter so a cancelled spring's late callback cannot remove the route after a reversal, `holdRoute` state, `animateClose(velocity)`.
- `constants/allegraTheme.ts`: new spring `Motion.spring.player = { stiffness: 330, damping: 34, mass: 1, overshootClamping: true }` (proposal from the prototype, not Apple's values).
- `navigation/playerTransition.ts`: mini contents fade out over the first 18% (was 25%); player contents fade in from 52% to 88% (was 60-90%), used for tap and fluid.
- `navigation/sheetProgress.ts`: new `createSheetProgress` mutable shared by the Create sheet and mini player.
- `screens/NowPlayingScreen.tsx` (-170/+ lines net smaller), `components/PillPlayer.tsx`, `MiniPlayer.tsx`, `CoverGhost.tsx`, `hooks/useNowPlayingLogic.ts`, `contexts/PlayerContext.tsx`: shared artwork on tap as well as drag, same settle rule for open and close.
- `components/connect/ConnectRemotePlayer.tsx` (large diff) and `ConnectMiniPlayer.tsx`: Connect now uses the same spring and settle behaviour.

Create sheet:
- `components/nav/CreateSheet.tsx`: full-width sheet above the nav bar with rounded top corners, dimmed page, mini player fades out on `createSheetProgress`. Create becomes a close control. New `CreateSheet.test.tsx` (passes).
- `components/V6TabBar.tsx`, `components/NowPlayingLyricsArea.tsx`, `ui/ListRow.tsx`: small related edits.

Not done by this session: any commit, push, version bump, device check.

## 6. Where everything lives

| Artifact | Path / URL | Purpose |
|---|---|---|
| Approved web prototype | `C:\Users\nithy\.t3\scratch\luvlyrics-player-prototype\index.html` | Reference for feel, geometry, timings |
| Mobile check log (UTF-16) | `...\luvlyrics-player-prototype\mobile-check.log` | Last full jest run, 3 failing suites. Read with `iconv -f UTF-16LE -t UTF-8` |
| Android build log (UTF-16) | `...\luvlyrics-player-prototype\android-build.log` | Failed debug build |
| External visual reference | https://github.com/mahdidavoodi7/expo-apple-music-bottom-sheet | MIT, Expo/Gorhom; visual composition only |
| Song-actions PR | https://github.com/peterish8/allegra/pull/81 | Open; touches mini-player menu, may conflict |
| Reanimated 4.1.6 compatibility | https://github.com/software-mansion/react-native-reanimated/blob/4.1.6/packages/react-native-reanimated/compatibility.json | RN 0.81 and Worklets 0.7.x confirmed |
| Apple guidance cited | https://developer.apple.com/videos/play/wwdc2025/284/?time=812 | General continuity guidance only; Apple's private spring values are unknown |

## 7. How to work with the artifacts

- Re-run the web prototype: `npx serve C:\Users\nithy\.t3\scratch\luvlyrics-player-prototype -l 5199`, open on a 390x844 viewport.
- Re-run the failing suites: `cd apps/mobile && npx jest src/workletSafety.test.ts src/ui/round7.test.ts src/navigation/fluidPlayerGuard.test.ts`.
- Several repo tests are **source-pattern guards** (they regex the source text). When a refactor moves code, update the guard to the new owner, do not weaken it silently.
- Edit with the Edit tool, never with python/sed scripts (memory `edit-code-with-edit-tool`).

## 8. Verified facts

- Versions: see section 2 (verified from lockfile in run 1).
- `openPlayerSheet` pushes a transparent native-stack modal with `animation: 'none'`; the app animates itself (run 1, source read; not re-checked this run).
- `usePlayerSheetMotion.ts:12-30` exists and imports `takeOpenTracking`, `takeOpenVelocity`, `settleTarget`, `playerDrag`, `playerSheetProgress`.
- `git diff --stat`: 30 files, +816/-508 across mobile and web.
- Jest result in the log: Test Suites 3 failed / 175 passed; Tests 3 failed / 1451 passed.
- Skia 147.1.0 (`react-native-skia-android`) is present in `apps/mobile/node_modules`.
- **Unverified**: any on-device behaviour, frame timing, TalkBack/Reduced Motion behaviour, Back-button path after the refactor, whether the Create sheet matches the Spotify reference closely enough.

## 9. Known problems and findings

1. `src/workletSafety.test.ts` fails: `ConnectRemotePlayer.tsx` lines 224, 233, 237, 257, 260 call `settle` and `beginDrag` from worklets, but they are plain functions (14 reports in total, the log shows the first five). Fix: mark them `'worklet'` (and what they call), or call through `runOnJS`.
2. `src/ui/round7.test.ts` fails: expects `<MiniPlayerGlow uri={coverImageUri} active />` in `MiniPlayer.tsx`; the edit removed or changed it. Decide whether the glow should stay (memory `low-end-perf-glow-decision`: keep the glow) and restore it, or update the guard with the owner's agreement.
3. `src/navigation/fluidPlayerGuard.test.ts` fails: expects `takeOpenTracking() && fluid` in `NowPlayingScreen.tsx`; that logic moved into `usePlayerSheetMotion.ts:15`. Update the guard to read the hook file. Also reconsider the rule "fluid player stays opt-in": shared artwork on tap is now unconditional, which the owner approved, but the guard text says only the mini player and sheet change when the setting is on.
4. Android debug build fails in CMake: "Update the VERSION argument <min> value" from Android-Clang.cmake while configuring `react-native-gesture-handler` and the app `buildCMakeDebug[x86_64]` (CMake 3.22.1 SDK install, project `CMakeLTOTest-C`). The last attempt also used a bad relative path. Start by reading the first real error in `android-build.log`, then retry from `apps/mobile/android`. A CI build (`mobile-apk.yml`) or an already working local build setup from earlier sessions may be easier than fixing local CMake.
5. `CoverGhost` animates layout bounds and radius, which conflicts with hard rule 5 (transform and opacity only). Run-1 gap list; unresolved. Prefer transform scale/translate with a clipped container, or record an explicit exception in `docs/decisions.md`.
6. Other gaps from run 1 that may remain: full-player surface translates but does not grow from mini bounds; closing rejects new gestures unless the new hook now handles grabbing during close (verify); Connect `onOpenTracking`; Reduced Motion should be fade only (no translation).

## 10. Remaining work, prioritised

1. Make the three failing suites green with correct code, not weakened guards (section 9, items 1-3). Done = `cd apps/mobile && npx jest` has 0 failures.
2. Run `npm run typecheck`, `npm run lint`, `npm test`, `npm.cmd run mobile:check`, then `npm.cmd run convex:test` separately. Done = all exit 0.
3. Get an Android build running (emulator or phone) and verify visually. Done = checklist in section 11, step 4 passed with notes.
4. Resolve the rule-5 conflict in `CoverGhost` (item 5) or document it.
5. Review the Create sheet against the owner's Spotify screenshot (full width, hides mini player, dim, close control, our actions inside). Ask the owner for the screenshot again if needed.
6. Version bump and release steps once the owner approves shipping (section 12).

## 11. Plan for the next agent

1. `git status` and `git diff --stat`; confirm the branch and that the unrelated playback files are untouched by your edits. Do not stash or reset.
2. Fix the worklet failures in `ConnectRemotePlayer.tsx` first (smallest, objective). Re-run `workletSafety.test.ts`.
3. Fix `round7` (restore `MiniPlayerGlow` use) and `fluidPlayerGuard` (point at the hook). Re-run both.
4. Android validation on 360x800, 412x915 and a small/large-text setting: tap open, slow drag open, fast flick open, drag close with and without velocity, reverse mid-open, reverse mid-close, rapid double tap, system Back from the player, Back with a nested sheet open, Reduced Motion on (fade only), horizontal mini swipes, scrubbing, lyrics scroll, Up Next, Connect player, Create open/close and Create while a song plays, both navigation styles. Confirm audio never reloads and the queue is unchanged (watch logcat for Media3 prepare calls).
5. Add a regression test for each bug found.
6. Hand results to the owner with screenshots or a screen recording. Wait for approval before commit.

## 12. Open questions (defaults if unanswered)

- Commit scope: the tree mixes this work with other playback fixes. Default: ask the owner once; otherwise commit only the player/Create files on a new `feat/player-transition` branch cut from the current state and leave the playback work alone.
- Version: `app.json` already reads 1.50.0 (uncommitted, not from this work). Default: this is a feature, bump minor to 1.51.0 at commit time per CLAUDE.md, and coordinate with PR #81, which is also tied to 1.50.0 work.
- Keep MiniPlayerGlow? Default: yes (memory `low-end-perf-glow-decision`).
- CoverGhost layout animation: Default: replace with transforms if it can be done without a rewrite; otherwise document.

## 13. Rules and guardrails

- `CLAUDE.md`: animate transform and opacity only; tokens for every duration and easing; reduced motion collapses to opacity; TypeScript strict, no `any`; no `console.log`; no AI attribution footers in commits; conventional commits; `main` stays green.
- Playback invariants: one funnel (`requestPlayback`), load effects never depend on `isPlaying`, seek pauses then resumes. Animation code must not touch audio or the queue.
- Mobile: new phone build needs a new `expo.version` in `apps/mobile/app.json`.
- Do not commit, push, merge or publish without the owner. Do not install dependencies.
- Worktree junction gotcha: rmdir junctions before `git worktree remove` (memory `worktree-junction-gotchas`).
- Do not claim Apple's exact animation values.

## 14. Continuation instruction

Read the starter prompt, then start at section 11 step 1. Fix the three red suites with real code changes, get an Android run, and report with evidence before asking to commit.
