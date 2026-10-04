# 02-01 Summary: identity consolidation preflight

## Comparison before implementation

| Implementation | Normalization | Callers and tests |
|---|---|---|
| `apps/api/src/lib/normalize.ts` `songIdentity` | Removes every parenthesized/bracketed title group; lowercases; keeps Unicode letters and digits; replaces punctuation with spaces; trims and sorts all artist tokens. The helper itself does not decode HTML. `normalizeSong` decodes provider title/artist values before storing them. | `collapseRecordings`; API recommendations (`build`, `recommend`, `uniqueSongs`); API catalog search/suggestion/home shelves; artwork lookup; mobile taste recommendations. Tests: `normalize.test.ts`, `recommendations.test.ts`, artwork tests, and mobile `luvsTaste.test.ts`. |
| `apps/web/src/lib/songIdentity.ts` `songIdentity` | Same transformations for the same string inputs as the API helper. It does not decode HTML either. Its adjacent `baseTitle` uses the same bracket stripping and flattening. | `uniqueByIdentity`, `shouldStartRadio`; `App.tsx`, `useAudioPlayer.ts`. Test: `songIdentity.test.ts`. |
| `apps/api/src/user/actions.ts` private `songIdentity` | Uses catalog identity (`gaana:<id>` for Gaana, otherwise `song.id`); it does not compare title or artist. | `ListenerActions.recentlyPlayed` map keyed by source/id. This is a distinct identity purpose, so replacing it with title/artist identity would change recently-played deduplication. |
| `apps/api/src/user/taste.ts` `creditedArtists` | Splits comma, `&`, `feat.`, `ft.`, and `x`; trims; drops empty names; de-duplicates case-insensitively while preserving first spelling and order. | `applySignal`. |
| `apps/web/src/lib/utils.ts` `creditedArtists` | Splits comma, `&`, and `feat.`; trims and drops empty names; retains duplicate names; does not split `ft.` or `x`. | `PlayerPanel.tsx`, `SearchResults.tsx`. |
| `apps/api/src/services/recommendations.ts` private `creditedArtists` | Splits comma, `&`, `feat.`, and `ft.`; trims, lowercases, and drops empty names; does not split `x` or de-duplicate. | Recommendation artist boost and lead-artist diversification (`build`, `diversify`). |

The two title/artist identity helpers return the same value for the same input strings. Existing API
and web identity tests both cover film-title trailers and reordered credits; no identity difference
was found to turn into a behavior change. Provider HTML decoding occurs upstream in API
`normalizeSong`, rather than inside either identity helper.

## Blocker

The plan says to make `creditedArtists` the only artist splitter and to change the private
`songIdentity` in `actions.ts` to title/artist identity. The code has a third active artist splitter
in `apps/api/src/services/recommendations.ts`, omitted from `files_modified`, and the actions helper
is source/id deduplication rather than recording identity. The splitter copies also disagree on
`ft.`, `x`, and duplicate credits. Moving only the listed files would leave multiple active
splitters; replacing the actions helper would alter recently-played behavior.

Per the plan's stop rule, no identity source or caller was changed. Revise 02-01 to include the
recommendation splitter and specify whether recent-history source/id deduplication remains separate;
then define which existing splitter behavior wins for `ft.`, `x`, and repeated credits. The
remaining phases can proceed independently.
