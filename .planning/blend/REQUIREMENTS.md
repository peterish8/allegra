# Requirements: Blend and Import

Each requirement is testable. Section numbers refer to [PLAN.md](PLAN.md).

## Retention (phase 01)
- **RET-01** The inactivity sweep erases a guest after `GUEST_RETENTION_DAYS + ACTIVE_TOUCH_DAYS` days without a recorded touch, and an account after `ACTIVE_TOUCH_DAYS + ACCOUNT_RETENTION_DAYS`; never earlier than the page promises.
- **RET-02** `ACTIVE_TOUCH_DAYS` is defined once in `packages/shared/legal.ts` and read by the API and Convex.
- **RET-03** Closed reports keep code, reason, status, `createdAt`, `closedAt`; `contact` and `details` are removed 365 days after `closedAt`.
- **RET-04** Library tombstones older than 90 days are deleted; a sync cursor older than the pruned revision gets `resync: true`, and both clients rebuild from revision 0 without losing live rows or keeping deleted ones.
- **RET-05** `playStats` is gone from the schema and code; `docs/architecture.md` and the privacy page describe only what is stored.

## Foundations (phase 02)
- **FND-01** `identityKey(title, artist)` in `packages/shared/identity.ts` is the only song identity function; the API and web copies are deleted.
- **FND-02** `creditedArtists(artist)` in `packages/shared/identity.ts` is the only artist splitter.
- **FND-03** `decayFactor`, `addDecayed`, `currentWeight` implement PLAN §4.1 with landmark 2026-01-01 and a 45-day half-life.
- **FND-04** `randomCode(length)` draws from `CODE_ALPHABET` by rejection sampling; share codes use it.

## Taste tally (phase 03)
- **TAL-01** A listener with learning on has at most 200 `tasteSongs` rows; the 201st distinct song evicts the lowest score.
- **TAL-02** A listen adds `listenAmount` (PLAN §4.2) at `playedAt`; the same `playedAt` for the same song is applied once.
- **TAL-03** A native like adds 10 once; an unlike removes it once; a native playlist add adds 5; imported likes and playlists add nothing.
- **TAL-04** Turning learning off deletes the listener's tally.
- **TAL-05** Erasing an account deletes its tally; the data export includes the tally as titles, artists and whole minutes.
- **TAL-06** The web listen signal sends `playedAt`.
- **TAL-07** The privacy page discloses the 200-song tally and `POLICY_VERSION` moves on.

## Import core (phase 04)
- **IMP-01** A real Spotify data download, reduced and anonymised, is committed as a fixture.
- **IMP-02** `parseSpotifyLibrary`, `parseSpotifyPlaylists`, `parseCsv` return `ImportBundle` shapes, skip podcasts and local files, and cap at 10,000 tracks and 200 playlists.
- **IMP-03** Like and playlist rows can carry `origin: 'import'` end to end (ops, Convex, change feed, contract); absent means native.
- **IMP-04** `POST /api/import/match` matches up to 50 tracks per call with `exact | close | none`, shared 30-day cache, at most 4 searches in flight, own rate-limit bucket, account only, behind `IMPORT_ENABLED`.
- **IMP-05** A provider timeout yields `none` for that track and never fails the batch.
- **IMP-06** `POST /api/me/taste/import-seed` applies at most 25 artist seeds with log-scaled weight.

## Import web (phase 05)
- **IMW-01** `/import` exists behind `NEXT_PUBLIC_IMPORT_ENABLED`, linked from Settings and the empty Library.
- **IMW-02** The file is parsed in a Web Worker; nothing but title, artist, album and duration leaves the device.
- **IMW-03** ZIP entries over 20 MB and archives over 200 MB are rejected before inflating.
- **IMW-04** Matching runs 50 per batch, 2 in flight, can be cancelled, and resumes after reload from IndexedDB keyed by the file's SHA-256.
- **IMW-05** Nothing is written before the review step is confirmed; saving uses library sync in chunks of at most 100 ops and 28 KB, waits on 429 `Retry-After`, with deterministic playlist ids, so a second import creates no duplicates.
- **IMW-06** Progress is announced politely at most every 2 s; all controls are keyboard reachable.

