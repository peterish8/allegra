# 01-04 Summary: library tombstone plan preflight

## Status

Plan 01-02 is complete, so the old dependency blocker is gone. Plan 01-04 is still blocked before
implementation by the unresolved tombstone-age field and full-resync contract below. No source files
or tests were changed for this plan.

## Implementation details to settle before resuming

- Likes, playlists, and playlist items already have `updatedAt`. For an unlike, `likedAt` may still
  be the original like time and would make a fresh tombstone appear old. The pruning indexes should
  use `updatedAt` for all three row types.
- `ConvexLibraryStore.parsePage` currently returns only `rev`, `changes`, and `more`; it drops any
  `resync` field from Convex. The additive contract and parser must preserve that signal.
- Mobile `pull` currently applies each page and stores the cursor after each page. A full resync must
  gather all pages, reconcile synced local rows while preserving unsent outbox edits, and persist the
  cursor only after that reconciliation succeeds.
- The development-phone checkpoint remains required for validating stale-cursor resync and offline
  pending edits.

Evidence: `convex/schema.ts` library tables; `apps/api/src/db/convexLibrary.ts` `parsePage`;
`apps/mobile/src/services/sync/LibrarySync.ts` `pull`; `.planning/blend/phases/01-retention-truth/01-04-PLAN.md`.
