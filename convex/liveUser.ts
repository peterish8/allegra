import { getAuthUserId } from '@convex-dev/auth/server';
import type { MutationCtx, QueryCtx } from './_generated/server';

/**
 * The signed-in listener's id, but only while their account still exists.
 *
 * A JWT stays valid until it expires, and Convex Auth's `getAuthUserId` reads the id out of it without looking
 * at the database. An erased account has no `users` row (`account.erase` deletes it first), so without this check
 * a device holding the old token could still register devices or open rooms for an account that no longer exists.
 *
 * An id that is not shaped like a `users` id is not an erased account: Convex Auth only issues real ones, and the
 * test fixtures use plain names. Only a real `users` id with no row behind it is refused.
 */
export async function liveAuthUserId(ctx: QueryCtx | MutationCtx): Promise<string | null> {
  const id = await getAuthUserId(ctx);
  if (!id) return null;
  const row = ctx.db.normalizeId('users', id);
  if (row && !(await ctx.db.get('users', row))) return null;
  return String(id);
}
