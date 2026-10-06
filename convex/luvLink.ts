import { getAuthUserId } from '@convex-dev/auth/server';
import { Presence } from '@convex-dev/presence';
import { RateLimiter } from '@convex-dev/rate-limiter';
import { ConvexError, v, type Infer } from 'convex/values';

import { buildBlend } from '../packages/shared/blendBuild';
import { currentWeight } from '../packages/shared/blendDecay';
import { identityKey } from '../packages/shared/identity';
import { memberTaste } from '../packages/shared/blendTaste';
import type { ArtistFactsMap, MemberTaste, TasteItem } from '../packages/shared/blendTypes';
import { parseSongRef, type SongSnapshot } from '../packages/shared/songRef';
import { components, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { assertSongSnapshot, songSnapshot } from './schema';

const limiter = new RateLimiter(components.rateLimiter, {
  roomCreate: { kind: 'fixed window', rate: 3, period: 60_000 },
  roomJoin: { kind: 'fixed window', rate: 12, period: 60_000 },
  queueWrite: { kind: 'fixed window', rate: 20, period: 10_000 },
  playbackWrite: { kind: 'fixed window', rate: 15, period: 10_000 },
  inviteWrite: { kind: 'fixed window', rate: 6, period: 60_000 },
  clockSample: { kind: 'fixed window', rate: 8, period: 60_000 },
  suggestionBuild: { kind: 'fixed window', rate: 1, period: 60_000 }
});
const presence = new Presence(components.presence);
const PRESENCE_HEARTBEAT_MS = 60_000;

const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const INVITE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_MEMBERS = 8;
const MAX_QUEUE = 100;
const MAX_SUGGESTION_ROWS = 25;
const SUGGESTION_TTL_MS = 5 * 60_000;
const RECEIPT_TTL_MS = 10 * 60 * 1000;
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const roomMode = v.union(v.literal('listen'), v.literal('speaker'));
const roomRole = v.union(v.literal('host'), v.literal('member'));
const roomId = v.id('luvLinkRooms');
const queueEntry = v.object({
  entryId: v.string(), roomId: v.string(), order: v.number(), song: songSnapshot,
  addedByUserId: v.string(), addedByName: v.string(), createdAtMs: v.number()
});
const playbackAnchor = v.object({
  roomId: v.string(), leaderUserId: v.string(), leaderEpoch: v.number(), sequence: v.number(), trackEpoch: v.number(),
  queueEntryId: v.union(v.string(), v.null()), intent: v.union(v.literal('control'), v.literal('natural_end'), v.literal('checkpoint')),
  intentByUserId: v.string(), outputAppliedSequence: v.number(), barrierPending: v.boolean(), song: v.union(songSnapshot, v.null()), positionSec: v.number(),
  serverAtMs: v.number(), playing: v.boolean(), effectiveAtMs: v.number(), playbackRate: v.number()
});
const roomSnapshot = v.object({
  roomId: v.string(), hostUserId: v.string(), leaderUserId: v.string(), leaderEpoch: v.number(), mode: roomMode, transport: v.literal('convex-v1'), protocolVersion: v.literal(1),
  revision: v.number(), expiresAtMs: v.number(), memberCount: v.number(), handoffFromUserId: v.union(v.string(), v.null())
});
const memberSnapshot = v.object({
  userId: v.string(), displayName: v.string(), role: roomRole, mode: roomMode, canControl: v.boolean(), canSuggest: v.boolean(), joinedAtMs: v.number()
});
const queueSnapshot = v.object({ revision: v.number(), entries: v.array(queueEntry) });
const commandReceipt = v.object({ revision: v.number(), entryId: v.optional(v.string()) });
const groupPick = v.object({ song: songSnapshot, forUserIds: v.array(v.string()), kind: v.union(v.literal('shared'), v.literal('pick')) });
const groupPicks = v.object({ revision: v.number(), picks: v.array(groupPick) });

function fail(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

async function requireUser(ctx: QueryCtx | MutationCtx): Promise<string> {
  const id = await getAuthUserId(ctx);
  if (!id) fail('unauthenticated', 'Sign in to use LuvLink.');
  return String(id);
}

async function limit(ctx: MutationCtx, name: 'roomCreate' | 'roomJoin' | 'queueWrite' | 'playbackWrite' | 'inviteWrite' | 'clockSample' | 'suggestionBuild', userId: string): Promise<void> {
  const result = await limiter.limit(ctx, name, { key: userId });
  if (!result.ok) fail('rate_limited', 'Too many LuvLink requests. Try again shortly.');
}

async function finishBarrier(ctx: MutationCtx, roomIdValue: Id<'luvLinkRooms'>, trackEpoch: number): Promise<boolean> {
  const barrier = await ctx.db.query('luvLinkBarriers').withIndex('by_roomId', q => q.eq('roomId', roomIdValue)).unique();
  if (!barrier || barrier.status !== 'pending' || barrier.trackEpoch !== trackEpoch) return false;
  const room = await ctx.db.get(roomIdValue);
  const anchor = await ctx.db.query('luvLinkPlayback').withIndex('by_roomId', q => q.eq('roomId', roomIdValue)).unique();
  if (!room || room.status !== 'active' || room.leaderEpoch !== barrier.leaderEpoch || !anchor || anchor.trackEpoch !== trackEpoch || anchor.sequence !== barrier.sequence) {
    await ctx.db.patch(barrier._id, { status: 'cancelled' });
    return false;
  }
  const now = Date.now();
  const value = {
    roomId: anchor.roomId,
    sequence: anchor.sequence + 1,
    trackEpoch: anchor.trackEpoch,
    leaderUserId: room.leaderUserId,
    leaderEpoch: room.leaderEpoch,
    positionSec: projectCurrent(anchor, now),
    serverAtMs: now,
    playing: true,
    effectiveAtMs: now + 500,
    playbackRate: barrier.playbackRate,
    song: barrier.song,
    queueEntryId: barrier.queueEntryId,
    intent: barrier.intent, intentByUserId: barrier.intentByUserId,
    outputAppliedSequence: anchor.outputAppliedSequence, barrierPending: false
  };
  await ctx.db.replace(anchor._id, value);
  await ctx.db.patch(barrier._id, { status: 'completed' });
  return true;
}

async function memberFor(ctx: QueryCtx | MutationCtx, id: Id<'luvLinkRooms'>, userId: string): Promise<Doc<'luvLinkMembers'> | null> {
  return await ctx.db.query('luvLinkMembers').withIndex('by_roomId_and_userId', q => q.eq('roomId', id).eq('userId', userId)).unique();
}

async function activeRoom(ctx: QueryCtx | MutationCtx, id: Id<'luvLinkRooms'>): Promise<Doc<'luvLinkRooms'> | null> {
  const room = await ctx.db.get(id);
  if (!room || room.status !== 'active' || room.expiresAtMs <= Date.now()) return null;
  return room;
}

async function requireMember(ctx: QueryCtx | MutationCtx, id: Id<'luvLinkRooms'>, userId: string): Promise<{ room: Doc<'luvLinkRooms'>; member: Doc<'luvLinkMembers'> }> {
  const room = await activeRoom(ctx, id);
  if (!room) fail('room_unavailable', 'This LuvLink has ended or expired.');
  const member = await memberFor(ctx, id, userId);
  if (!member) fail('not_a_member', 'Join this LuvLink to continue.');
  return { room, member };
}

async function invalidatePicks(ctx: MutationCtx, room: Doc<'luvLinkRooms'>): Promise<void> {
  const cache = await ctx.db.query('luvLinkRecommendations').withIndex('by_roomId', q => q.eq('roomId', room._id)).unique();
  if (cache) await ctx.db.delete(cache._id);
  await ctx.db.patch(room._id, { suggestionRevision: room.suggestionRevision + 1 });
}

function personalizationEnabled(profile: Doc<'profiles'> | null): boolean {
  const settings = profile?.settings;
  return !(typeof settings === 'object' && settings !== null && 'personalization' in settings && settings.personalization === false);
}

async function recommendationMembers(ctx: QueryCtx | MutationCtx, roomIdValue: Id<'luvLinkRooms'>): Promise<{ members: Doc<'luvLinkMembers'>[]; allowed: Set<string> }> {
  const members = await ctx.db.query('luvLinkMembers').withIndex('by_roomId_and_joinedAtMs', q => q.eq('roomId', roomIdValue)).take(MAX_MEMBERS);
  const allowed = new Set<string>();
  for (const member of members) {
    if (!member.canSuggest) continue;
    const profile = await ctx.db.query('profiles').withIndex('by_userId', q => q.eq('userId', member.userId)).unique();
    if (personalizationEnabled(profile)) allowed.add(member.userId);
  }
  return { members, allowed };
}

function validDisplayName(value: string): string {
  const name = value.trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!name) fail('invalid_name', 'Choose a display name for LuvLink.');
  return name;
}

function makeCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, byte => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
}

