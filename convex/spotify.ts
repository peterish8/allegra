import { v } from 'convex/values';
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { requireSecret } from './profiles';
import { internal } from './_generated/api';

const returnTo = v.union(v.literal('web'), v.literal('mobile'));
/** Optional so an API built before generations existed keeps working during a deploy; when sent it must match. */
const generationArg = v.optional(v.number());

/**
 * The connection a write may act for. Disconnect leaves a tombstone with an empty token and a bumped generation,
 * and every reconnect bumps it too, so a step that started under an older connection cannot write after either.
 */
async function liveConnection(ctx: QueryCtx | MutationCtx, userId: string, generation: number | undefined) {
  const row = await ctx.db.query('spotifyConnections').withIndex('by_userId', q => q.eq('userId', userId)).unique();
  if (!row || row.encryptedRefreshToken === '') return null;
  if (generation !== undefined && (row.generation ?? 0) !== generation) return null;
  return row;
}

export const saveState = mutation({
  args: { secret: v.string(), stateHash: v.string(), userId: v.string(), encryptedVerifier: v.string(), returnTo, expiresAt: v.number() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const old = await ctx.db.query('spotifyOAuthStates').withIndex('by_stateHash', q => q.eq('stateHash', args.stateHash)).unique();
    if (old) await ctx.db.delete('spotifyOAuthStates', old._id);
    await ctx.db.insert('spotifyOAuthStates', { stateHash: args.stateHash, userId: args.userId, encryptedVerifier: args.encryptedVerifier, returnTo: args.returnTo, expiresAt: args.expiresAt });
    return true;
  }
});

export const consumeState = mutation({
  args: { secret: v.string(), stateHash: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const row = await ctx.db.query('spotifyOAuthStates').withIndex('by_stateHash', q => q.eq('stateHash', args.stateHash)).unique();
    if (!row) return null;
    await ctx.db.delete('spotifyOAuthStates', row._id);
    return row.expiresAt > args.now ? { userId: row.userId, encryptedVerifier: row.encryptedVerifier, returnTo: row.returnTo } : null;
  }
});

export const connection = query({
  args: { secret: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const row = await ctx.db.query('spotifyConnections').withIndex('by_userId', q => q.eq('userId', args.userId)).unique();
    return row ? { ...row, _id: undefined, _creationTime: undefined } : null;
  }
});

export const saveConnection = mutation({
  args: { secret: v.string(), userId: v.string(), spotifyUserId: v.string(), encryptedRefreshToken: v.string(), encryptedAccessToken: v.optional(v.string()), accessExpiresAt: v.optional(v.number()), dailyEnabled: v.boolean(), connectedAt: v.number(), updatedAt: v.number() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const row = await ctx.db.query('spotifyConnections').withIndex('by_userId', q => q.eq('userId', args.userId)).unique();
    const { secret: _secret, ...values } = args;
    if (row) await ctx.db.patch('spotifyConnections', row._id, { ...values, generation: (row.generation ?? 0) + 1 });
    // Account erase deletes the row outright; starting from the clock rather than 1 keeps a step that began
    // before the erase from matching the new connection.
    else await ctx.db.insert('spotifyConnections', { ...values, generation: Date.now() });
    return true;
  }
});

/** A refresh may not resurrect a disconnected or newly reconnected account. */
export const refreshConnection = mutation({
  args: { secret: v.string(), userId: v.string(), expectedGeneration: v.number(), encryptedRefreshToken: v.string(), encryptedAccessToken: v.string(), accessExpiresAt: v.number(), updatedAt: v.number() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const row = await ctx.db.query('spotifyConnections').withIndex('by_userId', q => q.eq('userId', args.userId)).unique();
    if (!row || (row.generation ?? 0) !== args.expectedGeneration || row.encryptedRefreshToken === '') return false;
    await ctx.db.patch('spotifyConnections', row._id, { encryptedRefreshToken: args.encryptedRefreshToken, encryptedAccessToken: args.encryptedAccessToken, accessExpiresAt: args.accessExpiresAt, updatedAt: args.updatedAt });
    return true;
  }
});

export const disconnect = mutation({
  args: { secret: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const row = await ctx.db.query('spotifyConnections').withIndex('by_userId', q => q.eq('userId', args.userId)).unique();
    const generation = (row?.generation ?? 0) + 1;
    const now = Date.now();
    // The tombstone keeps only the account key and generation: no Spotify identity, token or schedule survives.
    if (row) await ctx.db.patch('spotifyConnections', row._id, { spotifyUserId: '', encryptedRefreshToken: '', encryptedAccessToken: undefined, accessExpiresAt: undefined, dailyEnabled: false, generation, connectedAt: now, updatedAt: now });
    else await ctx.db.insert('spotifyConnections', { userId: args.userId, spotifyUserId: '', encryptedRefreshToken: '', dailyEnabled: false, connectedAt: now, updatedAt: now, generation });
    await eraseSpotifyRows(ctx, args.userId, generation);
    return null;
  }
});

