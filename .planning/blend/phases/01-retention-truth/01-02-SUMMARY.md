# 01-02 Summary: closed report detail retention

## Outcome

Completed RET-03. Reports now have an optional `closedAt` timestamp and a `by_status_and_closedAt`
index. New closes stamp the time; `closeFor` also stamps already-closed legacy rows it encounters.
`retention:backfillClosedReports` pages closed reports in batches of 200 and stamps missing values
with migration time. The daily retention mutation deletes only `contact` and `details` after the
shared 365-day period. The legal page uses that same constant.

The owner selected migration-time backfill for legacy closed rows. This intentionally retains their
details for at least another year after the migration rather than guessing from report creation time.
After schema/function deployment, run `npx convex run retention:backfillClosedReports` once; later
pages schedule themselves.

## Plan correction

The original trim example used `.take(200)` and rescheduled from the first row whenever 200 rows
were returned. Since trimmed reports remain in the index range, that can reprocess the same first
page forever and prevent older pages from being reached. Both trim and backfill now use Convex
cursor pagination and schedule the returned cursor. A 401-report test drains those pages and proves
the scheduled work terminates.

Already-trimmed reports still remain in the index range and may be read again on a later daily run.
Each transaction stays bounded, and cursor pagination ensures the scheduled pass advances and ends.

## Verification

- Red phase: `npm run convex:test` failed on missing close timestamps, missing `retention` functions,
  and the absent schema field.
- Green: `npm run convex:test` passed (4 auth redirect tests and 32 Convex tests, including 401-row
  pagination).
- `npm run typecheck` passed for API, web, and Connect workspaces.
- `npm run lint` passed for API and web workspaces.
- `git diff --check` passed.
- `npx convex codegen` completed and refreshed local API bindings. Its CLI output also reported
  downloading deployment state and uploading functions to the configured Convex deployment; this
  summary does not claim that no remote upload occurred.

No explicit production deployment or backfill invocation was run as part of this task.
