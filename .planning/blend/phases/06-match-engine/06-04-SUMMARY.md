# 06-04 Summary: story maths

## Changes

- `packages/shared/blendStories.ts`: `STORY` constants, `Story` union, `songPopularity`,
  `togetherCandidates` (the 20 best before popularity, so the API looks up play counts for those
  only), `togetherSong`, `giftFor`, `groupGlue`, `storiesFor`.
- Additions beyond the plan, each needed by a caller: `song?: SongSnapshot` on the `song` and `gift`
  stories (the apps need a title to show; the API fills it from the build); `groupGlue` (the plan's
  `glue` input had no producer); `STORY.giftSimilarAffinity = 0.5` (the plan says "an artist similar to
  one B likes" without a threshold).
- Two-person cards are emitted in the W5 order and cut at 6: when both gifts exist, "brought" is the
  card that drops. Group cards: groupMatch (mean, rounded), mostInTune / leastInTune for the viewer
  (ties to the earlier `joinedAt`), glue; never a song card; cut at 4.
- `packages/shared/blendStories.test.ts`: 9 tests (Arijit pair → Arijit song, niche band beats the
  superstar, "closest" for neighbours, none for same-language and Tamil/Punjabi, popularity scale,
  gifts, two-person order and viewer-relative directions, change reason on the match card, four-member
  group with a tie, glue).

## Verification

- `npm test --workspace packages/shared` — passed. Full gate — exit 0.