async function hashCode(code: string): Promise<string> {
  const bytes = new TextEncoder().encode(code.toUpperCase());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function freshCode(ctx: MutationCtx): Promise<{ code: string; codeHash: string }> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = makeCode();
    const codeHash = await hashCode(code);
    const existing = await ctx.db.query('luvLinkInvites').withIndex('by_codeHash', q => q.eq('codeHash', codeHash)).unique();
    if (!existing) return { code, codeHash };
  }
  fail('invite_unavailable', 'Could not create a LuvLink invite. Try again.');
}

async function pruneReceipts(ctx: MutationCtx, id: Id<'luvLinkRooms'>, now: number): Promise<void> {
  const expired = await ctx.db.query('luvLinkReceipts').withIndex('by_roomId_and_createdAtMs', q => q.eq('roomId', id).lt('createdAtMs', now - RECEIPT_TTL_MS)).take(16);
  for (const receipt of expired) await ctx.db.delete(receipt._id);
}

async function findReceipt(ctx: MutationCtx, id: Id<'luvLinkRooms'>, userId: string, commandId: string, kind: string): Promise<Infer<typeof commandReceipt> | null> {
  if (commandId.length < 8 || commandId.length > 96) fail('invalid_command', 'A valid command id is required.');
  const row = await ctx.db.query('luvLinkReceipts').withIndex('by_roomId_and_commandId', q => q.eq('roomId', id).eq('commandId', commandId)).unique();
  if (!row) return null;
  if (row.userId !== userId || row.kind !== kind) fail('request_conflict', 'This command id was already used for another action.');
  return row.result;
}

async function saveReceipt(ctx: MutationCtx, id: Id<'luvLinkRooms'>, userId: string, commandId: string, kind: string, result: Infer<typeof commandReceipt>, now: number): Promise<void> {
  await pruneReceipts(ctx, id, now);
  await ctx.db.insert('luvLinkReceipts', { roomId: id, commandId, userId, kind, result, createdAtMs: now });
}

const noResult = v.null();

export const createRoom = mutation({
  args: { displayName: v.string() },
  returns: v.object({ roomId, code: v.string(), expiresAtMs: v.number(), protocolVersion: v.literal(1) }),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    // Rollback switch: stops new rooms only; open rooms keep working and can still be left.
    if (process.env.LUVLINK_CREATION_DISABLED === 'true') fail('creation_disabled', 'New LuvLinks are paused right now. Rooms already open keep working.');
    await limit(ctx, 'roomCreate', userId);
    const now = Date.now();
    const expiresAtMs = now + ROOM_TTL_MS;
    const { code, codeHash } = await freshCode(ctx);
    const id = await ctx.db.insert('luvLinkRooms', {
      hostUserId: userId, leaderUserId: userId, leaderEpoch: 1, mode: 'listen', status: 'active', protocolVersion: 1,
      revision: 1, queueRevision: 0, suggestionRevision: 1, memberCount: 1, createdAtMs: now, expiresAtMs
    });
    await ctx.db.insert('luvLinkMembers', { roomId: id, userId, displayName: validDisplayName(args.displayName), role: 'host', mode: 'listen', canControl: true, canSuggest: false, joinedAtMs: now });
    await ctx.db.insert('luvLinkInvites', { roomId: id, codeHash, generation: 1, createdAtMs: now, expiresAtMs: now + INVITE_TTL_MS });
    return { roomId: id, code, expiresAtMs, protocolVersion: 1 as const };
  }
});

