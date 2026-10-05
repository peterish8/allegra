import { v } from 'convex/values';
import { internalMutation, mutation, query, type MutationCtx } from './_generated/server';
import { requireSecret } from './profiles';
import { internal } from './_generated/api';

const returnTo = v.union(v.literal('web'), v.literal('mobile'));

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
    if (row) await ctx.db.patch('spotifyConnections', row._id, values);
    else await ctx.db.insert('spotifyConnections', values);
    return true;
  }
});

export const disconnect = mutation({
  args: { secret: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    await eraseSpotifyRows(ctx, args.userId);
    return null;
  }
});

export const disconnectRest = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => { await eraseSpotifyRows(ctx, args.userId); return null; }
});

async function eraseSpotifyRows(ctx: MutationCtx, userId: string): Promise<void> {
  const connection = await ctx.db.query('spotifyConnections').withIndex('by_userId', q => q.eq('userId', userId)).unique();
  if (connection) await ctx.db.delete('spotifyConnections', connection._id);
  const rows = await ctx.db.query('spotifyPlaylists').withIndex('by_userId_and_updatedAt', q => q.eq('userId', userId)).take(200);
  for (const row of rows) await ctx.db.delete('spotifyPlaylists', row._id);
  const states = await ctx.db.query('spotifyOAuthStates').withIndex('by_userId', q => q.eq('userId', userId)).take(200);
  for (const row of states) await ctx.db.delete('spotifyOAuthStates', row._id);
  const receipts = await ctx.db.query('spotifyReceipts').withIndex('by_userId_and_playlistId', q => q.eq('userId', userId)).take(200);
  for (const row of receipts) await ctx.db.delete('spotifyReceipts', row._id);
  if (rows.length === 200 || states.length === 200 || receipts.length === 200) await ctx.scheduler.runAfter(0, internal.spotify.disconnectRest, { userId });
}

export const setDaily = mutation({
  args: { secret: v.string(), userId: v.string(), enabled: v.boolean(), updatedAt: v.number() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const row = await ctx.db.query('spotifyConnections').withIndex('by_userId', q => q.eq('userId', args.userId)).unique();
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

export const savePlaylist = mutation({
  args: { secret: v.string(), userId: v.string(), playlistId: v.string(), name: v.string(), snapshotId: v.string(), total: v.number(), libraryId: v.string(), enabled: v.boolean(), updatedAt: v.number() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const row = await ctx.db.query('spotifyPlaylists').withIndex('by_userId_and_playlistId', q => q.eq('userId', args.userId).eq('playlistId', args.playlistId)).unique();
    const values = { name: args.name.slice(0, 120), snapshotId: args.snapshotId, total: args.total, libraryId: args.libraryId, enabled: args.enabled, updatedAt: args.updatedAt };
    if (row) await ctx.db.patch('spotifyPlaylists', row._id, values);
    else await ctx.db.insert('spotifyPlaylists', { ...values, userId: args.userId, playlistId: args.playlistId, offset: 0, scanSnapshotId: args.snapshotId, scanTotal: args.total, added: 0, skipped: 0, reviewNeeded: 0 });
    return true;
  }
});

export const claimPlaylist = mutation({
  args: { secret: v.string(), userId: v.string(), playlistId: v.string(), token: v.string(), now: v.number(), leaseMs: v.number() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
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
  args: { secret: v.string(), userId: v.string(), playlistId: v.string(), token: v.string(), receipts: v.array(v.object({ trackId: v.string(), libraryId: v.string() })), offset: v.number(), snapshotId: v.string(), total: v.number(), added: v.number(), skipped: v.number(), reviewNeeded: v.number(), complete: v.boolean(), now: v.number() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
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

export const dailyAccounts = query({
  args: { secret: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const rows = await ctx.db.query('spotifyConnections').withIndex('by_dailyEnabled_and_updatedAt', q => q.eq('dailyEnabled', true)).take(100);
    return rows.map(row => row.userId);
  }
});
