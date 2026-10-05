# 04-03 Summary: `origin: 'import'` on library rows

## Changes

- `packages/shared/library.ts`: `LibraryOrigin = 'import'`; optional `origin` on the `like` and
  `playlist_upsert` ops, `LikeRow`, `PlaylistRow`, and the `like` / `playlist` changes. Rules: a like
  op sets origin to its own (a native like clears it); an unlike keeps the row's; `playlist_upsert`
  sets origin only when creating (including re-creating a deleted one) and never clears it; delete
  keeps it; items carry none. `parseLibraryOps` keeps only the value `'import'`. Synced to the API.
- `convex/schema.ts`: `origin: v.optional(v.literal('import'))` on `libraryLikes` and
  `libraryPlaylists` (additive; no migration).
- `convex/library.ts`: the op and change validators accept `origin`; rows pass it through unchanged.
- The memory store and `ConvexLibraryStore` needed no code: they store/pass the shared rows, and
  Convex's `returns` validator already restricts the value.
- `docs/api-contract.md` Library sync: `origin?` on ops and changes, with the clearing rules.
- Tests: four cases in `packages/shared/library.test.ts`; new `convex/library.test.ts` (registered in
  root `convex:test`) proving the round trip through `library:apply` → `library:changes`, and that a
  later native like clears the mark.

## Verification

- `npm test --workspace packages/shared` — 73 passed.
- `npx vitest run convex/library.test.ts` — 1 passed.
- `cd apps/mobile && npx tsc --noEmit` — exit 0.
- Full gate — exit 0.
