# Starter prompt: copy everything below the line

---

Continue LuvLyrics (Allegra's Android app, `apps/mobile` in https://github.com/peterish8/allegra) from `main`. Everything
from the previous session is committed there. Goal: get the owner's approval of the Round 7 design revisions, then implement
them. Do not rely on earlier conversations.

Read first, in order:
1. `.planning/mobile-ui-review/HANDOFF-2026-11-06-r7-design-brief.md` (start with §0, then all sections).
2. `.planning/mobile-ui-review/evidence-2026-11-06/README.md` and its images; `owner-evidence-2026-11-06/`.
3. `.planning/mobile-ui-review/PLAN-V6-VERIFICATION.md` and `VERIFICATION-MATRIX.md`.
4. `AGENTS.md`, root `CLAUDE.md`, `apps/mobile/CLAUDE.md`, `apps/mobile/DESIGN.md`, `apps/mobile/src/ui/AGENTS.md`.
5. `.planning/mobile-ui-review/design-drafts/README.md`, `v7_revision.py` and the boards `design-drafts/project/V7-*.dc.html`.

Authority: the owner authorised coding, tests, version bumps, push, PR and merge for approved work ("directly merge and if some
problem is there then correct and merge as bug fix later"). Round 7 is different: "Do not implement, commit, merge, or release
these design revisions until I approve the revised preview." Committing the preview files for this handover is not approval.

Work order:
1. Show the owner the nine Round 7 boards (items 1–9). Publish them as page `r7` on the design canvas
   https://claude.ai/artifact/UGiYJ1UaRjWA66qTFjsmHT (handoff §7, using `v7_canvas_index.py` on a freshly read index). If this
   environment cannot reach the canvas, render the boards another way and say the canvas was not updated. The boards already
   include the owner's last rules: every song list has one identical row (title one line, artist one line, each ending in
   "…") and every list cover has small rounded corners (6dp; artists round).
2. Reply with the key decisions (menu pattern = bottom sheet; voice listening inside the search field), a completion table
   (item | completed/partial/blocked | what changed | where to inspect | remaining issue), the tap-target checks only the real
   app can prove, and ask for approval. Stop there until the owner answers.
3. After approval, implement per handoff §11, one small PR each, in this order:
   - the Playlists background fix (handoff §8);
   - the rows everywhere, with the Download button restored on Stream and Search;
   - the bottom surface and nav;
   - chips, then Play/Shuffle;
   - menus;
   - voice search.
   For each PR: `npm ci` then `npm run ci` inside `apps/mobile` (Jest in band), and bump `expo.version` in `apps/mobile/app.json`
   from live main (patch for fixes, minor for features). Merge, and let GitHub Actions build the APK. No emulator here: mark
   emulator and device checks pending.
4. Check that `apk-latest` reached 1.39.0 or later and read the latest main `Mobile smoke test` run; record the results in the
   verification matrix.

Open questions: ask once; otherwise use the handoff §12 defaults. Report progress in short plain updates, separating
canvas/design, source/tests, CI/release and device evidence. Never claim device or emulator results you did not get.
