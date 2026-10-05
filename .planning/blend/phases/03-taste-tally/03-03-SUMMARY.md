# 03-03 Summary: feeding and erasing the tally

## Changes

Already present at session start (verified):
- `ListenerActions` takes an optional `tally`; `tallySafely` wraps every write. `listened` records
  when personalised with a ref, snapshot and `playedAt`; native `like`, `unlike` and `addToPlaylist`
  apply bonuses only for a real change. `applyFromDevice` carries a comment explaining why synced
  (possibly imported) rows add nothing.
- `PATCH /api/me/settings { personalization: false }` calls `tally.clear` in its own try/catch.
- `convex/account.ts` `eraseSome` deletes `tasteSongs` in batches and `tasteMeta` once none remain.
- `GET /api/me/export` reads `taste:top` (limit 200) and returns `tally: { title, artist, minutes }[]`;
  documented in `docs/api-contract.md`, which also marks `playedAt` as recommended.

Added this session:
- `apps/web/src/lib/api.ts` `sendListenSignal(song, seconds, playedAt)` sends `playedAt`.
- `apps/web/src/hooks/useAccount.ts` `useListenTracker` stores the ISO start time when a song becomes
  current and passes it (kept on top of the owner's in-progress playhead refactor in that file).
- `apps/api/src/app.tally.test.ts` (new; the plan named `app.profile/app.privacy` tests — a separate
  file keeps the injected `MemoryTasteTally` setup in one place): listen raises weight by 2 minutes;
  duplicate delivery leaves the stored score unchanged; a throwing tally still gives 204 for a signal
  and 201 for a like; like +10, unlike back to 0, playlist add +5; export lists whole minutes;
  learning off empties the tally and later signals add nothing.
- `convex/account.test.ts`: erase removes 250 tally rows across batches plus `tasteMeta`, leaving
  another listener's 3 rows and meta intact.

## Verification

- `node --import tsx --test src/app.tally.test.ts` (apps/api) — 4 passed.
- `npx vitest run convex/account.test.ts` — 13 passed.
- Full gate run recorded in 03-04.

## Not done

- The local manual run (play a song on :5173, then download data) was not performed; the export
  path is covered by the API test above.
