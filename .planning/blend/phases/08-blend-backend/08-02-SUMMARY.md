# 08-02 Summary: Blend contract and routes

## Changes

- `docs/api-contract.md`: new "Blend — additive" section (every B3 row, the error table, types,
  limits) and `blends` in the export shape.
- Response types live in `packages/shared/blendView.ts` (synced), not `packages/shared/types.ts`:
  the API cannot import `types.ts` (it keeps a hand mirror), so a synced file keeps one definition.
- `apps/api/src/user/blendStore.ts`: `BlendStore`, `BlendError`, `MemoryBlendStore` (same rules as
  Convex); `apps/api/src/db/convexBlendStore.ts`: `ConvexBlendStore` mapping `ConvexError` codes to
  `BlendError`; gateway names registered.
- `apps/api/src/routes/blends.ts`: every B3 row; flag gate (404); guests 403 with `blend.signin`
  except the preview; `consent.policyVersion` must equal `POLICY_VERSION`; codes from
  `randomCode(12)`; join URL `${ALLEGRA_ORIGIN}/blend/join/<code>`; display name = profile name ≤ 40
  or "Listener"; default Blend name "Our Blend".
- Error replies add a `code` field beside `{ success, data, error }` because `full` and `limit` share
  HTTP 409 and the join page needs to tell them apart (documented in the contract).
- Expired codes: the preview answers `notfound` for unknown, malformed and expired codes alike (plan
  08-01 truth and B3 text); `accept` answers `expired` (410) for a known but expired or regenerated
  code (§8.2). The B3 table's `expired` field on the preview was therefore dropped from the reply.
- `app.ts`: mounted; `GET /api/blend-invites/*` uses the lookup bucket; writes to `/api/blends*` and
  `/api/blend-invites*` use the writes bucket. `BLEND_ENABLED` config/env from 04-04.
- D6 cold start: create and accept call `BlendBuildService.seedTally` (best effort) for a listener
  with learning on.
- Tests: `user/blendStore.test.ts` (7) and `app.blends.test.ts` (10: flag off, guests, consent and
  create, preview sameness, accept/expired/full/stranger, non-member 404 on every route, build with
  every provider down + rename + leave, lookup bucket 429, learning/export/erase, the 20 limit).

## Verification

- `node --import tsx --test src/app.blends.test.ts src/user/blendStore.test.ts` — all passed.
- Full gate — exit 0.