export const joinRoom = mutation({
  args: { code: v.string(), displayName: v.string() },
  returns: v.object({ roomId, userId: v.string(), role: roomRole, mode: roomMode }),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await limit(ctx, 'roomJoin', userId);
    const code = args.code.trim().toUpperCase();
    if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/.test(code)) fail('invalid_invite', 'That LuvLink code is not valid.');
    const codeHash = await hashCode(code);
    const invite = await ctx.db.query('luvLinkInvites').withIndex('by_codeHash', q => q.eq('codeHash', codeHash)).unique();
    if (!invite || invite.revokedAtMs !== undefined || invite.expiresAtMs <= Date.now()) fail('invite_unavailable', 'This LuvLink invite has expired or was revoked.');
    const room = await activeRoom(ctx, invite.roomId);
    if (!room) fail('room_unavailable', 'This LuvLink has ended or expired.');
    const existing = await memberFor(ctx, room._id, userId);
    if (!existing) {
      if (room.memberCount >= MAX_MEMBERS) fail('room_full', 'This LuvLink has reached its member limit.');
      const now = Date.now();
      await ctx.db.insert('luvLinkMembers', { roomId: room._id, userId, displayName: validDisplayName(args.displayName), role: 'member', mode: 'listen', canControl: false, canSuggest: false, joinedAtMs: now });
      await ctx.db.patch(room._id, { memberCount: room.memberCount + 1, revision: room.revision + 1 });
      await invalidatePicks(ctx, room);
    }
    return { roomId: room._id, userId, role: existing?.role ?? 'member', mode: existing?.mode ?? 'listen' };
  }
});

export const getRoom = query({
  args: { roomId },
  returns: v.union(roomSnapshot, v.null()),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const room = await activeRoom(ctx, args.roomId);
    if (!room || !(await memberFor(ctx, args.roomId, userId))) return null;
    return { roomId: room._id, hostUserId: room.hostUserId, leaderUserId: room.leaderUserId, leaderEpoch: room.leaderEpoch, mode: room.mode, transport: 'convex-v1' as const, protocolVersion: 1 as const, revision: room.revision, expiresAtMs: room.expiresAtMs, memberCount: room.memberCount, handoffFromUserId: room.handoffFromUserId ?? null };
  }
});

export const getMembers = query({
  args: { roomId },
  returns: v.array(memberSnapshot),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    if (!(await requireMember(ctx, args.roomId, userId))) return [];
    const rows = await ctx.db.query('luvLinkMembers').withIndex('by_roomId_and_joinedAtMs', q => q.eq('roomId', args.roomId)).take(MAX_MEMBERS);
    return rows.map(({ userId: memberId, displayName, role, mode, canControl, canSuggest, joinedAtMs }) => ({ userId: memberId, displayName, role, mode, canControl, canSuggest, joinedAtMs }));
  }
});

export const getQueue = query({
  args: { roomId },
  returns: queueSnapshot,
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const access = await requireMember(ctx, args.roomId, userId);
    const rows = await ctx.db.query('luvLinkQueue').withIndex('by_roomId_and_order', q => q.eq('roomId', args.roomId)).take(MAX_QUEUE);
    return { revision: access.room.queueRevision, entries: rows.map(row => ({ entryId: row.entryId, roomId: row.roomId, order: row.order, song: row.song, addedByUserId: row.addedByUserId, addedByName: row.addedByName, createdAtMs: row.createdAtMs })) };
  }
});

export const setSuggestionsConsent = mutation({
  args: { roomId, enabled: v.boolean() }, returns: noResult,
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const { room, member } = await requireMember(ctx, args.roomId, userId);
    if (args.enabled) {
      const profile = await ctx.db.query('profiles').withIndex('by_userId', q => q.eq('userId', userId)).unique();
      if (!personalizationEnabled(profile)) fail('personalization_disabled', 'Turn on personalisation in settings before sharing listening taste.');
    }
    if (member.canSuggest !== args.enabled) {
      await ctx.db.patch(member._id, { canSuggest: args.enabled });
      await invalidatePicks(ctx, room);
    }
    return null;
  }
});

/** Cached, consent-filtered group shelf. Reads no taste rows or playback state. */
export const getGroupPicks = query({
  args: { roomId }, returns: groupPicks,
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const { room } = await requireMember(ctx, args.roomId, userId);
    const cache = await ctx.db.query('luvLinkRecommendations').withIndex('by_roomId', q => q.eq('roomId', room._id)).unique();
    if (!cache || cache.revision !== room.suggestionRevision || Date.now() - cache.builtAtMs >= SUGGESTION_TTL_MS) {
      return { revision: room.suggestionRevision, picks: [] };
    }
    const { allowed } = await recommendationMembers(ctx, room._id);
    return { revision: room.suggestionRevision, picks: cache.picks.filter(pick => pick.forUserIds.every(id => allowed.has(id))) };
  }
});

