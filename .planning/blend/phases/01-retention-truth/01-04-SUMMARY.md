# 01-04 Summary: library tombstone plan preflight

## Status

Blocked by plan dependency 01-02, which is waiting for a safe `closedAt` policy for legacy closed
reports. No source files or tests were changed for this plan.

## Implementation details to settle before resuming

- All three library row types already have `updatedAt`, the time the row last changed. For an unlike,
  `likedAt` may still be the original like time and would make a fresh tombstone appear old. The
  tombstone indexes should use `updatedAt` for likes, playlists, and playlist items.
- `ConvexLibraryStore.parsePage` currently returns only `rev`, `changes`, and `more`; it drops any
  `resync` field from Convex. The additive contract and parser must preserve that signal.
- Mobile `pull` currently applies each page and stores the cursor after each page. A full resync must
  gather all pages, reconcile the synced local snapshot without deleting unsent outbox edits, and
  persist the cursor only after that reconciliation succeeds.
- The plan's development-phone checkpoint remains required for validating stale-cursor resync and
  offline pending edits.

Evidence: `convex/schema.ts` library tables; `apps/api/src/db/convexLibrary.ts` `parsePage`;
`apps/mobile/src/services/sync/LibrarySync.ts` `pull`; `.planning/blend/phases/01-retention-truth/01-04-PLAN.md`.
