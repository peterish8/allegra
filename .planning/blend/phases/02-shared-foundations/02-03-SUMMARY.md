# 02-03 Summary: unbiased random codes

## Changes

- Added `apps/api/src/lib/randomCode.ts` with the canonical 31-character `CODE_ALPHABET` and
  `randomCode(length)`. It uses rejection sampling: bytes at or above 248 are discarded before
  mapping, so each alphabet character has equal probability.
- Updated `ListenerActions.share` in `apps/api/src/user/actions.ts` to use `randomCode(8)`. The
  existing `catalogIdentity` helper rename was preserved.
- Made `isShareCode` validate characters against `CODE_ALPHABET`. Its existing 6–12 character
  length range remains in place; newly generated share codes are still 8 characters.
- Added focused tests for lengths and alphabet membership, a 310,000-character distribution sample,
  10,000 unique 12-character codes, and validator acceptance/rejection.

## Verification

- `node --import tsx --test src/lib/randomCode.test.ts` — 4 passed.
- `npm test --workspace apps/api` — 205 passed.
- `npm run typecheck --workspace apps/api` — passed.
- `npm run lint --workspace apps/api` — passed.

No deployment was performed.

## Files

- `apps/api/src/lib/randomCode.ts`
- `apps/api/src/lib/randomCode.test.ts`
- `apps/api/src/user/actions.ts`
- `.planning/blend/phases/02-shared-foundations/02-03-PLAN.md`
- `.planning/blend/phases/02-shared-foundations/02-03-SUMMARY.md`
