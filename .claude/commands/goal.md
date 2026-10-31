# Continue the Allegra Android native UI migration

Resume the active Android UI migration for `peterish8/allegra` on `perf/mobile-player-responsiveness`. Use these files as the source of truth and update them when the state changes:

- `CLAUDE.md` and `apps/mobile/CLAUDE.md`
- `.planning/performance-kotlin/HANDOFF-ANDROID-NATIVE-UI.md`
- `.planning/performance-kotlin/CLOUD-CONTINUATION-ANDROID-NATIVE-UI.md`
- `.planning/performance-kotlin/UI-PERFORMANCE-PLAN.md` and `.planning/ROADMAP.md`

Start by checking the current branch, `git status --short --branch`, recent commits, and `origin`. Preserve existing work and never assume the remote or the old handoff SHA is current. Read the project instructions and both Android handoffs before changing code.

Complete pending Android device checks first when a phone or emulator is available. For the queue slice, include short horizontal and vertical handle drags around the 1 dp threshold. If there is no device, keep the check explicitly pending and record the exact device steps.

Run the requested mobile gates from `apps/mobile`: `npm run typecheck`, `npm run lint`, and `npm test -- --runInBand`. Run Android `:app:testDebugUnitTest` and a debug APK build for native changes. Report each exact result; distinguish a dependency-resolution failure, compile-only result, or missing device from a passing gate.

Then take the next unfinished vertical slice in the main handoff. Preserve the existing design, interactions, accessibility, playback and routing ownership, iOS and missing-module fallbacks, and the existing one-player / no-JavaScript-per-frame-clock rules. Keep the change small enough to review as one slice. Add focused automated coverage, bump `expo.version` for each APK-reaching change, and update the relevant handoff, roadmap, architecture, or performance-planning notes with verified facts and a specific device checklist. Do not claim a performance gain without a controlled measurement.

Before committing, inspect the complete diff and run `git diff --check`. Stage only files for the current slice. Use a conventional commit message without AI or co-author footers. Push only to `origin/perf/mobile-player-responsiveness`; do not open a PR, merge, or push to another branch unless the user directly asks. Continue until every requested Android screen is migrated and verified on a device or emulator; do not mark the overall goal complete while screens or device checks remain open.
