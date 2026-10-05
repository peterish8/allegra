# 03-01 Summary: Convex taste tally

## Result

Found already implemented in the working tree when this session started (no earlier summary was
written); verified rather than rewritten.

- `convex/schema.ts`: `tasteSongs` (indexes `by_userId_and_identity`, `by_userId_and_score`, includes
  `likeBonusAt`) and `tasteMeta` (`by_userId`), each with a doc comment.
- `convex/taste.ts`: secret-guarded `record`, `bonus`, `seed`, `top`, `clear`, plus internal
  `clearRest`. Bounded reads only (`take`, `unique`); no `.collect(`. Eviction at most 5 rows per
  write; clear deletes 200 per pass and reschedules, deleting `tasteMeta` last.
- `convex/taste.test.ts`: 10 cases (listen amount, duplicate `playedAt`, recent-listen window of 8,
  201st song evicts the lowest, skip to 0 deletes, like/unlike exact reversal, playlist add, seed
  once, clear of 450 rows, wrong secret).
- Root `package.json` `convex:test` lists `convex/taste.test.ts`.

## Verification (2026-10-05)

- `npm run convex:test` — 4 redirect tests + Convex Vitest files passed (account file: 13 tests).
- Full gate `npm run typecheck`, `npm run lint`, `npm test` — exit 0 (see 03-04 summary for the
  final run after the phase).

No commit: the working tree also holds unrelated in-progress user changes (lyrics, playhead, media
session, Connect), so per-task commits would have mixed them in.
