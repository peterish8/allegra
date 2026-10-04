# 01-03 Summary: `playStats` scope mismatch

## Finding

The plan's expected repository search result is incorrect. `git grep -n -i playStats -- . ':!.planning'`
finds the unused Convex profile field and schema validator, but also an active device-local counter:

- `apps/mobile/src/database/queries.ts` updates SQLite `songs.play_count` and `last_played`.
- `apps/mobile/src/store/songsStore.ts` calls that update after playback and separately increments
  daily stats.
- `apps/mobile/src/store/storeInitOrder.test.ts` mocks that active function.

This local counter is separate from `profiles.playStats`; deleting or renaming it would expand scope
and may remove behavior the plan did not authorize. The plan explicitly says to stop if other
`playStats` references appear.

The plan also requires a production check for stored Convex profile documents before removing the
schema field. That check has not been performed, so deleting the field could make Convex reject
existing documents.

## Status

Blocked before implementation. Revise the acceptance criteria to remove only the unused Convex
profile field while preserving the device-local counter, then confirm no production profile stores
the Convex field (or specify a safe transitional schema/migration). No source files or tests were
changed for this plan.
