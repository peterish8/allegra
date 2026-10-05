# 08-04 Summary: erase, learning, export, policy text

## Changes

- `convex/account.ts` `eraseSome`: memberships `take(BATCH)` → `leaveBlend` each (hand-over or
  delete), `more ||=` on a full batch. Test in `convex/account.test.ts`.
- `blends:setLearning` (08-01) is called from `PATCH /api/me/settings` whenever `personalization`
  is set either way, in its own try/catch.
- `PATCH /api/me/profile` tells `blends:renameMember` about a new display name (PLAN §5 "updated on
  rename").
- `GET /api/me/export` adds `blends: { name, joinedAt, members: displayName[] }[]`; contract updated.
- `DELETE /api/me` calls `BlendStore.forget` for the memory store (Convex's erase already leaves).
- `apps/web/src/components/LegalPage.tsx`: "If you make or join a Blend" paragraph (plan text plus one
  sentence saying members see display name and initials, never email or photo) and "If you import
  your library" (PLAN §3 import text). Same `POLICY_VERSION` (2026-10-05) as 03-04, since neither has
  shipped.

## Verification

- `npx vitest run convex/account.test.ts` — 14 passed; `app.blends.test.ts` learning/export/erase
  test passed. Full gate — exit 0.