/** Builds at most once per minute from 25 opted-in taste rows per member. */
export const refreshGroupPicks = mutation({
  args: { roomId }, returns: groupPicks,
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await limit(ctx, 'suggestionBuild', userId);
    const { room } = await requireMember(ctx, args.roomId, userId);
    const now = Date.now();
    const cached = await ctx.db.query('luvLinkRecommendations').withIndex('by_roomId', q => q.eq('roomId', room._id)).unique();
    const { members, allowed } = await recommendationMembers(ctx, room._id);
    if (cached && cached.revision === room.suggestionRevision && now - cached.builtAtMs < SUGGESTION_TTL_MS) {
      return { revision: cached.revision, picks: cached.picks.filter(pick => pick.forUserIds.every(id => allowed.has(id))) };
    }
    const queue = await ctx.db.query('luvLinkQueue').withIndex('by_roomId_and_order', q => q.eq('roomId', room._id)).take(MAX_QUEUE);
    const queued = new Set(queue.map(row => identityKey(row.song.title, row.song.artist)));
    const songs = new Map<string, SongSnapshot>();
    const tastes: MemberTaste[] = [];
    for (const member of members) {
      const rows = allowed.has(member.userId)
        ? await ctx.db.query('tasteSongs').withIndex('by_userId_and_score', q => q.eq('userId', member.userId)).order('desc').take(MAX_SUGGESTION_ROWS)
        : [];
      const items: TasteItem[] = [];
      for (const row of rows) {
        const ref = parseSongRef(row.ref);
        const weight = currentWeight(row.score, now);
        if (!ref || weight < 0.05) continue;
        const song = { ref: `${ref.source}:${ref.id}` as `${'saavn' | 'gaana'}:${string}`, title: row.title, artist: row.artist, artwork: row.artwork, duration: row.duration };
        const identity = row.identity;
        if (!queued.has(identity)) songs.set(identity, song);
        items.push({ identity, artist: row.artist, weight });
      }
      tastes.push(memberTaste({ userId: member.userId, now: items, loved: [], kept: [], learning: allowed.has(member.userId), facts: new Map() as ArtistFactsMap }));
    }
    const tracks = buildBlend({ members: tastes, songs, discovery: [], facts: new Map() as ArtistFactsMap, previous: new Set(), seed: `${room._id}:${room.suggestionRevision}` });
    const picks = tracks.slice(0, 12).map(track => ({ song: track.song, forUserIds: [...track.for], kind: track.kind === 'shared' ? 'shared' as const : 'pick' as const }));
    const current = await ctx.db.get(room._id);
    if (!current || current.status !== 'active' || current.suggestionRevision !== room.suggestionRevision) return { revision: room.suggestionRevision, picks: [] };
    if (cached) await ctx.db.replace(cached._id, { roomId: room._id, revision: room.suggestionRevision, picks, builtAtMs: now });
    else await ctx.db.insert('luvLinkRecommendations', { roomId: room._id, revision: room.suggestionRevision, picks, builtAtMs: now });
    return { revision: room.suggestionRevision, picks: picks.filter(pick => pick.forUserIds.every(id => allowed.has(id))) };
  }
});

export const getPlayback = query({
  args: { roomId },
  returns: v.union(playbackAnchor, v.null()),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    if (!(await requireMember(ctx, args.roomId, userId))) return null;
    const anchor = await ctx.db.query('luvLinkPlayback').withIndex('by_roomId', q => q.eq('roomId', args.roomId)).unique();
    return anchor ? { roomId: anchor.roomId, leaderUserId: anchor.leaderUserId, leaderEpoch: anchor.leaderEpoch, sequence: anchor.sequence, trackEpoch: anchor.trackEpoch, queueEntryId: anchor.queueEntryId, intent: anchor.intent, intentByUserId: anchor.intentByUserId, outputAppliedSequence: anchor.outputAppliedSequence, barrierPending: anchor.barrierPending, song: anchor.song, positionSec: anchor.positionSec, serverAtMs: anchor.serverAtMs, playing: anchor.playing, effectiveAtMs: anchor.effectiveAtMs, playbackRate: anchor.playbackRate } : null;
  }
});

export const setMemberMode = mutation({
  args: { roomId, mode: roomMode }, returns: noResult,
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const { room, member } = await requireMember(ctx, args.roomId, userId);
    if (args.mode === 'speaker') fail('not_allowed', 'The host selects the single LuvLink speaker.');
    if (member.mode !== args.mode) {
      await ctx.db.patch(member._id, { mode: args.mode });
      await ctx.db.patch(room._id, { revision: room.revision + 1 });
    }
    return null;
  }
});

export const addQueueItem = mutation({
  args: { roomId, commandId: v.string(), song: songSnapshot, next: v.boolean() },
  returns: v.object({ entryId: v.string(), revision: v.number() }),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await limit(ctx, 'queueWrite', userId);
    const { room, member } = await requireMember(ctx, args.roomId, userId);
    const prior = await findReceipt(ctx, room._id, userId, args.commandId, 'add');
    if (prior?.entryId) return { entryId: prior.entryId, revision: prior.revision };
    assertSongSnapshot(args.song, () => fail('invalid_song', 'This song cannot be added to LuvLink.'));
    if (args.next && !member.canControl && member.role !== 'host') fail('not_allowed', 'Only a LuvLink controller can add a next song.');
    const rows = await ctx.db.query('luvLinkQueue').withIndex('by_roomId_and_order', q => q.eq('roomId', room._id)).take(MAX_QUEUE + 1);
    if (rows.length >= MAX_QUEUE) fail('queue_full', 'The LuvLink queue is full.');
    const now = Date.now();
    const order = args.next ? Math.min(...rows.map(row => row.order), 0) - 1 : Math.max(0, ...rows.map(row => row.order)) + 1;
    const entryId = crypto.randomUUID();
    await ctx.db.insert('luvLinkQueue', { roomId: room._id, entryId, order, song: args.song, addedByUserId: userId, addedByName: member.displayName, createdAtMs: now });
    const revision = room.queueRevision + 1;
    await ctx.db.patch(room._id, { queueRevision: revision });
    await invalidatePicks(ctx, room);
    await saveReceipt(ctx, room._id, userId, args.commandId, 'add', { entryId, revision }, now);
    return { entryId, revision };
  }
});

export const removeQueueItem = mutation({
  args: { roomId, commandId: v.string(), entryId: v.string(), expectedRevision: v.number() }, returns: v.object({ revision: v.number() }),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await limit(ctx, 'queueWrite', userId);
    const { room, member } = await requireMember(ctx, args.roomId, userId);
    const prior = await findReceipt(ctx, room._id, userId, args.commandId, 'remove');
    if (prior) return { revision: prior.revision };
    if (!member.canControl && member.role !== 'host') fail('not_allowed', 'Only a LuvLink controller can edit the queue.');
    if (args.expectedRevision !== room.queueRevision) fail('stale_revision', 'The queue changed. Refresh and try again.');
    const item = await ctx.db.query('luvLinkQueue').withIndex('by_roomId_and_entryId', q => q.eq('roomId', room._id).eq('entryId', args.entryId)).unique();
    if (!item) fail('queue_item_missing', 'That song is no longer in the LuvLink queue.');
    const now = Date.now();
    await ctx.db.delete(item._id);
    const revision = room.queueRevision + 1;
    await ctx.db.patch(room._id, { queueRevision: revision });
    await invalidatePicks(ctx, room);
    await saveReceipt(ctx, room._id, userId, args.commandId, 'remove', { revision }, now);
    return { revision };
  }
});

