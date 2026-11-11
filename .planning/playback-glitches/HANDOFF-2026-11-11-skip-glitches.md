# Detailed Handoff — Playback Glitches and Queue Transitions

**Updated:** 2026-11-11 (Asia/Calcutta)  
**Repository:** `C:\dev\allegra`  
**Working branch:** `fix/playback-skip-glitches`  
**Starting implementation commit:** `9081dea8` (`1.45.2`)  
**Expo version for this implementation:** `1.45.3`  
**Push authorization:** The user explicitly authorized committing the task, merging/pushing to `main`, and the version bump.  
**User-confirmed swipe rule:** At 10 seconds, a right cover swipe restarts the current song.

## Goal

Close the playback transition audit across LuvLyrics, the shared/web player and their motion. The work covers explicit skip playhead resets, one previous/next rule, stale media/player events, queue and shuffle edge cases, failed stream recovery, title/cover direction, Up Next following, and stable compositor-friendly transitions. The implementation must preserve Android Media3 ownership, the iOS JavaScript queue, Connect/LuvLink command routing, and the browser's single layout-owned audio element.

The detailed original defect inventory and acceptance criteria remain in [`PLAN.md`](PLAN.md). This handoff records the complete implementation sequence, ownership boundaries, verification requirements and current status so another agent can continue without reconstructing prior conversation.

## Status at handoff

The planned source changes are implemented. Root typecheck, lint and tests have passed after the latest web changes. The mobile gate is being rerun after updating one source assertion that still expected the previous PillPlayer props. The following still require final confirmation before merge/push: second `npm run mobile:check`, Android Gradle compilation/unit tests for the Kotlin list signal, browser visual inspection at the required widths, a final diff review, commit, merge with the current `origin/main`, and push.

The latest fetched `origin/main` is `f2223c66` (`docs: refresh Allegra reference and audit backlog`). It advanced after this branch was created from `fe5df309`. Integrate that main commit before pushing, preserving its reference docs and incorporating the playback/version updates from this branch.

No APK was built or published, and no emulator or physical phone has been used for audible playback, install/update, TalkBack, or performance acceptance. Do not claim those checks passed.

## User decisions and authorization

- A right cover swipe at 10 seconds **restarts the current song**. This follows the Previous button's `>3s` restart behavior. Before the threshold, it selects the previous queue item when one exists; at the first item it restarts unless Repeat All permits wrapping.
- A left cover swipe selects the next item and wraps to the first queue item, matching the native Next action.
- The user asked to finish all work in the playback audit, bump the version, commit the work, and merge/push to `main`. Do not ask again for authorization to perform those actions.
- The user asked that this handoff contain a concrete implementation plan, including how to work and verify it.
- No AI attribution footer in commits.

## Read before changing or verifying code

1. [`CLAUDE.md`](../../CLAUDE.md) — playback, version, branch and verification rules.
2. [`apps/mobile/CLAUDE.md`](../../apps/mobile/CLAUDE.md), [`apps/mobile/DESIGN.md`](../../apps/mobile/DESIGN.md), and [`apps/mobile/src/ui/AGENTS.md`](../../apps/mobile/src/ui/AGENTS.md) — Android ownership and design constraints.
3. [`docs/current-codebase.md`](../../docs/current-codebase.md) and [`audit/CODEBASE-KNOWLEDGE.md`](../../audit/CODEBASE-KNOWLEDGE.md) — source ownership and captured-codebase notes.
4. [`docs/architecture.md`](../../docs/architecture.md) and [`docs/workflows.md`](../../docs/workflows.md) — runtime boundaries and gates.
5. [`PLAN.md`](PLAN.md) — the original playback audit, issues, phase breakdown and acceptance criteria.

Use Graft for code location and call relationships before refactoring. If the code graph is stale, refresh/check coverage and fall back to the owning source. Inspect `git status`, `git diff --stat`, and the actual source before relying on this document: it describes the implementation, not proof that a device or deployment behaves correctly.

## Architecture constraints to preserve

