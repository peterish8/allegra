import { internal, api } from './_generated/api';
import { internalAction, internalMutation } from './_generated/server';
import { v } from 'convex/values';

// ponytail: 40 continuation calls x ~45s budget x 50-track steps caps one account's day; raise if big libraries stall.
const MAX_ROUNDS = 40;

/** Fan out one small action per opted-in account; every scheduled call survives serverless freezes. */
export const scheduleDaily = internalAction({
  args: {},
  handler: async (ctx) => {
    const apiUrl = process.env.ALLEGRA_API_URL?.replace(/\/$/, '');
    const secret = process.env.CONVEX_SERVER_SECRET;
    if (!apiUrl || !secret) return { scheduled: 0, configured: false };
    const users: string[] = await ctx.runQuery(api.spotify.dailyAccounts, { secret });
    for (const userId of users.slice(0, 100)) await ctx.scheduler.runAfter(0, internal.spotifyCron.dailyUser, { userId, attempt: 0, round: 0 });
    return { scheduled: Math.min(users.length, 100), configured: true };
  }
});

export const dailyUser = internalAction({
  args: { userId: v.string(), attempt: v.number(), round: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const apiUrl = process.env.ALLEGRA_API_URL?.replace(/\/$/, '');
    const secret = process.env.CONVEX_SERVER_SECRET;
    if (!apiUrl || !secret) return null;
    try {
      const response = await fetch(`${apiUrl}/api/internal/spotify/daily`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-convex-server-secret': secret },
        body: JSON.stringify({ userId: args.userId }), signal: AbortSignal.timeout(120_000)
      });
      const round = args.round ?? 0;
      if (response.ok) {
        // The API stops each call at a time budget; `more` means playlists still have pages left.
        const body = await response.json().catch(() => null) as { data?: { more?: unknown } } | null;
        if (body?.data?.more === true && round < MAX_ROUNDS) await ctx.scheduler.runAfter(30_000, internal.spotifyCron.dailyUser, { userId: args.userId, attempt: 0, round: round + 1 });
        return null;
      }
      if ((response.status === 429 || response.status >= 500) && args.attempt < 2) {
        const retryAfter = Number(response.headers.get('retry-after'));
        const delay = Number.isFinite(retryAfter) ? Math.max(60_000, Math.min(3_600_000, retryAfter * 1000)) : 3_600_000;
        await ctx.scheduler.runAfter(delay, internal.spotifyCron.dailyUser, { userId: args.userId, attempt: args.attempt + 1, round: args.round ?? 0 });
      }
    } catch {
      if (args.attempt < 2) await ctx.scheduler.runAfter(3_600_000, internal.spotifyCron.dailyUser, { userId: args.userId, attempt: args.attempt + 1, round: args.round ?? 0 });
    }
    return null;
  }
});

/** Unconsumed OAuth states (user closed the Spotify tab) expire after ten minutes; drop them. */
export const sweepStates = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('spotifyOAuthStates').withIndex('by_expiresAt', q => q.lt('expiresAt', Date.now())).take(200);
    for (const row of rows) await ctx.db.delete('spotifyOAuthStates', row._id);
    return rows.length;
  }
});
