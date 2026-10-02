/**
 * Complaints about shared playlists, for the grievance officer (docs/grievance-handling.md).
 * `file` is called by the Express API with the shared server secret; reading and acting on
 * reports is done by the officer from the Convex dashboard or `npx convex run`.
 */
import { v } from 'convex/values';

import { REPORT_CONTACT_MAX, REPORT_DETAILS_MAX } from '../packages/shared/legal';
import { internalMutation, internalQuery, mutation, type MutationCtx } from './_generated/server';
import { requireSecret } from './profiles';

/** Reports kept per link. Past this a new one is dropped: the officer already has plenty to act on. */
const MAX_PER_CODE = 20;

/** Records a report against a live share link. False when the link does not exist (or was turned off). */
export const file = mutation({
  args: {
    secret: v.string(),
    code: v.string(),
    reason: v.union(v.literal('copyright'), v.literal('illegal'), v.literal('abuse'), v.literal('other')),
    details: v.optional(v.string()),
    contact: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const share = await ctx.db
      .query('shares')
      .withIndex('by_code', (q) => q.eq('code', args.code))
      .unique();
    if (!share) return false;
    const existing = await ctx.db
      .query('reports')
      .withIndex('by_code', (q) => q.eq('code', args.code))
      .take(MAX_PER_CODE);
    if (existing.length >= MAX_PER_CODE) return true;
    await ctx.db.insert('reports', {
      code: args.code,
      ownerId: share.ownerId,
      libraryId: share.libraryId,
      reason: args.reason,
      ...(args.details ? { details: args.details.slice(0, REPORT_DETAILS_MAX) } : {}),
      ...(args.contact ? { contact: args.contact.slice(0, REPORT_CONTACT_MAX) } : {}),
      createdAt: Date.now(),
      status: 'open'
    });
    return true;
  }
});

/**
 * Open reports, oldest first.
 *
 *   npx convex run reports:open
 */
export const open = internalQuery({
  args: {},
  handler: async (ctx) => {
    return ctx.db
      .query('reports')
      .withIndex('by_status_and_createdAt', (q) => q.eq('status', 'open'))
      .take(100);
  }
});

/**
 * Acts on a report: turns the share link off (it answers "not found" at once) and closes every
 * report against it. `removeCover` also deletes the playlist's uploaded cover image.
 *
 *   npx convex run reports:takeDown '{"code":"abcd2345","removeCover":true}'
 */
export const takeDown = internalMutation({
  args: { code: v.string(), removeCover: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const share = await ctx.db
      .query('shares')
      .withIndex('by_code', (q) => q.eq('code', args.code))
      .unique();
    if (share && args.removeCover) {
      const playlist = await ctx.db
        .query('libraryPlaylists')
        .withIndex('by_userId_and_playlistId', (q) => q.eq('userId', share.ownerId).eq('playlistId', share.libraryId))
        .unique();
      const id = playlist?.coverKey ? ctx.db.system.normalizeId('_storage', playlist.coverKey) : null;
      if (id && (await ctx.db.system.get('_storage', id))) await ctx.storage.delete(id);
    }
    if (share) await ctx.db.delete('shares', share._id);
    return closeFor(ctx, args.code);
  }
});

/**
 * Closes the reports against a link without acting on it (a complaint that did not hold up).
 *
 *   npx convex run reports:dismiss '{"code":"abcd2345"}'
 */
export const dismiss = internalMutation({
  args: { code: v.string() },
  handler: async (ctx, args) => closeFor(ctx, args.code)
});

async function closeFor(ctx: MutationCtx, code: string): Promise<number> {
  const rows = await ctx.db
    .query('reports')
    .withIndex('by_code', (q) => q.eq('code', code))
    .take(MAX_PER_CODE);
  let closed = 0;
  for (const row of rows) {
    if (row.status === 'closed') continue;
    await ctx.db.patch('reports', row._id, { status: 'closed' });
    closed += 1;
  }
  return closed;
}
