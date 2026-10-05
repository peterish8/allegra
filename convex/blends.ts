/**
 * Blends (PLAN.md §5, B2): who is in which Blend, its invite link, and the day's build.
 *
 * Called only by the Express API with the server secret, like profiles and library: the API has
 * already authenticated the caller and passes their `userId`. Every read is bounded, every rule
 * that keeps a Blend consistent (member cap, per-listener cap, owner hand-over, delete on last
 * leave, stale on any membership change) is enforced here inside one transaction.
 *
 * Errors are `ConvexError({ code })` with code 'full' | 'limit' | 'notfound' | 'expired' | 'invalid';
 * the API maps them to the copy in PLAN.md §9.
 */
import { ConvexError, v } from 'convex/values';

import {
  BLEND_DISPLAY_NAME_MAX,
  BLEND_INVITE_DAYS,
  BLEND_MAX_MEMBERS,
  BLEND_MAX_PER_USER,
  BLEND_MEMBERS_CEILING,
  BLEND_NAME_MAX,
  isBlendInviteCode
} from '../packages/shared/blendLimits';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { requireSecret } from './profiles';
import { blendGift, blendStorySong, blendTrack, pairMatch } from './schema';

const DAY_MS = 24 * 60 * 60 * 1000;
const SWEEP_BATCH = 200;
const INVITE_HISTORY_MAX = 50;
const OPERATION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_BUILD_LEASE_MS = 60 * 1000;
/** An unaccepted Blend (one member) is removed once its first invite could no longer be used. */
const LONELY_AFTER_MS = BLEND_INVITE_DAYS * DAY_MS;
const PREVIOUS_TRACKS_MAX = 100;

type ErrorCode = 'full' | 'limit' | 'notfound' | 'expired' | 'invalid';
const fail = (code: ErrorCode): never => {
  throw new ConvexError({ code });
};

const consent = v.object({ policyVersion: v.string(), at: v.number() });

function cleanName(value: string, max: number): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, max);
}

async function blendOf(ctx: QueryCtx, blendId: string): Promise<Doc<'blends'> | null> {
  const id = ctx.db.normalizeId('blends', blendId);
  return id ? ctx.db.get('blends', id) : null;
}

async function membership(ctx: QueryCtx, blendId: Id<'blends'>, userId: string): Promise<Doc<'blendMembers'> | null> {
  return ctx.db.query('blendMembers').withIndex('by_blendId_and_userId', (q) => q.eq('blendId', blendId).eq('userId', userId)).unique();
}

async function membersOf(ctx: QueryCtx, blendId: Id<'blends'>): Promise<Doc<'blendMembers'>[]> {
  return ctx.db.query('blendMembers').withIndex('by_blendId_and_joinedAt', (q) => q.eq('blendId', blendId)).take(BLEND_MEMBERS_CEILING);
}

async function profileOf(ctx: QueryCtx, userId: string): Promise<Doc<'profiles'> | null> {
  return ctx.db.query('profiles').withIndex('by_userId', (q) => q.eq('userId', userId)).unique();
}

function isProfileLearning(profile: Doc<'profiles'> | null): boolean {
  const settings = profile?.settings;
  return !(typeof settings === 'object' && settings !== null && 'personalization' in settings && settings.personalization === false);
}

async function blendCount(ctx: QueryCtx, userId: string): Promise<number> {
  const rows = await ctx.db.query('blendMembers').withIndex('by_userId_and_joinedAt', (q) => q.eq('userId', userId)).take(BLEND_MAX_PER_USER + 1);
  return rows.length;
}

const memberView = (row: Doc<'blendMembers'>) => ({
  userId: row.userId,
  displayName: row.displayName,
  joinedAt: row.joinedAt,
  learning: row.learning
});

/** Deletes a Blend with its members and invites (each ≤ 6 members; invites bounded per pass). */
async function deleteBlend(ctx: MutationCtx, blend: Doc<'blends'>): Promise<void> {
  for (const row of await membersOf(ctx, blend._id)) await ctx.db.delete('blendMembers', row._id);
  const invites = await ctx.db.query('blendInvites').withIndex('by_blendId', (q) => q.eq('blendId', blend._id)).take(50);
  for (const invite of invites) await ctx.db.delete('blendInvites', invite._id);
  await ctx.db.delete('blends', blend._id);
}

function invalidateBuild(blend: Doc<'blends'>): Record<string, unknown> {
  return {
    inputVersion: (blend.inputVersion ?? 0) + 1,
    stale: true,
    builtFor: undefined,
    tracks: [],
    pairs: [],
    previousPairs: [],
    previousTracks: [],
    together: undefined,
    gifts: [],
    glue: [],
    buildLease: undefined
  };
}

