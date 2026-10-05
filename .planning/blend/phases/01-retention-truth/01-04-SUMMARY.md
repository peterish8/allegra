# 01-04 Summary: library tombstone retention and mobile resync

## Result

Implemented the 90-day tombstone sweep, stale-cursor resync protocol, mobile full reconciliation,
and matching legal/API contract copy. Phase 01-02 remains the completed dependency. No Convex
deployment or data backfill was run, and no physical-device proof was available in this environment.

## Implementation

- Likes, playlists, and playlist items all use `updatedAt` as the removal age. In particular, an
  unlike keeps the original `likedAt`, so pruning on that field would delete fresh removals.
- `libraryState.prunedRev` stores the highest tombstone revision pruned for each listener. A daily
  internal retention mutation deletes only old tombstones through global `updatedAt` indexes,
  processes bounded batches, and schedules another pass when needed. `updatedAt` indexes are not
  staged because this repo task does not include a production deployment or a measured large-table
  migration decision.
- `LibraryPage` in `apps/api/src/user/library.ts` owns the response type. The Convex adapter keeps
  `resync` and passes the continuation flag; the API route reads the optional `resync=true` query.
- Mobile collects every page before reconciliation. It removes stale account-synced likes,
  playlists, and playlist items; applies the remaining live rows; protects targets named by unsent
  operations; leaves the outbox untouched; refreshes stores; and writes the final cursor last. A
  failed local write or incomplete page set leaves the stored cursor unchanged.
- `LIBRARY_TOMBSTONE_RETENTION_DAYS` is shared with the legal page, which now states the period.

## Paging contradiction and protocol

The original stale-cursor rule says every request with `since < prunedRev` restarts from revision
zero. That conflicts with multi-page resync because a continuation cursor can remain below
`prunedRev`; blindly applying the same rule would return page one repeatedly. The additive protocol
is: the first stale request omits the flag and receives `resync: true` at the first page; each
continuation request sends `resync=true` with the returned cursor while `more` is true. The server
then honors the cursor and keeps filtering tombstones. Clients send this flag only after an initial
response advertises resync, never on ordinary incremental requests or the first request. Tests
cover multiple pages terminating without repeating rows.

## Checks

- `npm.cmd run convex:test` — passed; 44 tests across 4 Convex files plus 4 redirect tests.
- `node --import tsx --test src/user/library.test.ts src/db/convexLibrary.test.ts` from
  `apps/api` — passed; 5 tests.
- `npm.cmd test -- --runInBand src/services/sync/LibrarySync.test.ts src/database/syncQueries.test.ts`
  from `apps/mobile` — passed; 2 suites, 9 tests.
- `npm.cmd run typecheck` from `apps/api` — passed.
- `npm.cmd run typecheck` from `apps/mobile` — passed.
- `git diff --check` — passed.

The development-device checkpoint remains outstanding. It requires a physical device and a
development Convex deployment; neither was used for this work. No production deploy or backfill
was run.
