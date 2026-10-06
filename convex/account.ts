/**
 * A listener's right to leave, and to not be kept: erasing everything held about one profile,
 * listing what the profile row does not show (for the data export), and the daily sweep that
 * erases profiles nobody has used for the periods the privacy policy states
 * (packages/shared/legal.ts).
 *
 * `erase` and `extras` are called by the Express API with the shared server secret, like
 * convex/profiles.ts. The API has already checked who is asking; a userId is never taken from
 * a browser here.
 */
import { Presence } from '@convex-dev/presence';
import { v } from 'convex/values';

import { ACCOUNT_RETENTION_DAYS, ACTIVE_TOUCH_DAYS, GUEST_RETENTION_DAYS } from '../packages/shared/legal';
import { components, internal } from './_generated/api';
import { internalMutation, mutation, query, type MutationCtx } from './_generated/server';
import { leaveBlend } from './blends';
import { roomOf } from './connect';
import { requireSecret } from './profiles';

const presence = new Presence(components.presence);

/** Rows removed per table in one transaction. A larger library continues in the next one. */
const BATCH = 200;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Two profiles at most per transaction keeps large libraries within the write budget. */
const SWEEP_GUESTS = 1;
const SWEEP_ACCOUNTS = 1;

/** Deletes an uploaded playlist cover. A key that is not a stored file is skipped. */
async function deleteCover(ctx: MutationCtx, coverKey: string | undefined): Promise<void> {
  if (!coverKey) return;
  const id = ctx.db.system.normalizeId('_storage', coverKey);
  if (id && (await ctx.db.system.get('_storage', id))) await ctx.storage.delete(id);
}

/**
 * Removes up to BATCH rows per table of everything keyed to this listener: the profile, the
 * library rows and their covers, share links, devices and their presence, the player session,
 * and for a signed-in account the Convex Auth identity. True when rows may remain.
 *
 * The profile and identity go in the first pass, so a still-valid token cannot recreate the
 * profile while a large library finishes erasing. Credential rows follow in bounded passes.
 */
