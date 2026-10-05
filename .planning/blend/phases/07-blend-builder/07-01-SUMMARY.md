# 07-01 Summary: buildBlend

## Changes

- `packages/shared/blendBuild.ts`: `BUILD` (plan values), `fnv1a`, `mulberry32`, `enjoyFor`,
  `BuildInput`, `buildBlend`. Candidates = each member's top 300 by p, then ≤ 50 discovery, only
  identities with a snapshot. Per-member enjoyment precomputed into `Float64Array`s; per-candidate
  jitter `mulberry32(fnv1a(seed|identity))` and the freshness factor computed once; greedy
  Σ log1p(e/(1+U)) loop. No `Math.random`, no `Date`.
- **Spacing, made explicit:** the plan's penalty (×0.3 for a lead artist in the last 4) is soft, but
  its fixture demands no repeat within any 4 consecutive tracks unless nothing else is left. The
  builder therefore excludes candidates whose lead artist is in the last 3 picks whenever any other
  candidate remains, and still applies the ×0.3 penalty at distance 4. Fairness stayed within 0.05.
- `packages/shared/blendBuild.test.ts`: 11 tests — fairness within 0.05 for the four simulated
  groups, ≤ 50 and no duplicates, determinism and ≥ 10 positions changed for another day, the spacing
  rule (checked against the remaining pool), shared/pick/discovery labelling, a thin member filled by
  discovery, freshness, < 10 candidates returned, missing snapshots skipped, 6 members × ~1,850
  candidates in ~26 ms (< 100 ms; skippable with `CI_SLOW`), hash/PRNG stability.

## Verification

- `node --import tsx --test blendBuild.test.ts` — 11 passed. Full gate — exit 0.