- **Android:** Kotlin Media3 and its queue own confirmed player state. JavaScript mirrors status and routes user intent. Keep Android decisions in the native queue where the engine already applies them.
- **iOS:** the JavaScript player queue owns previous/next; `playerControls.seekTo()` pauses, so a restart while playing must re-enter through `requestPlayback(true)`.
- **Connect and LuvLink:** owner/device routing runs before local playback. A local UI must not silently take playback away from an active remote owner.
- **Web:** the single `<audio>` element remains mounted in the layout. Media events are valid only for the selected source and playback generation. Preserve seek-resume behavior and user-facing failure copy.
- **Motion:** web duration/easing values come from `apps/web/src/motion/index.ts`; transitions avoid layout properties. Mobile skip controls keep stable layout geometry and honor reduced motion.
- **Release:** every mobile source change reaching `main` bumps `apps/mobile/app.json` in the same change. This implementation uses `1.45.3`, a patch bump from `1.45.2`.
- Do not use direct `playerControls.play()` in UI skip handlers. Route play intent through `requestPlayback`.

## Implementation plan and completed source work

The items below define how the full audit is implemented. Keep them as the review checklist even though code is present.

### Phase 1 — Make mobile skip state and routing consistent

**Own the source:** `apps/mobile/src/store/playerStore.ts`, `apps/mobile/src/contexts/PlayerContext.tsx`, `apps/mobile/src/services/player/skipControls.ts`, `apps/mobile/src/hooks/useNowPlayingLogic.ts`, `apps/mobile/src/components/MiniPlayer.tsx`, and `apps/mobile/src/screens/NowPlayingScreen.tsx`.

1. On an explicit track skip, reset the UI playhead and its duration before a stale previous-track status can repaint it. Keep the store independent of the UI position bus: expose a player-control callback and install it from both platform providers.
2. Reject status positions from the old track for the short post-reset window. Do not reset on queue adoption, restoration, passive initial load, or recovery; those paths can resume in the middle of a track.
3. Route every previous/next UI through one action. LuvLink owner commands take precedence. Android delegates previous to the native queue engine. On the JS queue, past three seconds previous seeks to zero, notifies the seek owners, and resumes only if playback was active.
4. Use the user-confirmed cover swipe rule. Keep swipe preview/index math and the committed queue action aligned. Restart has no incoming-song cover; a real song change animates in the selected direction.
5. Make rapid lyrics transitions read the latest song when the fade completes. Same-song metadata refreshes and A→B→A changes must cancel a stale fade and restore opacity.
6. Keep `NowPlayingControls`/Marquee keyed to both song identity and display text. A same-title different song still restarts marquee direction; a metadata-only change for the same song does not invent a directional skip.

**Evidence:** `playheadReset.test.ts`, store native/iOS tests, `skipControls.test.ts`, `lyricsSwap.test.ts`, marquee tests, and `swipeRule.test.ts`. Do not rely only on the helper tests: inspect that both UI entry points call the shared function and native ownership remains intact.

### Phase 2 — Stabilize mini-player motion and Up Next following

**Own the source:** `apps/mobile/src/components/PillPlayer.tsx`, `apps/mobile/src/components/MiniPlayer.tsx`, `apps/mobile/src/components/player/UpNextPanel.tsx`, `NativeQueueList.tsx`, `NativeQueueListModule.kt`, and `NativeQueueListView.kt`.

1. Animate skip-follow gestures on the UI thread. Call JavaScript only once the gesture commits. Use `runOnJS` for the action, guard a second swipe while one is in flight, and settle safely when the queue action produces no new song (restart, edge, rejected remote action).
2. Keep the outgoing artwork/title visible through its exit, swap to the latest selected song after the outgoing interval, then settle the incoming content from the same swipe side. Clear timers on replacement and unmount.
3. Keep MiniPlayer skip-button width and the play-button position fixed; reveal with opacity/transform. Reduced motion uses opacity without scale/translation. Use named Motion tokens for animation timing/springs.
4. Compute Up Next's opening row from the filtered row list, not the source queue index. While the panel is open, follow a newly playing row only when the panel/list is not being dragged and list activity has been quiet for three seconds. Do not steal a listener's manually scrolled position.
5. Emit native list activity through finger drag **and fling/momentum**. Clear the interaction state when momentum stops, not as soon as the finger lifts. Keep the FlatList fallback behavior aligned.

