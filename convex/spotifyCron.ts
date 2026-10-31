import { internal } from './_generated/api';
import { internalAction, internalMutation } from './_generated/server';
import { v } from 'convex/values';

// ponytail: 40 continuation calls x ~45s budget x 50-track steps caps one account's day; raise if big libraries stall.
const MAX_ROUNDS = 40;
// Accounts start this far apart so one run never bursts the app-wide Spotify rate limit (1,000 accounts ≈ 33 minutes).
const STAGGER_MS = 2_000;

/** Starts one run; its start time names the run so every continuation walks the same set of playlists. */
export const scheduleDaily = internalAction({
  args: {},
  handler: async (ctx) => {
    const apiUrl = process.env.ALLEGRA_API_URL?.replace(/\/$/, '');
    const secret = process.env.CONVEX_SERVER_SECRET;
    if (!apiUrl || !secret) return { configured: false };
    await ctx.scheduler.runAfter(0, internal.spotifyCron.scheduleBatch, { runStartedAt: Date.now(), scheduled: 0 });
    return { configured: true };
  }
});

/** Each continuation schedules at most 100 accounts and resumes after the last indexed account, so none starve. */
export const scheduleBatch = internalAction({
  args: { after: v.optional(v.string()), runStartedAt: v.number(), scheduled: v.number() },
  handler: async (ctx, args) => {
    if (!process.env.CONVEX_SERVER_SECRET || !process.env.ALLEGRA_API_URL) return null;
    const page: { users: string[]; next: string | null } = await ctx.runQuery(internal.spotify.dailyAccounts, args.after ? { after: args.after } : {});
    for (const [index, userId] of page.users.entries()) {
      await ctx.scheduler.runAfter((args.scheduled + index) * STAGGER_MS, internal.spotifyCron.dailyUser, { userId, attempt: 0, round: 0, runStartedAt: args.runStartedAt });
    }
    if (page.next) await ctx.scheduler.runAfter(0, internal.spotifyCron.scheduleBatch, { after: page.next, runStartedAt: args.runStartedAt, scheduled: args.scheduled + page.users.length });
    return null;
  }
});

export const dailyUser = internalAction({
  args: { userId: v.string(), attempt: v.number(), round: v.optional(v.number()), runStartedAt: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const apiUrl = process.env.ALLEGRA_API_URL?.replace(/\/$/, '');
    const secret = process.env.CONVEX_SERVER_SECRET;
    if (!apiUrl || !secret) return null;
    const round = args.round ?? 0;
    const next = (attempt: number, nextRound: number) => ({ userId: args.userId, attempt, round: nextRound, ...(args.runStartedAt !== undefined ? { runStartedAt: args.runStartedAt } : {}) });
    try {
      const response = await fetch(`${apiUrl}/api/internal/spotify/daily`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-convex-server-secret': secret },
        body: JSON.stringify({ userId: args.userId, ...(args.runStartedAt !== undefined ? { runStartedAt: args.runStartedAt } : {}) }), signal: AbortSignal.timeout(120_000)
      });
      if (response.ok) {
        // The API stops each call at a time budget; `more` means this run still has playlists or pages left.
        const body = await response.json().catch(() => null) as { data?: { more?: unknown } } | null;
        if (body?.data?.more === true && round < MAX_ROUNDS) await ctx.scheduler.runAfter(30_000, internal.spotifyCron.dailyUser, next(0, round + 1));
        return null;
      }
      // Retryable failures leave the playlist unmarked, so the retry resumes it from its checkpoint.
      if ((response.status === 429 || response.status >= 500) && args.attempt < 2) {
        await ctx.scheduler.runAfter(retryDelayMs(response.headers.get('retry-after')), internal.spotifyCron.dailyUser, next(args.attempt + 1, round));
      }
    } catch {
      if (args.attempt < 2) await ctx.scheduler.runAfter(3_600_000, internal.spotifyCron.dailyUser, next(args.attempt + 1, round));
    }
    return null;
  }
});

/** Honour Spotify's Retry-After (seconds), clamped to a minute..an hour; an hour when it sent none. */
export function retryDelayMs(header: string | null): number {
  const seconds = header === null || header.trim() === '' ? NaN : Number(header);
  return Number.isFinite(seconds) ? Math.max(60_000, Math.min(3_600_000, seconds * 1000)) : 3_600_000;
}

/** Unconsumed OAuth states (user closed the Spotify tab) expire after ten minutes; drop them. */
export const sweepStates = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('spotifyOAuthStates').withIndex('by_expiresAt', q => q.lt('expiresAt', Date.now())).take(200);
    for (const row of rows) await ctx.db.delete('spotifyOAuthStates', row._id);
    return rows.length;
  }
});
