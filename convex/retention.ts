/**
 * Retention passes the privacy policy promises beyond the inactivity sweep (convex/account.ts).
 * Each pass handles one bounded page and schedules the next page when work remains.
 */
import { v } from 'convex/values';

import { LIBRARY_TOMBSTONE_RETENTION_DAYS, REPORT_DETAIL_RETENTION_DAYS } from '../packages/shared/legal';
import { internal } from './_generated/api';
import { internalMutation } from './_generated/server';

const BATCH = 200;
const LIBRARY_BATCH = 100;
const DAY_MS = 24 * 60 * 60 * 1000;
const cursorValidator = v.union(v.string(), v.null());

/** Removes what a reporter typed and how to reach them, a year after the report closed. */
export const trimClosedReports = internalMutation({
  args: { cursor: v.optional(cursorValidator) },
  returns: v.object({ trimmed: v.number(), done: v.boolean() }),
  handler: async (ctx, args) => {
    const cutoff = Date.now() - REPORT_DETAIL_RETENTION_DAYS * DAY_MS;
    const page = await ctx.db
      .query('reports')
      .withIndex('by_status_and_closedAt', (q) => q.eq('status', 'closed').gt('closedAt', 0).lt('closedAt', cutoff))
      .paginate({ numItems: BATCH, cursor: args.cursor ?? null });
    let trimmed = 0;
    for (const row of page.page) {
      if (row.contact === undefined && row.details === undefined) continue;
      await ctx.db.patch('reports', row._id, { contact: undefined, details: undefined });
      trimmed += 1;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.retention.trimClosedReports, { cursor: page.continueCursor });
    }
    return { trimmed, done: page.isDone };
  }
});

/** Gives legacy closed reports a full year of retention from this migration. */
export const backfillClosedReports = internalMutation({
  args: { cursor: v.optional(cursorValidator) },
  returns: v.object({ backfilled: v.number(), done: v.boolean() }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query('reports')
      .withIndex('by_status_and_createdAt', (q) => q.eq('status', 'closed'))
      .paginate({ numItems: BATCH, cursor: args.cursor ?? null });
    const migrationTime = Date.now();
    let backfilled = 0;
    for (const row of page.page) {
      if (row.closedAt !== undefined) continue;
      await ctx.db.patch('reports', row._id, { closedAt: migrationTime });
      backfilled += 1;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.retention.backfillClosedReports, { cursor: page.continueCursor });
    }
    return { backfilled, done: page.isDone };
  }
});

/** Removes old library removal markers and remembers the highest revision each listener lost. */
export const pruneLibraryTombstones = internalMutation({
  args: {},
  returns: v.object({ pruned: v.number(), done: v.boolean() }),
  handler: async (ctx) => {
    const cutoff = Date.now() - LIBRARY_TOMBSTONE_RETENTION_DAYS * DAY_MS;
    const [likes, playlists, items] = await Promise.all([
      ctx.db.query('libraryLikes')
        .withIndex('by_liked_and_updatedAt', (q) => q.eq('liked', false).lt('updatedAt', cutoff))
        .take(LIBRARY_BATCH),
      ctx.db.query('libraryPlaylists')
        .withIndex('by_deleted_and_updatedAt', (q) => q.eq('deleted', true).lt('updatedAt', cutoff))
        .take(LIBRARY_BATCH),
      ctx.db.query('libraryItems')
        .withIndex('by_deleted_and_updatedAt', (q) => q.eq('deleted', true).lt('updatedAt', cutoff))
        .take(LIBRARY_BATCH)
    ]);

    const prunedRevByUser = new Map<string, number>();
    for (const row of [...likes, ...playlists, ...items]) {
      prunedRevByUser.set(row.userId, Math.max(prunedRevByUser.get(row.userId) ?? 0, row.rev));
    }
    for (const [userId, rev] of prunedRevByUser) {
      const state = await ctx.db.query('libraryState').withIndex('by_userId', (q) => q.eq('userId', userId)).unique();
      if (state) {
        await ctx.db.patch('libraryState', state._id, { prunedRev: Math.max(state.prunedRev ?? 0, rev) });
      } else {
        // Library rows normally always have state. Preserve the marker if repairing a legacy orphan.
        await ctx.db.insert('libraryState', { userId, rev, prunedRev: rev });
      }
    }

    for (const row of likes) {
      if (row.liked) throw new Error('Library retention selected a live like');
      await ctx.db.delete('libraryLikes', row._id);
    }
    for (const row of playlists) {
      if (!row.deleted) throw new Error('Library retention selected a live playlist');
      await ctx.db.delete('libraryPlaylists', row._id);
    }
    for (const row of items) {
      if (!row.deleted) throw new Error('Library retention selected a live playlist item');
      await ctx.db.delete('libraryItems', row._id);
    }

    const done = likes.length < LIBRARY_BATCH && playlists.length < LIBRARY_BATCH && items.length < LIBRARY_BATCH;
    if (!done) await ctx.scheduler.runAfter(0, internal.retention.pruneLibraryTombstones, {});
    return { pruned: likes.length + playlists.length + items.length, done };
  }
});
