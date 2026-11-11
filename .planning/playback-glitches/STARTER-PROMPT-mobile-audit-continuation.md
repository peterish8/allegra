Copy everything below the line into the next coding session.

---

Continue Allegra in C:\dev\allegra. Recheck the branch and HEAD first; the last known branch is fix/playback-skip-glitches at 9081dea8. Read .planning/playback-glitches/HANDOFF-2026-11-11-mobile-audit-continuation.md first, then .planning/playback-glitches/PLAN.md, AGENTS.md, CLAUDE.md, apps/mobile/AGENTS.md, apps/mobile/CLAUDE.md, apps/mobile/DESIGN.md, docs/architecture.md, docs/api-contract.md, docs/workflows.md, and apps/mobile/README.md. Do not rely on the previous conversation.

Goal: finish playback fixes, the attached P1–P5 phone audit, and reliable long-list playlist reordering. Start with git status --short --branch, git diff --stat, remotes, and live source. Preserve all dirty and untracked work, especially .planning/recommendations/, audit/, and docs/current-codebase.md. Safely reconcile with current origin/main; do not reset/clean.

User decisions: at 10 seconds, right cover swipe restarts current song. The user requested easy, snappy playlist dragging beyond one screen. The user previously authorized a version bump, commit and push to main; the latest instruction to the previous agent was to write this handoff and stop, and no commit/push occurred. The attached audit first said no push/publish, then user explicitly requested push. A main push triggers .github/workflows/mobile-apk.yml. Do not manually dispatch a release. Keep signer checks fail-closed; never inspect, print, copy, rotate, or guess production signing material/secrets. The handoff documents exact chronology.

Follow the handoff's numbered plan. In summary: rerun P1 and playback regression coverage and full root/mobile gates; finish playlist long-list tests/device drag; implement updater immutable release+digest+atomic promotion/rollback, bounded real network recovery episodes, serialized queue tombstones, MediaSession role policy, Up Next caching/measurement; finish library, mini gesture, tab continuity only after diagnosing the flash, and large text native geometry; execute P4 journeys and capture P5 release-device baselines. Verify Genius fake-marker absence and public signer continuity without exposing secrets. Use vertical slices and report exact evidence. Do not claim tests/device/performance passed unless freshly run.

Final response to the user: neat table for playback, playlist, P1–P5; exact checks, changed files/migration/version consequences, physical-device status, and owner signing action.