export const disconnectRest = internalMutation({
  args: { userId: v.string(), generation: v.number() },
  handler: async (ctx, args) => { await eraseSpotifyRows(ctx, args.userId, args.generation); return null; }
});

async function eraseSpotifyRows(ctx: MutationCtx, userId: string, generation: number): Promise<void> {
  const connection = await ctx.db.query('spotifyConnections').withIndex('by_userId', q => q.eq('userId', userId)).unique();
  if (!connection || connection.generation !== generation || connection.encryptedRefreshToken !== '') return;
  const rows = await ctx.db.query('spotifyPlaylists').withIndex('by_userId_and_updatedAt', q => q.eq('userId', userId)).take(200);
  for (const row of rows) await ctx.db.delete('spotifyPlaylists', row._id);
  const states = await ctx.db.query('spotifyOAuthStates').withIndex('by_userId', q => q.eq('userId', userId)).take(200);
  for (const row of states) await ctx.db.delete('spotifyOAuthStates', row._id);
  const receipts = await ctx.db.query('spotifyReceipts').withIndex('by_userId_and_playlistId', q => q.eq('userId', userId)).take(200);
  for (const row of receipts) await ctx.db.delete('spotifyReceipts', row._id);
  if (rows.length === 200 || states.length === 200 || receipts.length === 200) await ctx.scheduler.runAfter(0, internal.spotify.disconnectRest, { userId, generation });
  // Retain the empty generation marker so an old in-flight refresh cannot match a later connection.
}

export const setDaily = mutation({
  args: { secret: v.string(), userId: v.string(), enabled: v.boolean(), updatedAt: v.number() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    // A disconnected tombstone cannot be opted back in; it needs a new connection first.
    const row = await liveConnection(ctx, args.userId, undefined);
    if (!row) return false;
    await ctx.db.patch('spotifyConnections', row._id, { dailyEnabled: args.enabled, updatedAt: args.updatedAt });
    return true;
  }
});

export const listPlaylists = query({
  args: { secret: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    return await ctx.db.query('spotifyPlaylists').withIndex('by_userId_and_updatedAt', q => q.eq('userId', args.userId)).order('desc').take(100);
  }
});

/** Enabled playlists the run starting at `runStartedAt` has not reached yet, least recently checked first. */
export const dailyPlaylists = query({
  args: { secret: v.string(), userId: v.string(), runStartedAt: v.number(), limit: v.number() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    return await ctx.db.query('spotifyPlaylists')
      .withIndex('by_userId_and_enabled_and_dailyCheckedAt', q => q.eq('userId', args.userId).eq('enabled', true).lt('dailyCheckedAt', args.runStartedAt))
      .take(Math.max(1, Math.min(args.limit, 10)));
  }
});

/** Idempotent: marking the same run twice is a no-op, and a fenced-off connection marks nothing. */
export const markDailyChecked = mutation({
  args: { secret: v.string(), userId: v.string(), playlistId: v.string(), runStartedAt: v.number(), generation: generationArg },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    if (!(await liveConnection(ctx, args.userId, args.generation))) return false;
    const row = await ctx.db.query('spotifyPlaylists').withIndex('by_userId_and_playlistId', q => q.eq('userId', args.userId).eq('playlistId', args.playlistId)).unique();
    if (!row) return false;
    if ((row.dailyCheckedAt ?? -1) < args.runStartedAt) await ctx.db.patch('spotifyPlaylists', row._id, { dailyCheckedAt: args.runStartedAt });
    return true;
  }
});

export const savePlaylist = mutation({
  args: { secret: v.string(), userId: v.string(), playlistId: v.string(), name: v.string(), snapshotId: v.string(), total: v.number(), libraryId: v.string(), enabled: v.boolean(), updatedAt: v.number(), generation: generationArg },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    // Without this a step that began before disconnect would recreate the playlist name and selection afterwards.
    if (!(await liveConnection(ctx, args.userId, args.generation))) return false;
    const row = await ctx.db.query('spotifyPlaylists').withIndex('by_userId_and_playlistId', q => q.eq('userId', args.userId).eq('playlistId', args.playlistId)).unique();
    const values = { name: args.name.slice(0, 120), snapshotId: args.snapshotId, total: args.total, libraryId: args.libraryId, enabled: args.enabled, updatedAt: args.updatedAt };
    if (row) await ctx.db.patch('spotifyPlaylists', row._id, values);
    else await ctx.db.insert('spotifyPlaylists', { ...values, userId: args.userId, playlistId: args.playlistId, offset: 0, scanSnapshotId: args.snapshotId, scanTotal: args.total, added: 0, skipped: 0, reviewNeeded: 0 });
    return true;
  }
});

