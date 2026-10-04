/**
 * Retention passes the privacy policy promises beyond the inactivity sweep (convex/account.ts).
 * Each pass handles one bounded page and schedules the next page when work remains.
 */
import { v } from 'convex/values';

import { REPORT_DETAIL_RETENTION_DAYS } from '../packages/shared/legal';
import { internal } from './_generated/api';
import { internalMutation } from './_generated/server';

const BATCH = 200;
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