async function eraseSome(ctx: MutationCtx, userId: string): Promise<boolean> {
  let more = false;

  const profile = await ctx.db
    .query('profiles')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .unique();
  if (profile) {
    for (const library of profile.libraries) await deleteCover(ctx, library.coverKey);
    await ctx.db.delete('profiles', profile._id);
  }

  const authUserId = ctx.db.normalizeId('users', userId);
  if (authUserId) {
    // Invalidate identity before scheduling any continuation. Leaving it until the last pass
    // lets the API recreate the deleted profile from an unexpired JWT in the meantime.
    if (await ctx.db.get('users', authUserId)) await ctx.db.delete('users', authUserId);
    const sessions = await ctx.db
      .query('authSessions')
      .withIndex('userId', (q) => q.eq('userId', authUserId))
      .take(BATCH);
    let tokenBudget = BATCH;
    for (const session of sessions) {
      if (tokenBudget === 0) { more = true; break; }
      const limit = tokenBudget;
      const tokens = await ctx.db
        .query('authRefreshTokens')
        .withIndex('sessionId', (q) => q.eq('sessionId', session._id))
        .take(limit);
      for (const token of tokens) await ctx.db.delete('authRefreshTokens', token._id);
      tokenBudget -= tokens.length;
      if (tokens.length === limit) more = true;
      else await ctx.db.delete('authSessions', session._id);
    }
    more ||= sessions.length === BATCH;
  }

  const likes = await ctx.db
    .query('libraryLikes')
    .withIndex('by_userId_and_ref', (q) => q.eq('userId', userId))
    .take(BATCH);
  for (const row of likes) await ctx.db.delete('libraryLikes', row._id);
  more ||= likes.length === BATCH;

  const playlists = await ctx.db
    .query('libraryPlaylists')
    .withIndex('by_userId_and_playlistId', (q) => q.eq('userId', userId))
    .take(BATCH);
  for (const row of playlists) {
    await deleteCover(ctx, row.coverKey);
    await ctx.db.delete('libraryPlaylists', row._id);
  }
  more ||= playlists.length === BATCH;

  const items = await ctx.db
    .query('libraryItems')
    .withIndex('by_userId_and_playlistId_and_ref', (q) => q.eq('userId', userId))
    .take(BATCH);
  for (const row of items) await ctx.db.delete('libraryItems', row._id);
  more ||= items.length === BATCH;

  const state = await ctx.db
    .query('libraryState')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .take(BATCH);
  for (const row of state) await ctx.db.delete('libraryState', row._id);

  const tasteSongs = await ctx.db
    .query('tasteSongs')
    .withIndex('by_userId_and_score', (q) => q.eq('userId', userId))
    .take(BATCH);
  for (const row of tasteSongs) await ctx.db.delete('tasteSongs', row._id);
  more ||= tasteSongs.length === BATCH;
  if (tasteSongs.length < BATCH) {
    const tasteMeta = await ctx.db
      .query('tasteMeta')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .unique();
    if (tasteMeta) await ctx.db.delete('tasteMeta', tasteMeta._id);
  }

  // Blends: leave each one under the usual rules (hand-over, or delete when last out).
  const memberships = await ctx.db
    .query('blendMembers')
    .withIndex('by_userId_and_joinedAt', (q) => q.eq('userId', userId))
    .take(BATCH);
  for (const row of memberships) await leaveBlend(ctx, row.blendId, userId);
  more ||= memberships.length === BATCH;

  const blendOperations = await ctx.db.query('blendOperations')
    .withIndex('by_userId_and_operationId', (q) => q.eq('userId', userId))
    .take(BATCH);
  for (const row of blendOperations) await ctx.db.delete('blendOperations', row._id);
  more ||= blendOperations.length === BATCH;

  // Spotify authorization, playlist scan checkpoints and source-song receipts are personal data.
  // Remove the credential immediately; the bounded account erase passes clean any large receipt set.
  const spotifyConnection = await ctx.db.query('spotifyConnections')
    .withIndex('by_userId', (q) => q.eq('userId', userId)).unique();
  if (spotifyConnection) await ctx.db.delete('spotifyConnections', spotifyConnection._id);
  const spotifyStates = await ctx.db.query('spotifyOAuthStates')
    .withIndex('by_userId', (q) => q.eq('userId', userId)).take(BATCH);
  for (const row of spotifyStates) await ctx.db.delete('spotifyOAuthStates', row._id);
  more ||= spotifyStates.length === BATCH;
  const spotifyPlaylists = await ctx.db.query('spotifyPlaylists')
    .withIndex('by_userId_and_updatedAt', (q) => q.eq('userId', userId)).take(BATCH);
  for (const row of spotifyPlaylists) await ctx.db.delete('spotifyPlaylists', row._id);
  more ||= spotifyPlaylists.length === BATCH;
  const spotifyReceipts = await ctx.db.query('spotifyReceipts')
    .withIndex('by_userId_and_playlistId', (q) => q.eq('userId', userId)).take(BATCH);
  for (const row of spotifyReceipts) await ctx.db.delete('spotifyReceipts', row._id);
  more ||= spotifyReceipts.length === BATCH;

  const shares = await ctx.db
    .query('shares')
    .withIndex('by_owner_library', (q) => q.eq('ownerId', userId))
    .take(BATCH);
  for (const row of shares) await ctx.db.delete('shares', row._id);
  more ||= shares.length === BATCH;

  // LuvLink sessions are short-lived, but account erasure also removes room membership,
  // host-owned invites and queue attribution immediately. Other participants keep their room.
  const luvLinkMembers = await ctx.db.query('luvLinkMembers')
    .withIndex('by_userId_and_joinedAtMs', (q) => q.eq('userId', userId))
    .take(BATCH);
  for (const membership of luvLinkMembers) {
    const room = await ctx.db.get(membership.roomId);
    if (room) {
      const picks = await ctx.db.query('luvLinkRecommendations').withIndex('by_roomId', (q) => q.eq('roomId', room._id)).unique();
      if (picks) await ctx.db.delete(picks._id);
      if (membership.role === 'host') {
        await ctx.db.patch(room._id, { status: 'closed', closedAtMs: Date.now(), revision: room.revision + 1 });
        const invites = await ctx.db.query('luvLinkInvites')
          .withIndex('by_roomId_and_generation', (q) => q.eq('roomId', room._id)).take(8);
        for (const invite of invites) await ctx.db.patch(invite._id, { revokedAtMs: Date.now() });
      } else {
        await ctx.db.patch(room._id, { memberCount: Math.max(1, room.memberCount - 1), revision: room.revision + 1, suggestionRevision: room.suggestionRevision + 1 });
        if (room.leaderUserId === userId) {
          const leaderEpoch = room.leaderEpoch + 1;
          await ctx.db.patch(room._id, { leaderUserId: room.hostUserId, leaderEpoch, handoffFromUserId: undefined });
          const playback = await ctx.db.query('luvLinkPlayback').withIndex('by_roomId', (q) => q.eq('roomId', room._id)).unique();
          if (playback) {
            const now = Date.now();
            const positionSec = playback.song ? Math.max(0, Math.min(playback.song.duration, playback.positionSec + (playback.playing ? Math.max(0, now - playback.effectiveAtMs) / 1000 * playback.playbackRate : 0))) : 0;
            await ctx.db.patch(playback._id, { leaderUserId: room.hostUserId, leaderEpoch, sequence: playback.sequence + 1, playing: false, positionSec, serverAtMs: now, effectiveAtMs: now });
          }
        }
      }
    }
    await ctx.db.delete(membership._id);
  }
  more ||= luvLinkMembers.length === BATCH;

  const luvLinkReceipts = await ctx.db.query('luvLinkReceipts')
    .withIndex('by_userId', (q) => q.eq('userId', userId)).take(BATCH);
  for (const row of luvLinkReceipts) await ctx.db.delete(row._id);
  more ||= luvLinkReceipts.length === BATCH;
  const luvLinkReady = await ctx.db.query('luvLinkReady')
    .withIndex('by_userId', (q) => q.eq('userId', userId)).take(BATCH);
  for (const row of luvLinkReady) await ctx.db.delete(row._id);
  more ||= luvLinkReady.length === BATCH;

  const luvLinkQueue = await ctx.db.query('luvLinkQueue')
    .withIndex('by_addedByUserId', (q) => q.eq('addedByUserId', userId))
    .take(BATCH);
  const changedRooms = new Set<string>();
  for (const entry of luvLinkQueue) {
    await ctx.db.delete(entry._id);
    changedRooms.add(entry.roomId);
  }
  for (const id of changedRooms) {
    const roomId = ctx.db.normalizeId('luvLinkRooms', id);
    if (!roomId) continue;
    const room = await ctx.db.get(roomId);
    if (room) {
      await ctx.db.patch(roomId, { queueRevision: room.queueRevision + 1, suggestionRevision: room.suggestionRevision + 1 });
      const picks = await ctx.db.query('luvLinkRecommendations').withIndex('by_roomId', (q) => q.eq('roomId', roomId)).unique();
      if (picks) await ctx.db.delete(picks._id);
    }
  }
  more ||= luvLinkQueue.length === BATCH;

  const devices = await ctx.db
    .query('devices')
    .withIndex('by_userId_and_createdAt', (q) => q.eq('userId', userId))
    .take(BATCH);
  for (const device of devices) {
    await presence.removeRoomUser(ctx, roomOf(userId), device.deviceId);
    await ctx.db.delete('devices', device._id);
  }
  more ||= devices.length === BATCH;

  const ownership = await ctx.db
    .query('connectOwnership')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .take(BATCH);
  for (const row of ownership) await ctx.db.delete('connectOwnership', row._id);

  const players = await ctx.db
    .query('playerState')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .take(BATCH);
  for (const row of players) await ctx.db.delete('playerState', row._id);

  const commands = await ctx.db
    .query('connectCommands')
    .withIndex('by_userId_and_status', (q) => q.eq('userId', userId))
    .take(BATCH);
  for (const row of commands) await ctx.db.delete('connectCommands', row._id);
  more ||= commands.length === BATCH;

  // Auth foreign keys remain usable after identity invalidation; clean credentials by that id.
  if (authUserId) {
    const accounts = await ctx.db
      .query('authAccounts')
      .withIndex('userIdAndProvider', (q) => q.eq('userId', authUserId))
      .take(BATCH);
    let codeBudget = BATCH;
    for (const account of accounts) {
      if (codeBudget === 0) { more = true; break; }
      const limit = codeBudget;
      const codes = await ctx.db
        .query('authVerificationCodes')
        .withIndex('accountId', (q) => q.eq('accountId', account._id))
        .take(limit);
      for (const code of codes) await ctx.db.delete('authVerificationCodes', code._id);
      codeBudget -= codes.length;
      if (codes.length === limit) more = true;
      else await ctx.db.delete('authAccounts', account._id);
    }
    more ||= accounts.length === BATCH;
  }

  return more;
}