/**
 * The leave rules, shared by `leave` and the account erase: the membership goes; the last member
 * leaving deletes the Blend; an owner leaving hands it to the longest-standing member. False when
 * the listener was not a member.
 */
export async function leaveBlend(ctx: MutationCtx, blendId: Id<'blends'>, userId: string): Promise<boolean> {
  const blend = await ctx.db.get('blends', blendId);
  if (!blend) return false;
  const row = await membership(ctx, blendId, userId);
  if (!row) return false;
  await ctx.db.delete('blendMembers', row._id);
  const remaining = await membersOf(ctx, blendId);
  if (remaining.length === 0) {
    await deleteBlend(ctx, blend);
    return true;
  }
  const heir = remaining[0];
  // The shared invite survives a member's departure, but its attribution must not retain them.
  const invites = await ctx.db.query('blendInvites').withIndex('by_blendId', (q) => q.eq('blendId', blendId)).take(INVITE_HISTORY_MAX);
  for (const invite of invites) {
    if (invite.createdBy === userId && heir) await ctx.db.patch('blendInvites', invite._id, { createdBy: heir.userId });
  }
  await ctx.db.patch('blends', blendId, {
    memberCount: remaining.length,
    ...(remaining.length === 1 ? { waitingSince: Date.now() } : {}),
    ...invalidateBuild(blend),
    ...(blend.ownerId === userId && heir ? { ownerId: heir.userId } : {})
  });
  return true;
}

async function liveInvite(ctx: QueryCtx, blendId: Id<'blends'>, now: number): Promise<Doc<'blendInvites'> | null> {
  const blend = await ctx.db.get('blends', blendId);
  if (blend?.activeInviteId) {
    const active = await ctx.db.get('blendInvites', blend.activeInviteId);
    if (active?.expiresAt && active.expiresAt > now) return active;
  }
  const invites = await ctx.db.query('blendInvites').withIndex('by_blendId_and_createdAt', (q) => q.eq('blendId', blendId)).order('desc').take(INVITE_HISTORY_MAX);
  return invites.find((invite) => invite.expiresAt > now) ?? null;
}

async function inviteByCode(ctx: QueryCtx, code: string): Promise<Doc<'blendInvites'> | null> {
  if (!isBlendInviteCode(code)) return null;
  return ctx.db.query('blendInvites').withIndex('by_code', (q) => q.eq('code', code)).unique();
}

export const create = mutation({
  args: {
    secret: v.string(),
    userId: v.string(),
    displayName: v.string(),
    name: v.string(),
    consent,
    learning: v.boolean(),
    code: v.string(),
    operationId: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const now = Date.now();
    const name = cleanName(args.name, BLEND_NAME_MAX);
    if (!name || !isBlendInviteCode(args.code) || (args.operationId !== undefined && (args.operationId.length < 8 || args.operationId.length > 128))) fail('invalid');
    const fingerprint = `${name}\n${args.consent.policyVersion}`;
    if (args.operationId) {
      const prior = await ctx.db.query('blendOperations')
        .withIndex('by_userId_and_operationId', (q) => q.eq('userId', args.userId).eq('operationId', args.operationId!))
        .unique();
      if (prior && prior.expiresAt > now) {
        if (prior.fingerprint !== fingerprint) fail('invalid');
        return { blendId: prior.blendId as string, code: prior.code, expiresAt: (await ctx.db.query('blendInvites').withIndex('by_code', (q) => q.eq('code', prior.code)).unique())?.expiresAt ?? now };
      }
      if (prior) await ctx.db.delete('blendOperations', prior._id);
    }
    if (await blendCount(ctx, args.userId) >= BLEND_MAX_PER_USER) fail('limit');
    const ownerProfile = await profileOf(ctx, args.userId);
    const blendId = await ctx.db.insert('blends', {
      name,
      ownerId: args.userId,
      memberCount: 1,
      createdAt: now,
      waitingSince: now,
      buildVersion: 0,
      inputVersion: 0,
      stale: true,
      tracks: [],
      pairs: [],
      previousPairs: [],
      previousTracks: []
    });
    await ctx.db.insert('blendMembers', {
      blendId,
      userId: args.userId,
      displayName: cleanName(args.displayName, BLEND_DISPLAY_NAME_MAX) || 'Listener',
      joinedAt: now,
      consent: args.consent,
      learning: args.learning && isProfileLearning(ownerProfile)
    });
    const expiresAt = now + BLEND_INVITE_DAYS * DAY_MS;
    const inviteId = await ctx.db.insert('blendInvites', { code: args.code, blendId, createdBy: args.userId, createdAt: now, expiresAt });
    await ctx.db.patch('blends', blendId, { activeInviteId: inviteId });
    if (args.operationId) {
      await ctx.db.insert('blendOperations', {
        userId: args.userId,
        operationId: args.operationId,
        fingerprint,
        blendId,
        code: args.code,
        expiresAt: now + OPERATION_TTL_MS
      });
    }
    return { blendId: blendId as string, code: args.code, expiresAt };
  }
});

