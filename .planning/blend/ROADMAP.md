# Milestone: Blend and Import

Spec (source of truth for every formula, constant, table and copy string): [PLAN.md](PLAN.md).
Requirements: [REQUIREMENTS.md](REQUIREMENTS.md). Progress: [STATE.md](STATE.md).
Plans: `phases/NN-slug/NN-MM-PLAN.md`, in GSD `execute` format.

This milestone lives in `.planning/blend/` so it does not disturb the repo's hand-written
`.planning/ROADMAP.md`. Paths inside plans are relative to the repo root.

## How to execute a plan

For any agent (Claude, Codex, a small model):

1. Read the plan file top to bottom before touching code.
2. Read every file in `<read_first>` of the task you are on. Do not skip this; the plans name
   exact functions and line numbers that may have moved, and reading confirms them.
3. Do the tasks in order. Each task ends with `<verify>` commands and `<acceptance_criteria>`.
   Run them. A task is not done until all of them pass.
4. If a step in a plan contradicts the code, stop and write what you found in the plan's
   SUMMARY file. Do not improvise a different design.
5. One commit per task, conventional subject (`feat(api): …`), no AI attribution lines.
6. At the end of a plan, run the `<verification>` block and write
   `phases/NN-slug/NN-MM-SUMMARY.md`: what changed (files), commands run with their output tail,
   anything left undone.
7. Update the plan's row in STATE.md.

Global gates for every plan (from `CLAUDE.md`): `npm run typecheck`, `npm run lint`, `npm test`,
all exit 0. New Convex test files must be added to the `convex:test` script in the root
`package.json`, which lists test files by name; a file not listed there never runs.

## Phases

| # | Phase | Goal | Depends on | Requirements |
|---|---|---|---|---|
| 01 | Retention truth | The privacy page's retention promises are exactly what the code does. | none | RET-01 to RET-05 |
| 02 | Shared foundations | One identity key, one artist splitter, decay maths, unbiased codes. | none | FND-01 to FND-04 |
| 03 | Taste tally | Each listener's 200 most-played songs, decayed, idempotent, erasable. | 02 | TAL-01 to TAL-07 |
| 04 | Import core | Parsers, `origin: 'import'` on library rows, the match endpoint, the artist seed. | 02 | IMP-01 to IMP-06 |
| 05 | Import web | The `/import` flow: read, preview, match, review, save, resume. | 04 | IMW-01 to IMW-06 |
| 06 | Match engine | Artist facts, taste distribution, pair match, stories maths. | 02, 03 | MAT-01 to MAT-06 |
| 07 | Blend builder | Deterministic greedy fair-welfare playlist of 50. | 06 | BLD-01 to BLD-04 |
| 08 | Blend backend | Tables, invariants, API routes, build orchestration, erase. | 03, 06, 07 | BLN-01 to BLN-08 |
| 09 | Blend web | Create, invite, join, reveal, Blend page, stories, states. | 08 | WEB-01 to WEB-08 |
| 10 | Mobile | Blend and Import on LuvLyrics. | 05, 09 | MOB-01 to MOB-03 |
| 11 | Groups of 3 to 6 | Raise the cap; group stories and ring UI. | 09 | GRP-01 to GRP-04 |

Phases 01, 02 can run in parallel. 03 and 04 can run in parallel after 02. 06 needs 03.
05 can run in parallel with 06–08.

### Phase 01: Retention truth

Plans:
- [ ] 01-01 Inactivity sweep slack and shared touch constant (wave 1)
- [ ] 01-02 Report detail minimisation after one year (wave 1)
- [ ] 01-03 Remove dead `playStats` and correct the architecture doc (wave 1)
- [ ] 01-04 Library tombstone pruning with client resync (wave 2)

Success criteria:
1. A profile untouched for 90 days plus the 7-day touch interval is erased; one inside it is not.
2. Closed reports lose `contact` and `details` 365 days after `closedAt`; record fields remain.
3. Tombstones older than 90 days are deleted; a device with an older cursor fully resyncs and
   ends with the same library as a fresh device.
