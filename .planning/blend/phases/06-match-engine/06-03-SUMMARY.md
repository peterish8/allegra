# 06-03 Summary: pair match

## Changes

- `packages/shared/blendFixtures.ts` (test only, not synced): the simulation's world as an
  `ArtistFactsMap` (keys lower-cased, so `indieX` is `indiex`), its LCG listener generator with the
  same seed and construction order, the eleven cases (`simCases`) and the four builder groups
  (`simGroups`, built after the cases on the same stream, as the simulation does).
- `packages/shared/blendMatch.ts`: `MATCH` (plan values plus `changeThreshold`, `contributionsKept`,
  `unknownPopularity: 0.5`, `togetherPopularityWeight: 0.4`), `affinity`, `enjoyment(identity,
  leadArtist, listener, facts)`, `coverage`, `pairMatch`, `explainChange`. `pairMatch` orders a/b by
  userId; an empty member scores 0 with `low`; `together` is the argmax of min(qA,qB)·(1−0.4·pop),
  `''` when no artist is shared; contributions are a's side, top 10.
- `packages/shared/blendMatch.test.ts`: plan-table ordering, every row within ±3 of the plan's number
  (all matched the simulation exactly), broad-vs-narrow directions (26 % / 93 %), symmetry, 200 random
  pairs finite and integral, thin → low, empty → 0/low, together artist (niche beats superstar),
  contributions capped and sorted, explainChange, constants (11 tests).

## Verification

- `node .planning/blend/match-sim.mjs` and the tests agree on all ten table rows.
- Full gate — exit 0.