## Match engine (phase 06)
- **MAT-01** `artistFacts` returns popularity, language and up to 10 similar artists per artist, cached 30 days, 4 in flight, 3 s budget, with documented fallbacks.
- **MAT-02** `memberTaste` builds `p` and `q` per PLAN §4.4; each sums to 1; layer size does not change a layer's total.
- **MAT-03** `pairMatch` implements PLAN §4.6 with constants in one `MATCH` object; outputs are finite, 0–99, symmetric.
- **MAT-04** The simulation table in PLAN §4.6 holds as an ordering test.
- **MAT-05** `explainChange` returns a reason only when |Δmatch| ≥ 5 and names the artist whose contribution moved most.
- **MAT-06** Stories: together song (pairs only, thresholds 0.5 and 0.3), together artist, gift, both directions; `storiesFor` returns the pair set for 2 members and the group set for 3 or more.

## Builder (phase 07)
- **BLD-01** `buildBlend` implements PLAN §4.7 and returns at most 50 unique identities.
- **BLD-02** Same seed gives the same output; a new day changes at least 10 positions.
- **BLD-03** Each member's average enjoyment is within 0.05 of the others for the simulated pairs.
- **BLD-04** No lead artist twice within 4 tracks unless only one artist remains.

## Blend backend (phase 08)
- **BLN-01** Tables `blends`, `blendMembers`, `blendInvites` per PLAN §5.
- **BLN-02** Invariants: member cap, 20 Blends per user, idempotent join, owner hand-over, last leave deletes, membership change marks stale.
- **BLN-03** Routes per PLAN B3 table, account only, behind `BLEND_ENABLED`, documented in `docs/api-contract.md` first.
- **BLN-04** Non-members get `notfound` for a Blend; unknown, malformed and expired invite codes are indistinguishable.
- **BLN-05** Invite codes are 12 characters from `randomCode`, expire after 7 days, one live invite per Blend.
- **BLN-06** A Blend rebuilds on open when `builtFor` is before today (UTC) or `stale`; concurrent builds never overwrite each other (compare-and-set).
- **BLN-07** Builds resolve Gaana-only songs to Saavn or drop them; a provider outage still yields a build from library data.
- **BLN-08** Erase and learning-off reach Blends (leave rules; `learning` flag).

## Blend web (phase 09)
- **WEB-01** Routes `/blends`, `/blend/:id`, `/blend/join/:code` behind `NEXT_PUBLIC_BLEND_ENABLED`; Blends shelf in Library.
- **WEB-02** Create and join both pass through a consent sheet carrying `POLICY_VERSION`.
- **WEB-03** The invite sheet polls every 3 s only while open and visible, and moves to the reveal at 2 members.
- **WEB-04** The reveal animates with motion tokens, transform and opacity only, plays once per build, and is skippable.
- **WEB-05** The Blend page plays through `requestPlayback` with the Blend as the queue; rows show who each song is for.
- **WEB-06** Story cards follow `storiesFor`; each can be shared as a 1080 × 1920 PNG.
- **WEB-07** Every state in PLAN W6 renders correctly at 360, 768 and 1280 px.
- **WEB-08** Reduced motion shows no movement other than opacity; all controls keyboard reachable.

## Mobile (phase 10)
- **MOB-01** Blends list, detail and join on LuvLyrics using the same endpoints.
- **MOB-02** Import from a picked file with the shared parsers and endpoint.
- **MOB-03** `lyricflow://blend/join/<code>` and the https link open the join screen.

## Groups (phase 11)
- **GRP-01** `BLEND_MAX_MEMBERS` becomes 6; all invariants hold at 6.
- **GRP-02** Builder fixtures for 3 and 6 members keep average enjoyment within 0.05.
- **GRP-03** Group stories: group match, most and least in tune with you, glue; no song card.
- **GRP-04** Ring UI with pair lines scaled by match, transform only.