**Evidence:** `queueFollow.test.ts`, mobile design guards, existing gesture/layout tests, and the Android Gradle compile/unit test. In a browser/emulator/phone, check one-step and rapid-next title/cover changes, a restart with no incoming cover, and Up Next while idle versus during an intentional scroll.

### Phase 3 — Align web/shared queue rules and recovery

**Own the source:** `packages/connect/src/queueRules.ts`, its tests and export, `apps/web/src/hooks/useAudioPlayer.ts`, `apps/web/src/App.tsx`, `apps/web/src/components/PlayerPanel.tsx`, and `apps/web/src/lib/audioPlayerRules.ts`.

1. Use the same three-second previous boundary and queue-order helpers in web/shared routing. Preserve the actual shuffle order so Next, Previous, the queue display, and `upcomingSong` agree. Repeat All wraps; Repeat One repeats the current track on automatic end.
2. Bound automatic failed-stream recovery with a cursor over unvisited queue items. Do not loop forever under Repeat All. Reset recovery after a track successfully begins or the listener manually changes/restarts the track. If nothing loads, stop and show actionable error copy.
3. Guard HTML media events by selected song, source URL, and load generation. A late old-source event must not advance, pause, or overwrite the current song. Keep the one layout-owned audio node.
4. Route keyboard shortcuts only when focus is outside editable controls, buttons, dialogs, menus and sliders. Keep Space mapped to playback and arrows to seek.
5. Return the selected song from local skip handlers so PlayerPanel moves title and cover in the same direction only when a different song was actually selected. A restart or no-op must not leave a stale cover direction for the next change.

**Evidence:** `queueRules.test.ts`, `audioPlayerRules.test.ts`, `motionGuards.test.ts`, root typecheck/lint/test suite. Browser-check repeat/shuffle, first/last item, a failed source followed by a playable item, and a source change during an old media event.

### Phase 4 — Repair queue/store edge cases on mobile

**Own the source:** `apps/mobile/src/store/playerStore.ts` plus its native and JS queue tests.

1. Avoid duplicate play-history writes when Next resolves to the same sole queue item.
2. Recompute the current queue index after reordering/filtering; use `-1` if the active track is no longer represented instead of keeping a stale index.
3. When the current row is removed, advance to the next remaining row (or the previous last row) without a playhead/title mismatch; clear playback when the queue becomes empty.
4. At the end of a non-repeating queue, settle the UI on the first row in a paused state rather than wrapping unexpectedly or leaving a stale index.
5. Preserve queue restoration and resume positions; these are not explicit skips and must not call the explicit playhead reset.

**Evidence:** native/iOS playerStore tests. Verify repeat-off end, remove-current, remove-last, reorder-current, single-song Next, restore-at-position and Connect queue adoption. Preserve native playback ownership.

### Phase 5 — Remove motion glitches without broad layout rewrites

**Own the source:** audited web components in `apps/web/src/components/`, `apps/web/src/motion/index.ts`, `apps/web/src/styles/global.css`, and mobile MiniPlayer controls.

1. Replace ad-hoc web duration/easing/stiffness numbers with named tokens. Keep reduced-motion paths useful and opacity-based.
2. Remove transitions on width, height, margins, position and box-shadow. Prefer transform/opacity or an intentional instant layout change. Do not refactor the classic mini-player shell geometry without evidence that its current documented trade-off causes clipping or frame drops.
3. Keep one final desktop rail style section; responsive overrides are allowed. The guard should check the final cascade marker, not count valid selectors in media queries.
4. Extend targeted guards to components where this task changes animation behavior; keep guards narrow enough not to flag unrelated historical components.

**Evidence:** web `motionGuards.test.ts`; mobile design guard for MiniPlayer; root and mobile checks; visual review at 360, 768, 1280 and 1920 px, plus reduced-motion on/off.

## Verification sequence

Run in this order so shared processes do not contend:

1. `npm run typecheck`
2. `npm run lint`
3. `npm test` — includes workspace, infra and Convex tests.
4. `npm run mobile:check` — run only after the Convex tests complete.
5. From `apps/mobile/android`, run `./gradlew :app:testDebugUnitTest` (PowerShell: `./gradlew.bat :app:testDebugUnitTest`) to compile and exercise the Kotlin native list changes.
6. Run `git diff --check` and inspect the entire staged diff, including untracked tests/docs. Run `npm run sync:shared` only if `packages/shared` implementation changes; this task changes `packages/connect`, not the API-copied shared seam.
7. Start/reuse the web app at `http://localhost:5173` and inspect playback and layout in the browser at 360/768/1280/1920 px, including reduced motion. Browser review does not replace phone testing.
8. On an Android emulator and physical phone, test audible next/previous near 2.8–3.2 seconds, right cover swipe at 10 seconds (restart), left swipe wrap, repeat modes, rapid next/previous, failed/slow stream, Up Next follow versus manual scroll/fling, background/lock-screen controls, TalkBack and launch/resume. Record device/model/build and what was actually observed.

## Verification record

| Check | Result |
|---|---|
| Root typecheck | PASS on the latest implementation. |
| Root lint | PASS on the latest implementation. |
| Root `npm test` | PASS, including API/web/connect, infra and Convex suites. |
| `git diff --check` | PASS; only Git's LF→CRLF working-copy notices appeared. |
| `npm run mobile:check` | Pending final rerun after updating the stale source assertion in `src/ui/round7.test.ts`; previous run completed 161 suites / 1,288 tests with 1 failure from that old assertion. |
| Android Gradle test/build | Pending. |
| Browser viewport/reduced-motion review | Pending. |
| Emulator/physical phone/audio/installation | Not performed; must remain explicitly unverified. |
| Commit, merge and push | Pending. User authorized these actions. |

Update this table with exact command outcomes before commit. A gate that was run before a later source change does not count as the final result.

## Branch, merge and release checklist

1. Recheck `git status --short --branch`, `git log --oneline --decorate -6`, and `git diff --stat`.
2. Keep the proposed Quick Picks work in `.planning/recommendations/PLAN.md` separate unless the user explicitly scopes it into this playback task; it is an unrelated plan and is not part of the playback implementation.
3. Update [`docs/current-codebase.md`](../../docs/current-codebase.md), root README and mobile README/CLAUDE release references to say version `1.45.3` source is in this branch, and distinguish source checks from APK/device verification.
4. Commit the playback source and its plan/handoff with a conventional subject that includes the 1.45.3 patch version. Do not add an AI footer.
5. Merge the fetched `origin/main` (`f2223c66` at last fetch) into this branch, resolving doc overlap by keeping the latest main reference content and the 1.45.3 playback notes. Do not force-push or drop the newly added main docs.
6. Verify the merge result is clean, `apps/mobile/app.json` remains `1.45.3`, rerun affected checks if conflict resolution changes source, then push the merged branch tip to `origin/main` as authorized.
7. Record final commit/merge hashes and push status here. Do not claim an APK release or physical QA unless the matching workflow/device evidence exists.

## Continuation prompt

Continue in `C:\dev\allegra` on `fix/playback-skip-glitches`. Read this handoff and `PLAN.md`, inspect the live Git state, finish the pending mobile gate, Gradle compile/unit tests and browser review, update verification entries, then review and commit the playback work. Integrate current `origin/main` without losing its docs, preserve unrelated `.planning/recommendations/PLAN.md`, and push to `main` as the user already authorized. No further product clarification is needed for the swipe behavior: right swipe at 10 seconds restarts this song.

## Update — 2026-11-11

The broader phone-app audit and playlist long-list drag request continued after this handoff was drafted. Use the newer [mobile audit continuation handoff](HANDOFF-2026-11-11-mobile-audit-continuation.md) and [starter prompt](STARTER-PROMPT-mobile-audit-continuation.md) for current status, the complete P1–P5 checklist, remaining plan, verification state, and release authorization chronology. The status above is historical: additional audit changes remain uncommitted and their full gates/device checks are pending.