export const claimPlaylist = mutation({
  args: { secret: v.string(), userId: v.string(), playlistId: v.string(), token: v.string(), now: v.number(), leaseMs: v.number(), generation: generationArg },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    if (!(await liveConnection(ctx, args.userId, args.generation))) return null;
    const row = await ctx.db.query('spotifyPlaylists').withIndex('by_userId_and_playlistId', q => q.eq('userId', args.userId).eq('playlistId', args.playlistId)).unique();
    if (!row || (row.leaseUntil ?? 0) > args.now) return null;
    const leaseUntil = args.now + Math.max(10_000, Math.min(args.leaseMs, 120_000));
    await ctx.db.patch('spotifyPlaylists', row._id, { leaseToken: args.token, leaseUntil });
    return { ...row, leaseToken: args.token, leaseUntil };
  }
});

export const releasePlaylist = mutation({
  args: { secret: v.string(), userId: v.string(), playlistId: v.string(), token: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const row = await ctx.db.query('spotifyPlaylists').withIndex('by_userId_and_playlistId', q => q.eq('userId', args.userId).eq('playlistId', args.playlistId)).unique();
    if (row?.leaseToken === args.token) await ctx.db.patch('spotifyPlaylists', row._id, { leaseToken: undefined, leaseUntil: undefined });
    return null;
  }
});

export const receipts = query({
  args: { secret: v.string(), userId: v.string(), playlistId: v.string(), trackIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const found: string[] = [];
    for (const trackId of args.trackIds.slice(0, 50)) {
      if (await ctx.db.query('spotifyReceipts').withIndex('by_userId_and_playlistId_and_spotifyTrackId', q => q.eq('userId', args.userId).eq('playlistId', args.playlistId).eq('spotifyTrackId', trackId)).unique()) found.push(trackId);
    }
    return found;
  }
});

export const checkpoint = mutation({
  args: { secret: v.string(), userId: v.string(), playlistId: v.string(), token: v.string(), receipts: v.array(v.object({ trackId: v.string(), libraryId: v.string() })), offset: v.number(), snapshotId: v.string(), total: v.number(), added: v.number(), skipped: v.number(), reviewNeeded: v.number(), complete: v.boolean(), now: v.number(), generation: generationArg },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    if (!(await liveConnection(ctx, args.userId, args.generation))) return false;
    const playlist = await ctx.db.query('spotifyPlaylists').withIndex('by_userId_and_playlistId', q => q.eq('userId', args.userId).eq('playlistId', args.playlistId)).unique();
    if (!playlist || playlist.leaseToken !== args.token || (playlist.leaseUntil ?? 0) <= args.now) return false;
    for (const receipt of args.receipts.slice(0, 50)) {
      const exists = await ctx.db.query('spotifyReceipts').withIndex('by_userId_and_playlistId_and_spotifyTrackId', q => q.eq('userId', args.userId).eq('playlistId', args.playlistId).eq('spotifyTrackId', receipt.trackId)).unique();
      if (!exists) await ctx.db.insert('spotifyReceipts', { userId: args.userId, playlistId: args.playlistId, spotifyTrackId: receipt.trackId, libraryId: receipt.libraryId, savedAt: args.now });
    }
    await ctx.db.patch('spotifyPlaylists', playlist._id, {
      offset: args.complete ? 0 : Math.max(0, args.offset), scanSnapshotId: args.snapshotId, scanTotal: args.total,
      added: args.complete ? 0 : Math.max(0, args.added), skipped: args.complete ? 0 : Math.max(0, args.skipped), reviewNeeded: args.complete ? 0 : Math.max(0, args.reviewNeeded),
      ...(args.complete ? { lastSyncedAt: args.now } : {}), updatedAt: args.now, leaseUntil: undefined, leaseToken: undefined
    });
    return true;
  }
});

/** Only the Convex scheduler reads this; tombstones are never daily-enabled, so they never appear. */
export const dailyAccounts = internalQuery({
  args: { after: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query('spotifyConnections').withIndex('by_dailyEnabled_and_userId', q => {
      const enabled = q.eq('dailyEnabled', true);
      return args.after ? enabled.gt('userId', args.after) : enabled;
    }).take(101);
    const page = rows.slice(0, 100);
    return { users: page.map(row => row.userId), next: rows.length > 100 ? page[page.length - 1]!.userId : null };
  }
});
