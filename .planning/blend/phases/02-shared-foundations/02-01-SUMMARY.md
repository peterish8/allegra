# 02-01 Summary: shared recording and artist identity

## Comparison before implementation

| Implementation | Normalization | Callers and tests |
|---|---|---|
| API `songIdentity` in `apps/api/src/lib/normalize.ts` | Removes parenthesized and bracketed title groups; lowercases; keeps Unicode letters and digits; punctuation becomes spaces; trims title tokens and sorts artist tokens. It does not decode HTML itself. `normalizeSong` decodes provider values first. | `collapseRecordings`, catalog discovery/search, artwork lookup, recommendations and mobile taste recommendations. Covered by API normalization, recommendations, artwork and mobile taste tests. |
| Web `songIdentity` in `apps/web/src/lib/songIdentity.ts` | Same result as the API helper for identical title/artist strings; it also strips bracket groups in its adjacent `baseTitle` helper. It does not decode HTML. | `uniqueByIdentity`, `shouldStartRadio`, `App.tsx` and `useAudioPlayer.ts`; covered by `songIdentity.test.ts`. |
| API `songIdentity` in `apps/api/src/user/actions.ts` | Uses catalog source/id (`gaana:<id>` for Gaana, otherwise `song.id`); it does not compare title or artist. | Recently played hydration/deduplication. This remains a distinct `catalogIdentity` helper. |
| API `creditedArtists` in `apps/api/src/user/taste.ts` | Splits comma, `&`, `feat.`, `ft.` and `x`; trims; drops empty names; de-duplicates case-insensitively while preserving the first spelling and order. | Taste signal updates. |
| Web `creditedArtists` in `apps/web/src/lib/utils.ts` | Previously split comma, `&` and `feat.`, retained duplicates, and did not split `ft.` or `x`. | Player and search result artist presentation. |
| Recommendations `creditedArtists` in `apps/api/src/services/recommendations.ts` | Previously split comma, `&`, `feat.` and `ft.`, lowercased names and dropped empty entries; it did not split `x` or de-duplicate. | Recommendation artist boosts and lead-artist diversification. |

The API taste splitter is the canonical artist behavior. Web display and recommendations now use the same separators, first spelling, ordering and case-insensitive de-duplication. The source/id helper in `actions.ts` remains unchanged in behavior. Recording identity stays shared between API and web; the shared normalizer also preserves Unicode combining marks, including Indic vowel marks. Neither identity helper performs HTML decoding.

## Implementation

- Added `packages/shared/identity.ts` with `identityKey`, `creditedArtists` and `artistKey`, plus focused node:test coverage.
- Added the module to the shared API copy list and generated `apps/api/src/shared/identity.ts`.
- Routed API normalization, taste, recommendation ranking and web helpers through the shared module.
- Renamed the recently played source/id helper to `catalogIdentity` to distinguish it from recording identity.
- Added a recommendation regression test for `x`-separated featured credits.

## Verification

- `node --import tsx --test identity.test.ts` — 6 passed.
- `node --import tsx --test src/lib/normalize.test.ts` — 10 passed.
- `node --import tsx --test src/services/recommendations.test.ts` — 9 passed.
- The broader typecheck, lint and test gates are recorded in the final integration summary after the parallel Blend slices are integrated.

## Plan correction

The original plan omitted the recommendations splitter and described the source/id helper as if it
were recording identity. The plan was amended with those two findings and the explicit canonical
separator/de-duplication behavior before changing callers. No recently played identity semantics
were changed.
