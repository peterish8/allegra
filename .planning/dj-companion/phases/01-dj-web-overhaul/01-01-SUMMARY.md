# Phase 01 Plan 01: Honest picks Summary

Local DJ ranking now demotes songs that only echo the request's words in their title, gives every pick a reason that names a real signal (never the same text twice in a row), and searches a session language as its own catalog query on both the model path and the heuristic fallback.

Status: tasks 1 and 2 done and green. Task 3 (phone version) bumped and committed; its `mobile:check` has one failing test that is not caused by this plan (see "Open items").

## Commits

| Task | Commit | Subject |
|---|---|---|
| 1 | 19b2dea | test(shared): reproduce the DJ title-echo and repeated-reason picks |
| 2 | 4d052fa | fix(shared): rank DJ picks on real signals and give each one an honest reason |
| 3 | c5d7cc5 | chore(mobile): bump to 1.6.5 for the shared DJ ranking fix |

## Files changed

- `packages/shared/djLocal.test.ts` - `song()` factory, live-failure fixture, 6 new tests (11 total).
- `packages/shared/djLocal.ts` - `overlapScore` removed; added `artistQueryScore`, `titleEchoesQuery`, per-pick reason lists with look-ahead de-duplication, `withLanguageQuery`, `withoutWord`.
- `apps/mobile/app.json` - `expo.version` 1.6.4 -> 1.6.5 (main is 1.6.4; the branch had not bumped).

## Task 1 result (RED)

Exactly the planned set failed before the fix: "songs only titled like the request are not the top picks" (echo1 in the top 5), "adjacent picks never share a reason" ("Matches your tamil preference." x2), and the model-path language query test. The other 5 existing tests and the 3 regression guards (language reason only on labelled songs, skipped artist, 2-per-artist cap) passed.

## Task 2 result (GREEN)

```
cd packages/shared && node --import tsx --test djLocal.test.ts
ok  x 11   (ℹ pass 11, ℹ fail 0)
grep -n overlapScore packages/shared/djLocal.ts   -> no output
```

Heuristic queries now: "Late night Tamil melodies" -> `["Late night melodies", "tamil melodies"]`; "something upbeat" with session language hindi -> `["hindi something upbeat", "hindi hits"]`; a question like "why this one" -> `[]`.

## Deviations / judgement calls (inside the plan's design)

- Title echo also matches the run-together form ("Latenight" for "late night"), because the plan's fixture requires it to be demoted and a plain consecutive-words check misses it. Matching is on whole title words, so no substring false positives. A bigram needs at least one word longer than 3 characters so "in the" cannot demote.
- Reason fallback: if the fallback text would repeat the previous pick's (same artist twice in a row) a second wording, "More from {artist} in the same search.", is used, so "adjacent picks never repeat" holds absolutely.
- Language query: when the search list already has 4 entries, the first 3 are kept and the language query takes the 4th slot, so a session language always reaches the catalog. It is not added to turns that search for nothing (removals, questions).
- The heuristic `vibe` is built from the topic with the language word stripped ("Late night melodies"); the language itself lives in the session's `language` field.
- `artistQueryScore` matches whole words of the artist's name against query words longer than 2 characters.

## Gates (root, at HEAD c5d7cc5)

| Command | Exit | Notes |
|---|---|---|
| `npm run typecheck` | 0 | |
| `npm run lint` | 0 | |
| `npm test` | 1 | Fails only on `apps/api/src/app.profile.test.ts` "Gaana plays keep their provider ref ..." (signals 4 vs 2). Fails identically on base commit 79aa320 (checked in a throwaway worktree). Unrelated to djLocal: nothing in `apps/api` imports it. Because `npm test` chains with `&&`, `infra:test` and `convex:test` were then run separately. |
| `npm test --workspaces` tail | | api 310/311 (that one failure), web 127/127, connect 81/81, shared 198/198 |
| `npm run infra:test` | 0 | 20/20 |
| `npm run convex:test` | 0 | 7 files, 80/80 |
| `apps/mobile` `tsc --noEmit` | 0 | |
| `apps/mobile` `eslint src index.ts` | 0 | |
| `npm run mobile:check` | jest 1 failed | Test Suites: 1 failed, 93 passed; Tests: 1 failed, 781 passed, 782 total |

## Open items

1. **Mobile test `src/connectRouting.test.ts` fails (pre-existing, from commit 79aa320).** "happens only in the player itself or behind the Connect routing" reports `screens/DjScreen.tsx` (calls `nextInPlaylist()` at line 293, no import of `playbackIntents` / `pickRouter`, not in `PLAYER_PARTS`). 79aa320 added that screen, and nothing in this plan touches it. Fixing it means either routing the DJ screen through Connect or listing it as a player part with a reason; that is a phone-DJ design decision (phase 02), so it was not improvised here. Task 3's acceptance ("mobile tests pass") is therefore not fully met on this branch until that is decided. The version bump itself is correct and committed.
2. **Pre-existing API failure** `app.profile.test.ts` "Gaana plays keep their provider ref ..." fails on the base commit too; not investigated.
3. The "Live in the browser" check in the plan's `<verification>` was skipped as instructed (orchestrator runs it).

## Known Stubs

None.

## Self-Check: PASSED

Commits 19b2dea, 4d052fa and c5d7cc5 exist on `codex/dj-companion`; `djLocal.ts` and `djLocal.test.ts` exist; `overlapScore` is gone.
