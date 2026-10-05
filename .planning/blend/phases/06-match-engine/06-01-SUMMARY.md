# 06-01 Summary: Blend types and artist facts

## Changes

- `packages/shared/blendTypes.ts` (types only): `ArtistFacts`, `ArtistFactsMap`, `TasteItem`,
  `MemberTaste`, `PairMatch`, `ChangeReason`, `BlendKind`, `BlendTrack`. In `SHARED_COPIES`.
- `apps/api/src/services/artistFacts.ts`: `ARTIST_FACTS`, pure `factsFromProfile`, and
  `ArtistFactsService.facts(keys, budgetMs)`. Keys deduped through `artistKey`; cache key
  `artist-facts:<key>` (hit 30 d); any lookup failure stores the fallback
  `{ popularity: 0.5, similar: [] }` for 1 day; 4 workers; a budget race fills unfinished keys with
  the fallback without caching it. A `followerCount` of `null` (unknown) uses the fallback popularity
  rather than 0.
- `apps/api/src/services/artistFacts.test.ts`: popularity at 0 / 10 k / 10 M / unknown, language
  majority with alphabetical ties, similar capped at 10 and keyed, cache hit, cached fallback, budget
  expiry, ≤ 4 in flight (7 tests).

## Verification

- `node --import tsx --test src/services/artistFacts.test.ts` — 7 passed. Full gate — exit 0.