/** The Blend with its members, or null when it does not exist or the caller is not in it. */
export const get = query({
  args: { secret: v.string(), blendId: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const blend = await blendOf(ctx, args.blendId);
    if (!blend || !(await membership(ctx, blend._id, args.userId))) return null;
    const { _id, _creationTime, ...stored } = blend;
    const rows = await membersOf(ctx, _id);
    const effective = await Promise.all(rows.map(async (row) => {
      const profile = await profileOf(ctx, row.userId);
      const learning = profile ? isProfileLearning(profile) : row.learning;
      return { row: learning === row.learning ? row : { ...row, learning }, changed: learning !== row.learning };
    }));
    const privacyMismatch = effective.some((item) => item.changed);
    const result = {
      id: _id as string,
      ...stored,
      inputVersion: blend.inputVersion ?? 0,
      members: effective.map((item) => memberView(item.row))
    };
    // A failed legacy reconciliation must never return a stored build containing withdrawn taste.
    return privacyMismatch ? {
      ...result,
      ...invalidateBuild(blend),
      inputVersion: blend.inputVersion ?? 0,
      members: effective.map((item) => memberView(item.row))
    } : result;
  }
});

export const listForUser = query({
  args: { secret: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const rows = await ctx.db.query('blendMembers').withIndex('by_userId_and_joinedAt', (q) => q.eq('userId', args.userId)).take(BLEND_MAX_PER_USER);
    const summaries = [];
    for (const row of rows) {
      const blend = await ctx.db.get('blends', row.blendId);
      if (!blend) continue;
      summaries.push({
        id: blend._id as string,
        name: blend.name,
        memberCount: blend.memberCount,
        joinedAt: row.joinedAt,
        ...(blend.builtFor ? { builtFor: blend.builtFor } : {}),
        members: (await membersOf(ctx, blend._id)).map(memberView)
      });
    }
    return summaries;
  }
});

/** The live invite, reused; a new one when none is live or `regenerate` (which expires the old). */
export const invite = mutation({
  args: { secret: v.string(), blendId: v.string(), userId: v.string(), code: v.string(), regenerate: v.boolean() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const blend = await blendOf(ctx, args.blendId);
    if (!blend || !(await membership(ctx, blend._id, args.userId))) return fail('notfound');
    const now = Date.now();
    const live = await liveInvite(ctx, blend._id, now);
    if (live && !args.regenerate) return { code: live.code, expiresAt: live.expiresAt };
    if (!isBlendInviteCode(args.code)) fail('invalid');
    const invites = await ctx.db.query('blendInvites').withIndex('by_blendId_and_createdAt', (q) => q.eq('blendId', blend._id)).order('desc').take(INVITE_HISTORY_MAX);
    if (live) await ctx.db.patch('blendInvites', live._id, { expiresAt: now });
    // Keep a bounded code history for expired-vs-unknown handling, plus the new active row.
    for (const old of invites.slice(INVITE_HISTORY_MAX - 1)) {
      if (old._id !== live?._id) await ctx.db.delete('blendInvites', old._id);
    }
    const expiresAt = now + BLEND_INVITE_DAYS * DAY_MS;
    const inviteId = await ctx.db.insert('blendInvites', { code: args.code, blendId: blend._id, createdBy: args.userId, createdAt: now, expiresAt });
    // A fresh link restarts a lone member's wait, so the sweep can't delete the Blend under it.
    await ctx.db.patch('blends', blend._id, { activeInviteId: inviteId, ...(blend.memberCount === 1 ? { waitingSince: now } : {}) });
    return { code: args.code, expiresAt };
  }
});

/**
 * What an invite link shows before joining. Unknown, malformed and expired codes all answer the
 * same `{ status: 'notfound' }`, so a guesser learns nothing (B3).
 */
export const preview = query({
  args: { secret: v.string(), code: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const invite = await inviteByCode(ctx, args.code);
    const blend = invite && invite.expiresAt > args.now ? await ctx.db.get('blends', invite.blendId) : null;
    if (!invite || !blend) return { status: 'notfound' as const };
    const inviter = (await membership(ctx, blend._id, invite.createdBy)) ?? (await membersOf(ctx, blend._id))[0];
    return {
      status: 'ok' as const,
      blendId: blend._id as string,
      inviterName: inviter?.displayName ?? 'Listener',
      memberCount: blend.memberCount,
      full: blend.memberCount >= BLEND_MAX_MEMBERS
    };
  }
});

