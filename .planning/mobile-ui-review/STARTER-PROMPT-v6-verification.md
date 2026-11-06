# Starter prompt: copy everything below the line

---

Continue LuvLyrics in `C:\dev\allegra`: correct the owner-reported UI/UX defects across the app, implement
the newly approved animated Stream/Library header glow, and finish the remaining verification and release work.
Do not rely on earlier conversations. The primary checkout is still `feat/mobile-frontend-polish` at c375296;
PR 58 is squash-merged as main 473c4d8 and 1.37.1 is published. Recheck live state and work on a fresh branch
from fetched origin/main; preserve the three unrelated dirty mobile build/dependency files and `.planning/ui-reviews/`.

Read in order:
1. `.planning/mobile-ui-review/HANDOFF-2026-11-06-v6-verification.md` (all 14 sections).
2. `.planning/mobile-ui-review/PLAN-V6-VERIFICATION.md` (UI-01?UI-10 and every acceptance check).
3. `.planning/mobile-ui-review/owner-evidence-2026-11-06/README.md` and both screenshots there.
4. AGENTS.md and its ordered project orientation, root/mobile CLAUDE.md, apps/mobile/DESIGN.md and src/ui/AGENTS.md.
5. IMPLEMENTATION-STATUS.md, REDESIGN-V6-NOTES.md and the older handoff, treating old static-glow/status text as
   historical where the current handoff overrides it. Review the local design-gallery/index.html and generator source.

The owner authorized autonomous coding, testing, version bumps, pushing, PRs, merging after checks and GitHub
Actions APK publication. Use accepted defaults and do not ask the owner to repeat choices. A physical phone was
unavailable and those checks were explicitly deferred: continue independent work and mark device checks pending.
Only GPT-6 Luna/high may be delegated easy bounded tasks, if needed; retain important fixes yourself.

Work order:
1. Inspect Git/main/release/CI and preserve all existing work. Retrieve and diagnose broader smoke run 42126270194:
   cover/lyrics pass; repeated reopen fails from C round 2, then media keys/restore fail. Inspect artifacts, not just
   log snippets. Reproduce the first failure; do not label it a flake or weaken the gate without proof.
2. Correct the screenshot defects: Stream mood chips overlapping Jump back in, Up next chips overlapping the first
   queue row, excessive Stream section gap, clipped/split Now playing title and dense shortcut labels. Measure bounds,
   identify the actual shared/native/JS causes, add behavior/layout regressions and verify at 360/393/430 and 200% text.
3. Implement the new header glow in Stream and Library: roughly top 20%, gently animated, scrolls out above the viewport
   and returns on scrolling back. Bind to real scroll offsets, reuse shared code, pause off-screen/background, provide
   reduced-motion/transparency/Battery Saver/low-end fallbacks. Preserve the pinned Stream logo/Updates entry.
4. Reduce the mini-player's excess top/row space and reclaim real scrolling viewport, updating the shared shell
   geometry and clearance consumers together. Preserve targets, seek usability, safe insets and adaptive large text.
   Restore its existing left/right song swipes through the current onNext/onPrevious owner callbacks, with contained
   V6 motion, cancellation and no conflicts with seek drag, vertical player-open, taps or buttons. See UI-09/UI-10.
5. Audit and correct similar defects throughout all screens and states. Make dropdown opening/selection/dismissal,
   sheet scrolling, gesture arbitration, focus/Back/keyboard, button access and feedback smooth and predictable. Track
   every finding with reproduction, severity, fix, tests and runtime retest; the two screenshots are not the full scope.
6. Execute the plan's playback/accessibility/device, visual/motion, measured-performance and in-app install matrices.
   Optimize playlist loading only when measurements justify it. Do not equate intent flags/timestamps with audible proof.
7. Ship bounded slices: full `npm run mobile:check`, relevant JVM/regression and runtime checks, patch bumps for fixes,
   minor bump for the animated header feature using live version context, docs updates, push/PR and all required CI.
   Run broader mobile-smoke.yml on the branch via workflow_dispatch as needed; only main publishes apk-latest.
8. Verify main release manifest/assets after every merge and update the evidence ledger. Leave physical-device tests
   explicitly pending until performed; no manufactured screenshots, data, installs or benchmark claims.

Use the handoff's defaults for optional choices. If a truly blocking new boundary arises, state the exact blocker and
continue independent work; do not reopen approved design choices. Keep progress concise and evidence-based, separating
source/unit/design/emulator/device/audible/install/release results. Never call the app fully validated while known
UI defects, red broader smoke or unexecuted required checks remain.
