# 08-01 Summary: Convex Blend tables and functions

## Changes

- `packages/shared/blendLimits.ts` (synced): `BLEND_MAX_MEMBERS = 2`, `BLEND_MEMBERS_CEILING = 6`,
  `BLEND_MAX_PER_USER = 20`, `BLEND_INVITE_DAYS = 7`, `BLEND_NAME_MAX = 60`,
  `BLEND_DISPLAY_NAME_MAX = 40`, `BLEND_INVITE_CODE_LENGTH = 12`, `BLEND_INVITE_ALPHABET`,
  `BLEND_MIN_TRACKS = 10`, `isBlendInviteCode`, `initialsOf`, `utcDay`.
- `convex/schema.ts`: `blends`, `blendMembers`, `blendInvites` as PLAN §5 with its indexes, plus
  exported `blendTrack`, `pairMatch`, `blendStorySong`, `blendGift` validators. The existing
  `songSnapshot` export in schema.ts was reused instead of a new `convex/validators.ts`.
  Additions: `blends.together/gifts/glue` (optional; story inputs computed at build time, so a Blend
  opened later shows its cards without rebuilding) and index `by_memberCount_and_createdAt` (for the
  sweep of unjoined Blends).
- `convex/blends.ts`: secret-guarded `create`, `get`, `listForUser`, `invite`, `preview`, `join`,
  `leave`, `rename`, `saveBuild`, `setLearning`, `renameMember`; internal `sweep`; exported
  `leaveBlend(ctx, blendId, userId)`. Errors are `ConvexError({ code })`. Ids are normalised with
  `ctx.db.normalizeId`, so a malformed id is simply "not found". `preview` takes `now` from the API
  (no clock inside a query). Bounded reads only; no `.collect(`.
- `saveBuild` keeps the identities of exactly the last two builds: the new build's, then the replaced
  build's (its first `tracks.length` entries). The first draft kept up to 50 regardless and the memory
  store test caught it.
- `convex/crons.ts`: daily `blends.sweep` (expired invites; Blends with one member older than 7 days).
- `convex/blends.test.ts` (registered in `convex:test`): 14 tests covering every frontmatter truth plus
  rename rules, non-member `get`, learning switch, and the secret.
- `convex/_generated/api.d.ts`: `taste` added by `npx convex codegen` (which contacted the configured
  dev deployment for analysis); `blends` added by hand afterwards to avoid further remote calls.
  `npx tsc --noEmit -p convex/tsconfig.json` passes.

## Verification

- `npx vitest run convex/blends.test.ts` — 14 passed. Full gate — exit 0 (Convex Vitest 62).