4. The privacy page lists every retention period that the code enforces, and no other.

### Phase 02: Shared foundations

Plans:
- [ ] 02-01 `identityKey` and `creditedArtists` in `packages/shared/identity.ts`, all callers moved (wave 1)
- [ ] 02-02 Forward decay and tally amounts (wave 1)
- [ ] 02-03 `randomCode` without modulo bias, used for share codes (wave 1)

### Phase 03: Taste tally

Plans:
- [ ] 03-01 Convex tables `tasteSongs`, `tasteMeta` and `convex/taste.ts` (wave 1)
- [ ] 03-02 API port `TasteTally` (Convex and Memory) wired into services (wave 2)
- [ ] 03-03 Feed the tally from listens, likes and playlist adds; clear, erase, export (wave 3)
- [ ] 03-04 Privacy page text, `POLICY_VERSION`, consent behaviour check (wave 4, checkpoint)

### Phase 04: Import core

Plans:
- [ ] 04-01 Real export fixture (checkpoint: owner supplies a Spotify data download) (wave 1)
- [ ] 04-02 Parsers in `packages/shared/importParse.ts` (wave 2)
- [ ] 04-03 `origin: 'import'` on likes and playlists through ops, Convex and contract (wave 1)
- [ ] 04-04 `POST /api/import/match` service, route, cache, rate limit, flag (wave 3)
- [ ] 04-05 `POST /api/me/taste/import-seed` (wave 4)

### Phase 05: Import web

Plans:
- [ ] 05-01 Route `/import`, flag, entry points, reducer skeleton (wave 1)
- [ ] 05-02 File reading in a worker: JSON, CSV, ZIP with size guards (wave 2)
- [ ] 05-03 Matching with progress, cancel and IndexedDB resume (wave 3)
- [ ] 05-04 Review, save through library sync, done, seed; browser verification (wave 4, checkpoint)

### Phase 06: Match engine

Plans:
- [ ] 06-01 Artist facts service (wave 1)
- [ ] 06-02 `memberTaste` distribution (wave 2)
- [ ] 06-03 `enjoyment`, `pairMatch`, `explainChange` with ported simulation fixtures (wave 3)
- [ ] 06-04 Story maths: together song, gift, artist, `storiesFor` (wave 4)

### Phase 07: Blend builder

Plans:
- [ ] 07-01 PRNG and `buildBlend` with all fixtures (wave 1)

### Phase 08: Blend backend

Plans:
- [ ] 08-01 Convex tables and `convex/blends.ts` with invariant tests (wave 1)
- [ ] 08-02 Contract entries, `BLEND_ENABLED`, routes, rate limits (wave 2)
- [ ] 08-03 Build orchestration: loaders, Gaana resolution, facts, discovery, compare-and-set (wave 3)
- [ ] 08-04 Erase, learning-off and data export integration (wave 3)

### Phase 09: Blend web

Plans:
- [ ] 09-01 Routes, API client, flag, Blends shelf in Library (wave 1)
- [ ] 09-02 Create, consent and invite sheets; join page (wave 2)
- [ ] 09-03 Reveal and `MatchNumber` (wave 3)
- [ ] 09-04 Blend page and track list on the playback funnel (wave 3)
- [ ] 09-05 Story cards and canvas share (wave 4)
- [ ] 09-06 States, accessibility, end-to-end browser verification (wave 5, checkpoint)

### Phase 10: Mobile

Plans:
- [ ] 10-01 Mobile API client and Blend screens (wave 1)
- [ ] 10-02 Mobile import with the document picker (wave 1)
- [ ] 10-03 Deep links and device verification (wave 2, checkpoint)

### Phase 11: Groups of 3 to 6

Plans:
- [ ] 11-01 Cap 6, group invariants, builder fixtures for 3 and 6 (wave 1)
- [ ] 11-02 Ring UI and group stories (wave 2, checkpoint)