async function eraseAndContinue(ctx: MutationCtx, userId: string): Promise<void> {
  if (await eraseSome(ctx, userId)) await ctx.scheduler.runAfter(0, internal.account.eraseRest, { userId });
}

/** Erases a listener. Safe to repeat: a second call finds nothing left. */
export const erase = mutation({
  args: { secret: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    await eraseAndContinue(ctx, args.userId);
    return null;
  }
});

/** The next pass of an erase too large for one transaction. */
export const eraseRest = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    await eraseAndContinue(ctx, args.userId);
    return null;
  }
});

/** What the profile row does not hold, for the data export: live share links and registered devices. */
export const extras = query({
  args: { secret: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const [shares, devices, luvLinkMemberships] = await Promise.all([
      ctx.db
        .query('shares')
        .withIndex('by_owner_library', (q) => q.eq('ownerId', args.userId))
        .take(101),
      ctx.db
        .query('devices')
        .withIndex('by_userId_and_createdAt', (q) => q.eq('userId', args.userId))
        .take(51),
      ctx.db.query('luvLinkMembers')
        .withIndex('by_userId_and_joinedAtMs', (q) => q.eq('userId', args.userId))
        .take(101)
    ]);
    return {
      complete: shares.length <= 100 && devices.length <= 50 && luvLinkMemberships.length <= 100,
      shares: shares.slice(0, 100).map((share) => ({ code: share.code, libraryId: share.libraryId, createdAt: share.createdAt })),
      devices: devices.slice(0, 50).map((device) => ({ name: device.name, kind: device.kind, appVersion: device.appVersion, createdAt: device.createdAt })),
      luvLinks: luvLinkMemberships.slice(0, 100).map((membership) => ({ roomId: membership.roomId, role: membership.role, joinedAtMs: membership.joinedAtMs }))
    };
  }
});

