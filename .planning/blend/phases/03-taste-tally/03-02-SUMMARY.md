# 03-02 Summary: TasteTally port

## Result

Found implemented in the working tree; verified.

- `apps/api/src/user/tasteTally.ts`: `TasteTally`, `TallySong`, `TallySeed`, `MemoryTasteTally`
  (same rules as `convex/taste.ts`, injectable clock, shared decay and identity copies).
- `apps/api/src/user/tasteTally.test.ts`: the rule tests ported, including the delayed like/unlike
  regression.
- `apps/api/src/db/convexTasteTally.ts`: `ConvexTasteTally` with narrow parsing of replies.
- `apps/api/src/db/convexGateway.ts`: `taste:top` query; `taste:record|bonus|seed|clear` mutations.
- `apps/api/src/services.ts`: `readonly tally: TasteTally` on `AppServices`; optional `tally` in
  `ServiceOptions`; Convex adapter when configured, memory otherwise.

## Verification

- `node --import tsx --test src/user/tasteTally.test.ts` (apps/api) — passed.
- `npm test --workspace apps/api` — passed as part of the full gate.
