# State: Blend and Import

Updated 2026-10-04. Status: in progress. Owner approved PLAN.md section 2 on 2026-10-04.

| Plan | Status | Commit | Notes |
|---|---|---|---|
| 01-01 | done | 98efa47 | touch-slack retention edges pass |
| 01-02 | done | 349c353, 5060321 | shared 365-day trim; migration-time backfill after deployment |
| 01-03 | blocked | | `playStats` also names an active device-local counter; narrow scope and verify Convex data |
| 01-04 | blocked | | 01-02 done; use `updatedAt` and define full-resync/outbox reconciliation before implementation |
| 02-01 | blocked | | add recommendation splitter to scope; keep source/id recent-history identity distinct; settle `ft.`, `x`, duplicate policy |
| 02-02 | blocked | | `2 ** exponent` overflows by 2200 although the test requires finite output; fix range promise or representation |
| 02-03 | blocked | | plan says validator uses `CODE_ALPHABET`; code uses broader `CODE_SHAPE` |
| 03-01 | not started | | |
| 03-02 | not started | | |
| 03-03 | not started | | |
| 03-04 | not started | | checkpoint |
| 04-01 | blocked | | needs the owner's Spotify data download |
| 04-02 | not started | | |
| 04-03 | not started | | |
| 04-04 | not started | | |
| 04-05 | not started | | |
| 05-01 | not started | | |
| 05-02 | not started | | |
| 05-03 | not started | | |
| 05-04 | not started | | checkpoint |
| 06-01 | not started | | |
| 06-02 | not started | | |
| 06-03 | not started | | |
| 06-04 | not started | | |
| 07-01 | not started | | |
| 08-01 | not started | | |
| 08-02 | not started | | |
| 08-03 | not started | | |
| 08-04 | not started | | |
| 09-01 | not started | | |
| 09-02 | not started | | |
| 09-03 | not started | | |
| 09-04 | not started | | |
| 09-05 | not started | | |
| 09-06 | not started | | checkpoint |
| 10-01 | not started | | |
| 10-02 | not started | | |
| 10-03 | not started | | checkpoint |
| 11-01 | not started | | |
| 11-02 | not started | | checkpoint |

Owner actions outstanding:
- Confirm the Convex profile `playStats` field is absent in production and preserve the separate mobile SQLite play counter; see 01-03 summary.
- Revise 02-01 to include recommendation artist splitting and preserve the source/id identity used by recently played; choose handling for `ft.`, `x`, and duplicate credits.
- Revise 02-02's finite-range test/promise or select a numerically stable representation that preserves additive scores and ordering.
- Decide whether `isShareCode` should keep its broader 6–12 lowercase alphanumeric shape or restrict to the generator alphabet (02-03).
- Supply one Spotify "Download your data" export (plan 04-01).
- Check production for profiles without `lastActiveAt` (PLAN R5).