export const moveQueueItem = mutation({
  args: { roomId, commandId: v.string(), entryId: v.string(), beforeEntryId: v.union(v.string(), v.null()), expectedRevision: v.number() }, returns: v.object({ revision: v.number() }),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await limit(ctx, 'queueWrite', userId);
    const { room, member } = await requireMember(ctx, args.roomId, userId);
    const prior = await findReceipt(ctx, room._id, userId, args.commandId, 'move');
    if (prior) return { revision: prior.revision };
    if (!member.canControl && member.role !== 'host') fail('not_allowed', 'Only a LuvLink controller can edit the queue.');
    if (args.expectedRevision !== room.queueRevision) fail('stale_revision', 'The queue changed. Refresh and try again.');
    const rows = await ctx.db.query('luvLinkQueue').withIndex('by_roomId_and_order', q => q.eq('roomId', room._id)).take(MAX_QUEUE);
    const movingIndex = rows.findIndex(row => row.entryId === args.entryId);
    if (movingIndex < 0) fail('queue_item_missing', 'That song is no longer in the LuvLink queue.');
    const [moving] = rows.splice(movingIndex, 1);
    const targetIndex = args.beforeEntryId === null ? rows.length : rows.findIndex(row => row.entryId === args.beforeEntryId);
    if (targetIndex < 0) fail('queue_item_missing', 'The target song is no longer in the LuvLink queue.');
    rows.splice(targetIndex, 0, moving);
    for (const [index, row] of rows.entries()) if (row.order !== index) await ctx.db.patch(row._id, { order: index });
    const now = Date.now();
    const revision = room.queueRevision + 1;
    await ctx.db.patch(room._id, { queueRevision: revision });
    await invalidatePicks(ctx, room);
    await saveReceipt(ctx, room._id, userId, args.commandId, 'move', { revision }, now);
    return { revision };
  }
});

export const publishPlayback = mutation({
  args: {
    roomId, commandId: v.string(), expectedLeaderEpoch: v.number(), expectedSequence: v.number(), trackEpoch: v.number(), intent: v.union(v.literal('control'), v.literal('natural_end'), v.literal('checkpoint')),
    queueEntryId: v.union(v.string(), v.null()), song: v.union(songSnapshot, v.null()), positionSec: v.number(), playing: v.boolean(), playbackRate: v.number(), effectiveAtMs: v.number()
  }, returns: v.object({ sequence: v.number(), serverAtMs: v.number() }),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await limit(ctx, 'playbackWrite', userId);
    const { room, member } = await requireMember(ctx, args.roomId, userId);
    const prior = await findReceipt(ctx, room._id, userId, args.commandId, 'playback');
    const now = Date.now();
    const old = await ctx.db.query('luvLinkPlayback').withIndex('by_roomId', q => q.eq('roomId', room._id)).unique();
    if (prior) return { sequence: prior.revision, serverAtMs: now };
    if ((!member.canControl && member.role !== 'host') || args.expectedLeaderEpoch !== room.leaderEpoch) fail('stale_leader', 'You cannot control this LuvLink, or playback leadership changed. Refresh LuvLink.');
    if (room.handoffFromUserId) fail('handoff_pending', 'The previous LuvLink speaker is pausing. Try again in a moment.');
    if (args.expectedSequence !== (old?.sequence ?? 0)) fail('stale_sequence', 'Playback changed on another device. Refresh and try again.');
    if (!Number.isFinite(args.positionSec) || args.positionSec < 0 || !Number.isFinite(args.playbackRate) || args.playbackRate < 0.5 || args.playbackRate > 2) fail('invalid_playback', 'Playback state is out of range.');
    if (args.song) {
      assertSongSnapshot(args.song, () => fail('invalid_song', 'This song cannot be played in LuvLink.'));
      if (args.positionSec > args.song.duration + 1) fail('invalid_playback', 'Playback position is outside the song.');
    } else if (args.positionSec !== 0 || args.playing) fail('invalid_playback', 'Playback needs a song.');
    if (args.queueEntryId !== null) {
      const entry = await ctx.db.query('luvLinkQueue').withIndex('by_roomId_and_entryId', q => q.eq('roomId', room._id).eq('entryId', args.queueEntryId!)).unique();
      if (!entry || !args.song || entry.song.ref !== args.song.ref) fail('queue_item_missing', 'The requested song is no longer queued.');
    }
    if (args.trackEpoch < (old?.trackEpoch ?? 0) || args.trackEpoch > (old?.trackEpoch ?? 0) + 1) fail('stale_track', 'The track changed. Refresh and try again.');
    if (args.intent === 'natural_end' && (userId !== room.leaderUserId || !old?.playing || !old.song || args.queueEntryId === null || args.trackEpoch !== old.trackEpoch + 1)) fail('not_leader', 'Only the elected output can commit one natural queue advance.');
    if (args.intent === 'checkpoint' && (userId !== room.leaderUserId || !old?.song || old.song.ref !== args.song?.ref || args.trackEpoch !== old.trackEpoch || args.queueEntryId !== old.queueEntryId)) fail('invalid_checkpoint', 'A checkpoint can only refresh the current track from its elected output.');
    if (Math.abs(args.effectiveAtMs - now) > 10_000) fail('invalid_playback', 'The requested start time is outside the allowed window.');
    const sequence = (old?.sequence ?? 0) + 1;
    const trackChanged = args.trackEpoch > (old?.trackEpoch ?? 0);
    const needsBarrier = args.playing && trackChanged && args.song !== null;
    const value = { roomId: room._id, leaderUserId: room.leaderUserId, leaderEpoch: room.leaderEpoch, sequence, trackEpoch: args.trackEpoch, queueEntryId: args.queueEntryId, intent: args.intent, intentByUserId: userId, outputAppliedSequence: room.mode === 'speaker' && (userId !== room.leaderUserId || needsBarrier) ? old?.outputAppliedSequence ?? 0 : sequence, barrierPending: needsBarrier, song: args.song, positionSec: args.positionSec, serverAtMs: now, playing: args.playing && !needsBarrier, effectiveAtMs: needsBarrier ? now : args.effectiveAtMs, playbackRate: args.playbackRate };
    if (old) await ctx.db.replace(old._id, value); else await ctx.db.insert('luvLinkPlayback', value);
    if (args.queueEntryId !== null) {
      const consumed = await ctx.db.query('luvLinkQueue').withIndex('by_roomId_and_entryId', q => q.eq('roomId', room._id).eq('entryId', args.queueEntryId!)).unique();
      if (consumed) {
        await ctx.db.delete(consumed._id);
        await ctx.db.patch(room._id, { queueRevision: room.queueRevision + 1 });
        await invalidatePicks(ctx, room);
      }
    }
    // One barrier row per room: a newer track replaces it, anything else cancels a pending one.
    const currentBarrier = await ctx.db.query('luvLinkBarriers').withIndex('by_roomId', q => q.eq('roomId', room._id)).unique();
    if (needsBarrier && args.song) {
      const deadlineAtMs = now + 4_000;
      const barrier = {
        roomId: room._id, trackEpoch: args.trackEpoch, leaderEpoch: room.leaderEpoch, sequence,
        song: args.song, queueEntryId: args.queueEntryId, intent: args.intent === 'natural_end' ? 'natural_end' as const : 'control' as const, intentByUserId: userId, positionSec: args.positionSec,
        playbackRate: args.playbackRate, deadlineAtMs, status: 'pending' as const
      };
      if (currentBarrier) await ctx.db.replace(currentBarrier._id, barrier);
      else await ctx.db.insert('luvLinkBarriers', barrier);
      await ctx.scheduler.runAfter(4_000, internal.luvLink.finishReadyBarrier, { roomId: room._id, trackEpoch: args.trackEpoch });
    } else if (currentBarrier?.status === 'pending') {
      await ctx.db.patch(currentBarrier._id, { status: 'cancelled' });
    }
    await ctx.db.patch(room._id, { revision: room.revision + 1 });
    await saveReceipt(ctx, room._id, userId, args.commandId, 'playback', { revision: sequence }, now);
    return { sequence, serverAtMs: now };
  }
});

