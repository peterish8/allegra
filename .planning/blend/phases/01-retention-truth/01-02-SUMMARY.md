# 01-02 Summary: legacy report retention blocker

## Finding

Plan 01-02 adds an optional `closedAt` field and trims reports selected by `status = 'closed'` and
`closedAt < cutoff`. The current schema has no `closedAt`, and `closeFor` skips reports already
marked closed. Therefore reports closed before the field is deployed would keep `closedAt` absent,
remain outside the trim index range, and retain `contact` and `details` indefinitely.

Evidence:

- `convex/schema.ts`: `reports` has `status` and `createdAt`, but no close timestamp.
- `convex/reports.ts`: `closeFor` continues when `row.status === 'closed'` and only timestamps new
  closes with `status: 'closed'`.
- `.planning/blend/phases/01-retention-truth/01-02-PLAN.md`: the proposed trim query requires a
  positive `closedAt` earlier than the cutoff and includes no backfill for legacy rows.

## Status

Blocked before implementation. The owner must choose a safe treatment for previously closed rows.
A conservative option is to set missing `closedAt` to the migration time, retaining details for a
full additional year; do not trim based on `createdAt`, because that could delete details less than
365 days after actual closure.

No source files or tests were changed for this plan. No verification commands were run.
