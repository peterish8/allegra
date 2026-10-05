import assert from 'node:assert/strict';
import test from 'node:test';

import { ConvexLibraryStore } from './convexLibrary.js';
import type { ConvexGateway } from './convexGateway.js';

test('Convex library pages preserve the resync marker and send continuation mode', async () => {
  const queries: { name: string; args: Record<string, unknown> }[] = [];
  const convex = {
    query: async (name: string, args: Record<string, unknown>) => {
      queries.push({ name, args });
      return {
        seeded: true,
        rev: 4,
        changes: [{ kind: 'like', rev: 4, ref: 'saavn:a', liked: true, likedAt: 4 }],
        more: true,
        resync: true
      };
    },
    mutation: async () => null
  } as unknown as ConvexGateway;
  const store = new ConvexLibraryStore(convex);

  const first = await store.changes('listener', 1, 1);
  assert.equal(first.resync, true);
  assert.equal(first.more, true);
  assert.equal(queries[0]?.args.resync, undefined);

  const next = await store.changes('listener', first.rev, 1, true);
  assert.equal(next.resync, true);
  assert.deepEqual(queries[1]?.args, { userId: 'listener', since: 4, limit: 1, resync: true });
});
