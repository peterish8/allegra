# 02-02 Summary: forward decay and tally amounts

## Changes

- Added `packages/shared/blendDecay.ts` with the fixed 2026 landmark, 45-day half-life, exact forward
  decay formula, `addDecayed`, `currentWeight`, tally weights and bounds, and `listenAmount`.
- Added eight `node:test` cases in `packages/shared/blendDecay.test.ts` for the half-life, additivity,
  zero floor, numeric horizon, stored-score ordering across 50 seeded pairs, listen thresholds/caps,
  and exported constants.
- Added `blendDecay.ts` to `SHARED_COPIES` and generated `apps/api/src/shared/blendDecay.ts`.
- Corrected §4.1 and this plan's range test. The old claim that `g(t)` stays finite for about
  126,000 years and the test for year 2200 contradicted the formula: 2200's exponent is about 1,412,
  beyond float64's finite range. The supported input horizon is now UTC 1976-01-01 through
  2076-01-01, inclusive. The formula is unchanged inside that horizon; exponent clamping is not
  used, and behavior outside the horizon is unspecified.

## Verification

- TDD red: `npm test --workspace packages/shared` failed because `blendDecay.ts` did not yet exist;
  the pre-existing shared tests passed.
- `npm run sync:shared` — passed; generated the decay copy and preserved the existing `identity.ts`
  sync entry (the sync also generated its API mirror for plan 02-01).
- `npm test --workspace packages/shared` — passed, 54 tests.
- `node --test tests/infra/infra-files.test.mjs` — passed, 15 tests.
- `npm run typecheck` — passed.
- Full plan gate: `npm run typecheck`, `npm run lint`, and `npm test` — all passed. `npm test`
  included 81 API tests, 54 shared tests, 20 infrastructure tests, 4 auth redirect tests, and 32
  Convex Vitest tests.

No commit or production deployment was made.