export const join = mutation({
  args: { secret: v.string(), code: v.string(), userId: v.string(), displayName: v.string(), consent, learning: v.boolean() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const invite = await inviteByCode(ctx, args.code);
    const blend = invite ? await ctx.db.get('blends', invite.blendId) : null;
    if (!invite || !blend) return fail('notfound');
    if (await membership(ctx, blend._id, args.userId)) return { blendId: blend._id as string };
    if (invite.expiresAt <= Date.now()) fail('expired');
    // Read inside this transaction: two joins racing for the last seat cannot both win.
    if (blend.memberCount >= BLEND_MAX_MEMBERS) fail('full');
    if (await blendCount(ctx, args.userId) >= BLEND_MAX_PER_USER) fail('limit');
    const joiningProfile = await profileOf(ctx, args.userId);
    await ctx.db.insert('blendMembers', {
      blendId: blend._id,
      userId: args.userId,
      displayName: cleanName(args.displayName, BLEND_DISPLAY_NAME_MAX) || 'Listener',
      joinedAt: Date.now(),
      consent: args.consent,
      learning: args.learning && isProfileLearning(joiningProfile)
    });
    await ctx.db.patch('blends', blend._id, { memberCount: blend.memberCount + 1, waitingSince: undefined, ...invalidateBuild(blend) });
    return { blendId: blend._id as string };
  }
});

export const leave = mutation({
  args: { secret: v.string(), blendId: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const id = ctx.db.normalizeId('blends', args.blendId);
    if (!id || !(await leaveBlend(ctx, id, args.userId))) fail('notfound');
    return { left: true };
  }
});

/** Owner only; a non-owner is told the Blend was not found, never "forbidden". */
export const rename = mutation({
  args: { secret: v.string(), blendId: v.string(), userId: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const blend = await blendOf(ctx, args.blendId);
    if (!blend || blend.ownerId !== args.userId) return fail('notfound');
    const name = cleanName(args.name, BLEND_NAME_MAX);
    if (!name || args.name.trim().length > BLEND_NAME_MAX) fail('invalid');
    await ctx.db.patch('blends', blend._id, { name });
    return null;
  }
});

/** Compare-and-set: writes only over the version the builder read. */
export const saveBuild = mutation({
  args: {
    secret: v.string(),
    blendId: v.string(),
    expectedVersion: v.number(),
    expectedInputVersion: v.number(),
    leaseToken: v.optional(v.string()),
    builtFor: v.string(),
    tracks: v.array(blendTrack),
    pairs: v.array(pairMatch),
    together: v.optional(blendStorySong),
    gifts: v.array(blendGift),
    glue: v.array(v.string()),
    identities: v.array(v.string())
  },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const blend = await blendOf(ctx, args.blendId);
    if (!blend || blend.buildVersion !== args.expectedVersion || (blend.inputVersion ?? 0) !== args.expectedInputVersion) return { saved: false };
    if (blend.buildLease && blend.buildLease.expiresAt > Date.now() && blend.buildLease.token !== args.leaseToken) return { saved: false };
    const currentMembers = await membersOf(ctx, blend._id);
    for (const member of currentMembers) {
      const profile = await profileOf(ctx, member.userId);
      if (profile && member.learning !== isProfileLearning(profile)) return { saved: false };
    }
    const lease = blend.buildLease;
    if (lease && lease.expiresAt > Date.now() &&
      (lease.token !== args.leaseToken || lease.inputVersion !== args.expectedInputVersion || lease.builtFor !== args.builtFor)) return { saved: false };
    if (args.tracks.length > 50 || args.pairs.length > 15 || args.identities.length > 50 || args.gifts.length > 30 || args.glue.length > 50) fail('invalid');
    // Every name in the build must be a current member: a build read before a leave can't carry them.
    const memberIds = new Set(currentMembers.map((member) => member.userId));
    const known = (id: string): boolean => memberIds.has(id);
    if (!args.tracks.every((track) => track.for.every(known)) || !args.pairs.every((pair) => known(pair.a) && known(pair.b) && Number.isFinite(pair.match))
      || !args.gifts.every((gift) => known(gift.fromUserId) && known(gift.toUserId))) return { saved: false };
    // The identities of the last two builds: this one first, then the previous one.
    // The build being replaced is the first `tracks.length` identities: keep it and the new one only.
    const lastBuild = blend.previousTracks.slice(0, blend.tracks.length);
    const previousTracks = [...args.identities, ...lastBuild.filter((identity) => !args.identities.includes(identity))].slice(0, PREVIOUS_TRACKS_MAX);
    await ctx.db.patch('blends', blend._id, {
      builtFor: args.builtFor,
      tracks: args.tracks,
      previousPairs: blend.pairs.length > 0 ? blend.pairs : blend.previousPairs,
      pairs: args.pairs,
      previousTracks,
      together: args.together,
      gifts: args.gifts,
      glue: args.glue,
      buildVersion: blend.buildVersion + 1,
      stale: false,
      buildLease: undefined
    });
    return { saved: true };
  }
});

