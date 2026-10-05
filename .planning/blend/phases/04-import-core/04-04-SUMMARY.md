# 04-04 Summary: `POST /api/import/match`

## Changes

- `apps/api/src/services/importMatch.ts`: `IMPORT_MATCH` constants, pure `scoreCandidate`,
  `normalText`, `similarity` (Dice bigrams), and `ImportMatcher.match`. Titles normalise through
  `identityKey` and also drop a Spotify-style " - Remastered …" suffix on both sides. Only Saavn rows
  can match. Searches go through a 4-slot limiter; results are cached under
  `import-match:<identityKey>:<duration>` (hit 30 d, miss 7 d).
  Deliberate refinement: an empty search result or a thrown search is **not** cached as a 7-day miss
  (an outage would otherwise hide songs for a week); a search that returns only non-matching rows is.
- `apps/api/src/routes/imports.ts`: `importsRouter(auth, matcher, enabled)`; 404 when the flag is off,
  401 without a session, 403 `import.signin` copy for guests, strict body validation (1–50 tracks,
  text ≤ 200, duration 0–7200). Exports `accountUser`, reused by the Blend routes.
- `apps/api/src/config.ts`: `importEnabled` / `blendEnabled` from `IMPORT_ENABLED` / `BLEND_ENABLED`
  (exactly `"true"`); `apps/api/.env.example` documents both.
- `apps/api/src/app.ts`: mounts the router, `importEnabled`/`blendEnabled` options, and an `imports`
  rate-limit bucket (30/min) for `/api/import*`.
- `apps/api/src/services.ts`: `services.importMatcher`.
- `docs/api-contract.md`: new "Import — additive" section.
- Tests: `services/importMatch.test.ts` (8: exact, close via feat., near title, duration mismatch →
  close, none, Gaana-only → none, cache hit, throwing catalog not cached, ≤ 4 in flight),
  `app.imports.test.ts` (flag off 404, guest 403 / no session 401, 0/51/over-long/invalid → 400,
  exact Saavn snapshot, cache hit, timeout → none in a 200 batch, 31st request → 429),
  `config.test.ts` flag test.

## Verification

- `node --import tsx --test src/services/importMatch.test.ts src/app.imports.test.ts` — all passed.
- Full gate — exit 0.

## Not done

- The manual `curl` against a running dev server with real providers was not run.