/**
 * The daily retention sweep. Adds the API's maximum ACTIVE_TOUCH_DAYS interval to each promised
 * retention period, so read-only listeners are not erased early. A profile with no `lastActiveAt`
 * (written before the field existed) is left alone: run `backfillLastActive` once after deploying.
 */
export const sweepInactive = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const inactive = (isGuest: boolean, days: number, limit: number) =>
      ctx.db
        .query('profiles')
        .withIndex('by_isGuest_and_lastActiveAt', (q) => q.eq('isGuest', isGuest).gt('lastActiveAt', 0).lt('lastActiveAt', now - (days + ACTIVE_TOUCH_DAYS) * DAY_MS))
        .take(limit);
    const guests = await inactive(true, GUEST_RETENTION_DAYS, SWEEP_GUESTS);
    const accounts = await inactive(false, ACCOUNT_RETENTION_DAYS, SWEEP_ACCOUNTS);
    for (const profile of [...guests, ...accounts]) await eraseAndContinue(ctx, profile.userId);
    if (guests.length === SWEEP_GUESTS || accounts.length === SWEEP_ACCOUNTS) {
      await ctx.scheduler.runAfter(0, internal.account.sweepInactive, {});
    }
    return { guests: guests.length, accounts: accounts.length };
  }
});

/**
 * One-off, after deploying the retention sweep: gives every profile written before `lastActiveAt`
 * existed a value from what it already records (its newest play, its taste, or when it was made),
 * so the sweep can see it. Walks the table in pages, each its own transaction.
 *
 *   npx convex run account:backfillLastActive
 */
export const backfillLastActive = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query('profiles').paginate({ numItems: 100, cursor: args.cursor ?? null });
    for (const row of page.page) {
      if (row.lastActiveAt !== undefined) continue;
      const times = [row.createdAt, row.taste?.updatedAt, row.recentlyPlayed[0]?.playedAt]
        .map((value) => (value ? Date.parse(value) : Number.NaN))
        .filter((time) => Number.isFinite(time) && time > 0);
      await ctx.db.patch('profiles', row._id, { lastActiveAt: times.length > 0 ? Math.max(...times) : Date.now() });
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.account.backfillLastActive, { cursor: page.continueCursor });
    return null;
  }
});