/** The elected output acknowledges a controller's transport intent after its local player applies it. */
export const acknowledgePlaybackIntent = mutation({
  args: { roomId, sequence: v.number(), leaderEpoch: v.number() }, returns: noResult,
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const { room } = await requireMember(ctx, args.roomId, userId);
    const anchor = await ctx.db.query('luvLinkPlayback').withIndex('by_roomId', q => q.eq('roomId', room._id)).unique();
    if (!anchor || room.mode !== 'speaker' || room.leaderUserId !== userId || room.leaderEpoch !== args.leaderEpoch || anchor.leaderEpoch !== args.leaderEpoch || anchor.sequence !== args.sequence) fail('stale_intent', 'This LuvLink control intent is no longer current.');
    if (anchor.outputAppliedSequence < anchor.sequence) await ctx.db.patch(anchor._id, { outputAppliedSequence: anchor.sequence });
    return null;
  }
});

export const reportReady = mutation({
  args: { roomId, trackEpoch: v.number(), ready: v.boolean() }, returns: noResult,
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const { room } = await requireMember(ctx, args.roomId, userId);
    if (room.mode === 'speaker' && room.leaderUserId !== userId) fail('not_output', 'Only the active LuvLink speaker reports readiness.');
    const anchor = await ctx.db.query('luvLinkPlayback').withIndex('by_roomId', q => q.eq('roomId', room._id)).unique();
    if (!anchor || anchor.trackEpoch !== args.trackEpoch) fail('stale_track', 'This readiness report is for an older track.');
    const row = await ctx.db.query('luvLinkReady').withIndex('by_roomId_and_trackEpoch_and_userId', q => q.eq('roomId', room._id).eq('trackEpoch', args.trackEpoch).eq('userId', userId)).unique();
    const now = Date.now();
    if (row) await ctx.db.patch(row._id, { ready: args.ready, updatedAtMs: now });
    else await ctx.db.insert('luvLinkReady', { roomId: room._id, trackEpoch: args.trackEpoch, userId, ready: args.ready, updatedAtMs: now });
    if (args.ready) {
      const barrier = await ctx.db.query('luvLinkBarriers').withIndex('by_roomId', q => q.eq('roomId', room._id)).unique();
      if (barrier?.status === 'pending' && barrier.trackEpoch === args.trackEpoch) {
        const members = await ctx.db.query('luvLinkMembers').withIndex('by_roomId_and_joinedAtMs', q => q.eq('roomId', room._id)).take(MAX_MEMBERS);
        const readiness = await ctx.db.query('luvLinkReady').withIndex('by_roomId_and_trackEpoch', q => q.eq('roomId', room._id).eq('trackEpoch', args.trackEpoch)).take(MAX_MEMBERS);
        const eligible = room.mode === 'speaker' ? members.filter(item => item.userId === room.leaderUserId) : members.filter(item => item.mode === 'listen');
        if (eligible.length > 0 && eligible.every(member => readiness.some(item => item.userId === member.userId && item.ready))) await finishBarrier(ctx, room._id, args.trackEpoch);
      }
    }
    return null;
  }
});

/** A fresh timestamp sample for NTP-style client clock estimation. Mutations do not cache time. */
export const getServerTime = mutation({
  args: { roomId }, returns: v.object({ serverAtMs: v.number() }),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await limit(ctx, 'clockSample', userId);
    await requireMember(ctx, args.roomId, userId);
    return { serverAtMs: Date.now() };
  }
});

/** Ephemeral participant liveness. Heartbeats are component data, separate from room documents. */
export const heartbeat = mutation({
  args: { roomId, sessionId: v.string() },
  returns: v.object({ sessionToken: v.string(), serverAtMs: v.number() }),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await requireMember(ctx, args.roomId, userId);
    if (args.sessionId.length < 8 || args.sessionId.length > 80) fail('invalid_session', 'Refresh this LuvLink session.');
    const now = Date.now();
    const { sessionToken } = await presence.heartbeat(ctx, `luvlink:${args.roomId}`, userId, `${userId}:${args.sessionId}`, PRESENCE_HEARTBEAT_MS);
    return { sessionToken, serverAtMs: now };
  }
});

/** A separate bounded presence subscription; never reads profiles or changes playback dependencies. */
export const getPresence = query({
  args: { roomId }, returns: v.array(v.string()),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await requireMember(ctx, args.roomId, userId);
    const sessions = await presence.listRoom(ctx, `luvlink:${args.roomId}`, true, MAX_MEMBERS * 4);
    return [...new Set(sessions.map(({ userId: sessionUserId }) => sessionUserId.slice(0, sessionUserId.lastIndexOf(':'))))].slice(0, MAX_MEMBERS);
  }
});