/** Claim one daily build for an input revision. The lease is advisory; saveBuild still fences inputs. */
export const claimBuild = mutation({
  args: { secret: v.string(), blendId: v.string(), userId: v.string(), inputVersion: v.number(), builtFor: v.string(), token: v.string(), leaseUntil: v.number() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const blend = await blendOf(ctx, args.blendId);
    if (!blend || !(await membership(ctx, blend._id, args.userId))) return { claimed: false };
    if ((blend.inputVersion ?? 0) !== args.inputVersion || (blend.builtFor === args.builtFor && !blend.stale)) return { claimed: false };
    const now = Date.now();
    if (blend.buildLease && blend.buildLease.expiresAt > now) return { claimed: false };
    await ctx.db.patch('blends', blend._id, {
      buildLease: { token: args.token.slice(0, 128), inputVersion: args.inputVersion, builtFor: args.builtFor, expiresAt: Math.min(Math.max(args.leaseUntil, now + 1), now + MAX_BUILD_LEASE_MS) }
    });
    return { claimed: true };
  }
});

export const releaseBuild = mutation({
  args: { secret: v.string(), blendId: v.string(), token: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const blend = await blendOf(ctx, args.blendId);
    if (blend?.buildLease?.token === args.token) await ctx.db.patch('blends', blend._id, { buildLease: undefined });
    return null;
  }
});

/** Learning switched on or off: every membership follows, and those Blends rebuild (D12). */
export const setLearning = mutation({
  args: { secret: v.string(), userId: v.string(), learning: v.boolean() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const rows = await ctx.db.query('blendMembers').withIndex('by_userId_and_joinedAt', (q) => q.eq('userId', args.userId)).take(BLEND_MAX_PER_USER);
    for (const row of rows) {
      if (row.learning === args.learning) continue;
      await ctx.db.patch('blendMembers', row._id, { learning: args.learning });
      const blend = await ctx.db.get('blends', row.blendId);
      if (blend) await ctx.db.patch('blends', row.blendId, invalidateBuild(blend));
    }
    return null;
  }
});

/** A member's new display name reaches every Blend they are in. */
export const renameMember = mutation({
  args: { secret: v.string(), userId: v.string(), displayName: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const displayName = cleanName(args.displayName, BLEND_DISPLAY_NAME_MAX) || 'Listener';
    const rows = await ctx.db.query('blendMembers').withIndex('by_userId_and_joinedAt', (q) => q.eq('userId', args.userId)).take(BLEND_MAX_PER_USER);
    for (const row of rows) if (row.displayName !== displayName) await ctx.db.patch('blendMembers', row._id, { displayName });
    return null;
  }
});

/** Daily: expired invites go; Blends nobody joined within the invite window go with their rows. */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db.query('blendInvites').withIndex('by_expiresAt', (q) => q.lte('expiresAt', now)).take(SWEEP_BATCH);
    for (const invite of expired) await ctx.db.delete('blendInvites', invite._id);
    const expiredOperations = await ctx.db.query('blendOperations').withIndex('by_expiresAt', (q) => q.lte('expiresAt', now)).take(SWEEP_BATCH);
    for (const operation of expiredOperations) await ctx.db.delete('blendOperations', operation._id);
    const lonely = await ctx.db
      .query('blends')
      // Timed from entering the one-member state, not creation: an old pair someone left gets a full invite window.
      .withIndex('by_memberCount_and_waitingSince', (q) => q.eq('memberCount', 1).gte('waitingSince', 0).lte('waitingSince', now - LONELY_AFTER_MS))
      .take(SWEEP_BATCH / 4);
    for (const blend of lonely) await deleteBlend(ctx, blend);
    if (expired.length === SWEEP_BATCH || expiredOperations.length === SWEEP_BATCH || lonely.length === SWEEP_BATCH / 4) {
      await ctx.scheduler.runAfter(0, internal.blends.sweep, {});
    }
    return null;
  }
});
