# 04-05 Summary: import taste seed

## Changes

- `apps/api/src/user/taste.ts`: `IMPORT_SEED_MAX_ARTISTS = 25`, `importSeedWeights` (names merged
  case-insensitively, top 25 by count, weight `5 × log2(1+count)/log2(1+max)`), `applyImportSeed`.
- **Plan deviation, found by the route test:** applying the seeds through `bump` one at a time made
  each later bump fade the earlier ones by 0.985, so the import's biggest artist ended up 25th.
  `applyImportSeed` now fades the existing taste by `0.985^n` once and adds the seed weights together,
  undecayed, keeping the import's order. (The onboarding `applySeeds` has the same sequential-fade
  property; left unchanged because it is out of scope and its seeds all have equal weight.)
- `POST /api/me/taste/import-seed` lives in `apps/api/src/routes/imports.ts` (not `routes/user.ts` as
  the plan said) so it shares the import flag and the account-only check. Writes bucket. Learning off
  → 204, no change.
- `apps/api/src/user/taste.test.ts` (new): 300 artists → 25 applied, top weight 5, monotone weights,
  order preserved, merge, languages untouched.
- Contract: in the Import section.

## Verification

- `node --import tsx --test src/user/taste.test.ts src/app.imports.test.ts` — 13 passed.
- Full gate — exit 0.