export const disconnectPresence = mutation({
  args: { roomId, sessionToken: v.string() }, returns: noResult,
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await requireMember(ctx, args.roomId, userId);
    if (args.sessionToken.length < 16 || args.sessionToken.length > 256) fail('invalid_session', 'Refresh this LuvLink session.');
    await presence.disconnect(ctx, args.sessionToken);
    return null;
  }
});

export const finishReadyBarrier = internalMutation({
  args: { roomId, trackEpoch: v.number() }, returns: noResult,
  handler: async (ctx, args) => {
    const barrier = await ctx.db.query('luvLinkBarriers').withIndex('by_roomId', q => q.eq('roomId', args.roomId)).unique();
    if (!barrier || barrier.status !== 'pending' || barrier.trackEpoch !== args.trackEpoch) return null;
    const waitMs = barrier.deadlineAtMs - Date.now();
    if (waitMs > 0) {
      await ctx.scheduler.runAfter(waitMs, internal.luvLink.finishReadyBarrier, args);
      return null;
    }
    await finishBarrier(ctx, args.roomId, args.trackEpoch);
    return null;
  }
});

/** Indexed hourly retention: each transaction removes one bounded batch for at most one room. */
export const cleanupExpiredRooms = internalMutation({
  args: {}, returns: v.object({ removed: v.number(), continuing: v.boolean() }),
  handler: async (ctx) => {
    const expired = await ctx.db.query('luvLinkRooms').withIndex('by_expiresAtMs', q => q.lt('expiresAtMs', Date.now())).take(1);
    const room = expired[0];
    if (!room) return { removed: 0, continuing: false };
    const [members, queue, invites, receipts, ready, barriers, playback, recommendations, sessions] = await Promise.all([
      ctx.db.query('luvLinkMembers').withIndex('by_roomId_and_joinedAtMs', q => q.eq('roomId', room._id)).take(100),
      ctx.db.query('luvLinkQueue').withIndex('by_roomId_and_order', q => q.eq('roomId', room._id)).take(MAX_QUEUE),
      ctx.db.query('luvLinkInvites').withIndex('by_roomId_and_generation', q => q.eq('roomId', room._id)).take(100),
      ctx.db.query('luvLinkReceipts').withIndex('by_roomId_and_createdAtMs', q => q.eq('roomId', room._id)).take(200),
      ctx.db.query('luvLinkReady').withIndex('by_roomId_and_trackEpoch', q => q.eq('roomId', room._id)).take(200),
      ctx.db.query('luvLinkBarriers').withIndex('by_roomId', q => q.eq('roomId', room._id)).take(8),
      ctx.db.query('luvLinkPlayback').withIndex('by_roomId', q => q.eq('roomId', room._id)).take(8),
      ctx.db.query('luvLinkRecommendations').withIndex('by_roomId', q => q.eq('roomId', room._id)).take(1),
      presence.listRoom(ctx, `luvlink:${room._id}`, false, MAX_MEMBERS * 4)
    ]);
    for (const row of members) await ctx.db.delete(row._id);
    for (const row of queue) await ctx.db.delete(row._id);
    for (const row of invites) await ctx.db.delete(row._id);
    for (const row of receipts) await ctx.db.delete(row._id);
    for (const row of ready) await ctx.db.delete(row._id);
    for (const row of barriers) await ctx.db.delete(row._id);
    for (const row of playback) await ctx.db.delete(row._id);
    for (const row of recommendations) await ctx.db.delete(row._id);
    for (const row of sessions) await presence.removeRoomUser(ctx, `luvlink:${room._id}`, row.userId);
    const continuing = members.length === 100 || queue.length === MAX_QUEUE || invites.length === 100 || receipts.length === 200 || ready.length === 200 || barriers.length === 8 || playback.length === 8 || sessions.length === MAX_MEMBERS * 4;
    if (continuing) await ctx.scheduler.runAfter(0, internal.luvLink.cleanupExpiredRooms, {});
    else {
      await ctx.db.delete(room._id);
      await ctx.scheduler.runAfter(0, internal.luvLink.cleanupExpiredRooms, {});
    }
    return { removed: continuing ? 0 : 1, continuing };
  }
});

export const setSpeaker = mutation({
  args: { roomId, commandId: v.string(), targetUserId: v.string() }, returns: v.object({ leaderEpoch: v.number() }),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await limit(ctx, 'playbackWrite', userId);
    const { room, member } = await requireMember(ctx, args.roomId, userId);
    if (member.role !== 'host') fail('not_allowed', 'Only the LuvLink host can move the speaker.');
    if (room.mode !== 'speaker') fail('wrong_mode', 'Switch LuvLink to speaker mode first.');
    const prior = await findReceipt(ctx, room._id, userId, args.commandId, 'speaker');
    if (prior) return { leaderEpoch: prior.revision };
    const target = await memberFor(ctx, room._id, args.targetUserId);
    if (!target) fail('not_a_member', 'That listener has left this LuvLink.');
    if (room.handoffFromUserId) fail('handoff_pending', 'Wait for the previous speaker to pause before moving the LuvLink output again.');
    const now = Date.now();
    const leaderEpoch = room.leaderEpoch + 1;
    const oldLeaderMember = await memberFor(ctx, room._id, room.leaderUserId);
    if (room.leaderUserId !== target.userId) {
      await ctx.db.patch(room._id, { handoffFromUserId: room.leaderUserId });
    }
    if (oldLeaderMember) await ctx.db.patch(oldLeaderMember._id, { mode: 'listen' });
    await ctx.db.patch(target._id, { mode: 'speaker' });
    await ctx.db.patch(room._id, { leaderUserId: target.userId, leaderEpoch, revision: room.revision + 1 });
    const barrier = await ctx.db.query('luvLinkBarriers').withIndex('by_roomId', q => q.eq('roomId', room._id)).unique();
    if (barrier?.status === 'pending') await ctx.db.patch(barrier._id, { status: 'cancelled' });
    const anchor = await ctx.db.query('luvLinkPlayback').withIndex('by_roomId', q => q.eq('roomId', room._id)).unique();
    if (anchor) await ctx.db.patch(anchor._id, { leaderUserId: target.userId, leaderEpoch, sequence: anchor.sequence + 1, intent: 'control', intentByUserId: userId, barrierPending: false, playing: false, positionSec: projectCurrent(anchor, now), serverAtMs: now, effectiveAtMs: now });
    await saveReceipt(ctx, room._id, userId, args.commandId, 'speaker', { revision: leaderEpoch }, now);
    return { leaderEpoch };
  }
});

