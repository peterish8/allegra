# 01-01 Summary: shared touch interval

## What changed

- Added `ACTIVE_TOUCH_DAYS = 7` to `packages/shared/legal.ts` and regenerated the API copy.
- Changed the API's `keepActive` interval to read that shared constant.
- Added four Convex retention boundary tests and changed the sweep cutoff to add the touch
  interval to both guest and account retention periods.
- Updated the existing sweep test to expect deletion only beyond retention plus the touch interval.
- Recorded owner approval of plan section 2 in `STATE.md`.

## Verification

- `npm run sync:shared` — passed.
- `npm run typecheck` — passed.
- `node --test tests/infra/infra-files.test.mjs` — 15 passed.
- Red test run before the Convex fix — the two new inside-slack survival tests failed as expected;
  24 other tests passed.
- `npm run convex:test` after the fix — 26 passed.
- `git diff --check` — passed.

## Commits

- `70543e3` `feat(legal): centralize profile touch interval`
- `7c7e744` `test(convex): pin inactivity sweep edges to the touch interval`
- `98efa47` `fix(convex): never erase before the stated retention period`

## Remaining gates

- Phase 01-02 still needs review of existing closed reports that lack `closedAt` before its cleanup
  behavior can safely enforce the 365-day detail retention promise.
- The production check for profiles without `lastActiveAt` remains an owner action recorded in
  `STATE.md`.
