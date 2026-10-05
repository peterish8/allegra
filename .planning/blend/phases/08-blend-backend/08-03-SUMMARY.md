# 08-03 Summary: build orchestration

## Changes

- `convex/library.ts`: secret-guarded `recentLikes` (≤ 1000, current likes, newest first) and
  `recentItems` (≤ 300, live items, newest first, carrying `origin: 'import'` when the parent playlist
  was imported). Mirrored on `LibraryStore` (`LibraryEntry`), the memory store and
  `ConvexLibraryStore`; gateway names added. Tests in `convex/library.test.ts`.
- `apps/api/src/services/blendBuild.ts`: `BLEND_BUILD`, `BlendBuildService` (`detailFor`,
  `seedTally`), `shape`, `memberViews`. A Blend built today and not stale is shaped from the stored
  document (no provider call). Otherwise: load each member (tally top 200 only when learning, likes
  1000, items 300); Gaana-only identities resolved through the cached `ImportMatcher` (≤ 60 per member)
  or dropped and counted; provisional taste → facts for each member's top 30 artists → final taste;
  every pair; discovery from catalog suggestions for the top 3 shared songs; `buildBlend` seeded
  `blendId:YYYY-MM-DD` with the stored `previousTracks`; for pairs, play counts for the 20 best
  "together" candidates, `togetherSong` and both gifts; groups get `groupGlue`; `saveBuild`
  compare-and-set, re-read on a lost race. Every outbound step is raced against an 8 s deadline
  (facts 3 s). Logs `{ members, candidates, unresolved, tracks, ms }` only, through a pino logger
  silent outside production.
- Library rows synced without a song snapshot (old profile-seeded rows) cannot be named, so they do
  not enter a Blend. Not counted separately; a follow-up could hydrate them by Saavn id.
- `GET /api/blends/:id` uses `detailFor`. Services wire `ArtistFactsService`, `BlendBuildService`,
  the Blend store (Convex when configured, memory otherwise).
- `apps/api/src/services/blendBuild.test.ts`: 9 tests (rebuild for a new day, no provider calls when
  built today, one save under two concurrent opens, Gaana resolution and the unresolved count, every
  provider failing, learning off → no tally read, slow provider bounded by the deadline, non-member
  null, the D6 seed excludes imports).

## Verification

- `node --import tsx --test src/services/blendBuild.test.ts` — 9 passed. Full gate — exit 0.