/** The old output acknowledges only after its local player has paused. New leader commands remain fenced until then. */
export const acknowledgeSpeakerHandoff = mutation({
  args: { roomId, expectedLeaderEpoch: v.number() }, returns: noResult,
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const { room } = await requireMember(ctx, args.roomId, userId);
    if (room.mode !== 'speaker' || room.leaderEpoch !== args.expectedLeaderEpoch || room.handoffFromUserId !== userId) fail('stale_handoff', 'This LuvLink speaker handoff is no longer current.');
    await ctx.db.patch(room._id, { handoffFromUserId: undefined, revision: room.revision + 1 });
    return null;
  }
});

function projectCurrent(anchor: Doc<'luvLinkPlayback'>, now: number): number {
  const projected = anchor.positionSec + (anchor.playing ? Math.max(0, now - anchor.effectiveAtMs) / 1000 * anchor.playbackRate : 0);
  return anchor.song ? Math.max(0, Math.min(anchor.song.duration, projected)) : 0;
}

export const setRoomMode = mutation({
  args: { roomId, mode: roomMode }, returns: noResult,
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const { room, member } = await requireMember(ctx, args.roomId, userId);
    if (member.role !== 'host') fail('not_allowed', 'Only the LuvLink host can change room mode.');
    const rows = await ctx.db.query('luvLinkMembers').withIndex('by_roomId_and_joinedAtMs', q => q.eq('roomId', room._id)).take(MAX_MEMBERS);
    for (const row of rows) await ctx.db.patch(row._id, { mode: args.mode === 'speaker' && row.userId === room.leaderUserId ? 'speaker' : 'listen' });
    await ctx.db.patch(room._id, { mode: args.mode, revision: room.revision + 1 });
    return null;
  }
});

export const setController = mutation({
  args: { roomId, targetUserId: v.string(), canControl: v.boolean() }, returns: noResult,
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const { room, member } = await requireMember(ctx, args.roomId, userId);
    if (member.role !== 'host') fail('not_allowed', 'Only the LuvLink host can change controls.');
    const target = await memberFor(ctx, room._id, args.targetUserId);
    if (!target || target.role === 'host') fail('not_a_member', 'That listener cannot be changed.');
    await ctx.db.patch(target._id, { canControl: args.canControl });
    return null;
  }
});

export const regenerateInvite = mutation({
  args: { roomId }, returns: v.object({ code: v.string(), expiresAtMs: v.number() }),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await limit(ctx, 'inviteWrite', userId);
    const { room, member } = await requireMember(ctx, args.roomId, userId);
    if (member.role !== 'host') fail('not_allowed', 'Only the LuvLink host can manage invites.');
    const now = Date.now();
    const old = await ctx.db.query('luvLinkInvites').withIndex('by_roomId_and_generation', q => q.eq('roomId', room._id)).take(8);
    for (const invite of old) await ctx.db.delete(invite._id);
    const { code, codeHash } = await freshCode(ctx);
    const expiresAtMs = now + INVITE_TTL_MS;
    const generation = Math.max(0, ...old.map(row => row.generation)) + 1;
    await ctx.db.insert('luvLinkInvites', { roomId: room._id, codeHash, generation, createdAtMs: now, expiresAtMs });
    return { code, expiresAtMs };
  }
});

export const revokeInvite = mutation({
  args: { roomId }, returns: noResult,
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const { room, member } = await requireMember(ctx, args.roomId, userId);
    if (member.role !== 'host') fail('not_allowed', 'Only the LuvLink host can manage invites.');
    const now = Date.now();
    const invites = await ctx.db.query('luvLinkInvites').withIndex('by_roomId_and_generation', q => q.eq('roomId', room._id)).take(8);
    for (const invite of invites) await ctx.db.patch(invite._id, { revokedAtMs: now });
    return null;
  }
});

export const leaveRoom = mutation({
  args: { roomId }, returns: noResult,
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const { room, member } = await requireMember(ctx, args.roomId, userId);
    if (member.role === 'host') {
      const picks = await ctx.db.query('luvLinkRecommendations').withIndex('by_roomId', q => q.eq('roomId', room._id)).unique();
      if (picks) await ctx.db.delete(picks._id);
      await ctx.db.patch(room._id, { status: 'closed', closedAtMs: Date.now(), revision: room.revision + 1 });
    } else {
      await ctx.db.delete(member._id);
      await ctx.db.patch(room._id, { memberCount: Math.max(1, room.memberCount - 1), revision: room.revision + 1 });
      await invalidatePicks(ctx, room);
      if (room.leaderUserId === userId) {
        const leaderEpoch = room.leaderEpoch + 1;
        await ctx.db.patch(room._id, { leaderUserId: room.hostUserId, leaderEpoch, handoffFromUserId: undefined });
        const anchor = await ctx.db.query('luvLinkPlayback').withIndex('by_roomId', q => q.eq('roomId', room._id)).unique();
        if (anchor) await ctx.db.patch(anchor._id, { leaderUserId: room.hostUserId, leaderEpoch, sequence: anchor.sequence + 1, intent: 'control', intentByUserId: userId, outputAppliedSequence: anchor.sequence + 1, barrierPending: false, playing: false, positionSec: projectCurrent(anchor, Date.now()), serverAtMs: Date.now(), effectiveAtMs: Date.now() });
      }
    }
    return null;
  }
});

export const closeRoom = mutation({
  args: { roomId }, returns: noResult,
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const { room, member } = await requireMember(ctx, args.roomId, userId);
    if (member.role !== 'host') fail('not_allowed', 'Only the LuvLink host can end this room.');
    const picks = await ctx.db.query('luvLinkRecommendations').withIndex('by_roomId', q => q.eq('roomId', room._id)).unique();
    if (picks) await ctx.db.delete(picks._id);
    await ctx.db.patch(room._id, { status: 'closed', closedAtMs: Date.now(), revision: room.revision + 1 });
    return null;
  }
});
