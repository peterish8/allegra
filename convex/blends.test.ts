/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import presenceTest from '@convex-dev/presence/test';
import rateLimiterTest from '@convex-dev/rate-limiter/test';
import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BLEND_MAX_MEMBERS, BLEND_MAX_PER_USER } from '../packages/shared/blendLimits';
import { api, internal } from './_generated/api';
import schema from './schema';

const modules = {
  ...import.meta.glob('./**/*.ts'),
  ...import.meta.glob('./_generated/*.js')
};

const secret = 'test-server-secret';
const DAY = 24 * 60 * 60 * 1000;
const consent = { policyVersion: '2026-10-05', at: 1 };

function backend() {
  const t = convexTest(schema, modules);
  presenceTest.register(t);
  rateLimiterTest.register(t);
  return t;
}
type Backend = ReturnType<typeof backend>;

let codes = 0;
/** A fresh, valid 12-character invite code. */
const code = (): string => `abcdefgh${String(1000 + codes++).replace(/[01]/g, 'k')}`.slice(0, 12).padEnd(12, 'z');

async function create(t: Backend, userId: string, name = 'Our Blend') {
  return t.mutation(api.blends.create, { secret, userId, displayName: userId, name, consent, learning: true, code: code() });
}
async function join(t: Backend, invite: string, userId: string) {
  return t.mutation(api.blends.join, { secret, code: invite, userId, displayName: userId, consent, learning: true });
}
async function codeOf(error: Promise<unknown>): Promise<string | undefined> {
  try {
    await error;
  } catch (thrown) {
    if (thrown instanceof ConvexError) return (thrown.data as { code?: string }).code;
    throw thrown;
  }
  return undefined;
}
const blendRow = (t: Backend, blendId: string) => t.run(async (ctx) => {
  const id = ctx.db.normalizeId('blends', blendId);
  return id ? ctx.db.get('blends', id) : null;
});

describe('blends', () => {
  beforeEach(() => {
    vi.stubEnv('CONVEX_SERVER_SECRET', secret);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-05T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('a join on a full Blend fails with full', async () => {
    const t = backend();
    const blend = await create(t, 'asha');
    for (let n = 1; n < BLEND_MAX_MEMBERS; n++) await join(t, blend.code, `member${n}`);
    expect((await blendRow(t, blend.blendId))?.memberCount).toBe(BLEND_MAX_MEMBERS);
    expect(await codeOf(join(t, blend.code, 'one-too-many'))).toBe('full');
  });

  it('a full group hands ownership on and is deleted only when the last member leaves', async () => {
    const t = backend();
    const blend = await create(t, 'asha');
    const others = Array.from({ length: BLEND_MAX_MEMBERS - 1 }, (_, n) => `member${n + 1}`);
    for (const userId of others) {
      vi.advanceTimersByTime(1000);
      await join(t, blend.code, userId);
    }
    await t.mutation(api.blends.leave, { secret, blendId: blend.blendId, userId: 'asha' });
    const after = await blendRow(t, blend.blendId);
    expect(after?.ownerId).toBe(others[0]);
    expect(after?.memberCount).toBe(BLEND_MAX_MEMBERS - 1);
    expect(after?.stale).toBe(true);
    for (const userId of others) await t.mutation(api.blends.leave, { secret, blendId: blend.blendId, userId });
    expect(await blendRow(t, blend.blendId)).toBeNull();
  });

  it('a 21st Blend, created or joined, fails with limit', async () => {
    const t = backend();
    for (let n = 0; n < BLEND_MAX_PER_USER; n++) await create(t, 'asha', `B${n}`);
    expect(await codeOf(create(t, 'asha'))).toBe('limit');
    const other = await create(t, 'ravi');
    expect(await codeOf(join(t, other.code, 'asha'))).toBe('limit');
  });

  it('joining a Blend you are in returns it unchanged', async () => {
    const t = backend();
    const blend = await create(t, 'asha');
    await join(t, blend.code, 'ravi');
    const before = await blendRow(t, blend.blendId);
    expect(await join(t, blend.code, 'ravi')).toEqual({ blendId: blend.blendId });
    expect(await join(t, blend.code, 'asha')).toEqual({ blendId: blend.blendId });
    expect(await blendRow(t, blend.blendId)).toEqual(before);
  });

  it('an owner leaving hands ownership to the earliest remaining member', async () => {
    const t = backend();
    const blend = await create(t, 'asha');
    vi.advanceTimersByTime(1000);
    await join(t, blend.code, 'ravi');
    await t.mutation(api.blends.leave, { secret, blendId: blend.blendId, userId: 'asha' });
    const row = await blendRow(t, blend.blendId);
    expect(row?.ownerId).toBe('ravi');
    expect(row?.memberCount).toBe(1);
  });

  it('the last member leaving deletes the Blend, its members and its invites', async () => {
    const t = backend();
    const blend = await create(t, 'asha');
    await t.mutation(api.blends.leave, { secret, blendId: blend.blendId, userId: 'asha' });
    const left = await t.run(async (ctx) => ({
      blends: (await ctx.db.query('blends').take(10)).length,
      members: (await ctx.db.query('blendMembers').take(10)).length,
      invites: (await ctx.db.query('blendInvites').take(10)).length
    }));
    expect(left).toEqual({ blends: 0, members: 0, invites: 0 });
    expect(await codeOf(t.mutation(api.blends.leave, { secret, blendId: blend.blendId, userId: 'asha' }))).toBe('notfound');
  });

  it('any join or leave marks the Blend stale', async () => {
    const t = backend();
    const blend = await create(t, 'asha');
    await join(t, blend.code, 'ravi');
    await t.mutation(api.blends.saveBuild, { secret, blendId: blend.blendId, expectedVersion: 0, expectedInputVersion: 1, builtFor: '2026-10-05', tracks: [], pairs: [], gifts: [], glue: [], identities: [] });
    expect((await blendRow(t, blend.blendId))?.stale).toBe(false);
    await t.mutation(api.blends.leave, { secret, blendId: blend.blendId, userId: 'ravi' });
    expect((await blendRow(t, blend.blendId))?.stale).toBe(true);
  });

  it('invite reuses the live link, and regenerating expires the old one', async () => {
    const t = backend();
    const blend = await create(t, 'asha');
    const same = await t.mutation(api.blends.invite, { secret, blendId: blend.blendId, userId: 'asha', code: code(), regenerate: false });
    expect(same.code).toBe(blend.code);
    expect(same.expiresAt).toBe(Date.now() + 7 * DAY);
    const fresh = await t.mutation(api.blends.invite, { secret, blendId: blend.blendId, userId: 'asha', code: code(), regenerate: true });
    expect(fresh.code).not.toBe(blend.code);
    expect(await codeOf(join(t, blend.code, 'ravi'))).toBe('expired');
    expect(await join(t, fresh.code, 'ravi')).toEqual({ blendId: blend.blendId });
    expect(await codeOf(t.mutation(api.blends.invite, { secret, blendId: blend.blendId, userId: 'meera', code: code(), regenerate: false }))).toBe('notfound');
  });

  it('preview of an unknown, expired or malformed code is the same notfound', async () => {
    const t = backend();
    const blend = await create(t, 'asha');
    const now = Date.now();
    expect(await t.query(api.blends.preview, { secret, code: blend.code, now })).toEqual({
      status: 'ok', blendId: blend.blendId, inviterName: 'asha', memberCount: 1, full: false
    });
    const notfound = { status: 'notfound' };
    expect(await t.query(api.blends.preview, { secret, code: 'zzzzzzzzzzzz', now })).toEqual(notfound);
    expect(await t.query(api.blends.preview, { secret, code: 'NOT-A-CODE', now })).toEqual(notfound);
    expect(await t.query(api.blends.preview, { secret, code: blend.code, now: now + 8 * DAY })).toEqual(notfound);
  });

  it('saveBuild writes only over the version it read', async () => {
    const t = backend();
    const blend = await create(t, 'asha');
    const build = { secret, blendId: blend.blendId, expectedInputVersion: 0, builtFor: '2026-10-05', tracks: [], pairs: [], gifts: [], glue: [], identities: ['x|y'] };
    expect(await t.mutation(api.blends.saveBuild, { ...build, expectedVersion: 0 })).toEqual({ saved: true });
    expect(await t.mutation(api.blends.saveBuild, { ...build, expectedVersion: 0 })).toEqual({ saved: false });
    const row = await blendRow(t, blend.blendId);
    expect(row?.buildVersion).toBe(1);
    expect(row?.previousTracks).toEqual(['x|y']);
  });

  it('create is idempotent across concurrent retries and rejects conflicting key reuse', async () => {
    const t = backend();
    const input = { secret, userId: 'asha', displayName: 'Asha', name: 'Our Blend', consent, learning: true, operationId: 'concurrent-create-123' };
    const [first, retry] = await Promise.all([
      t.mutation(api.blends.create, { ...input, code: code() }),
      t.mutation(api.blends.create, { ...input, code: code() })
    ]);
    expect(retry).toEqual(first);
    expect(await t.run(async (ctx) => ctx.db.query('blends').take(10))).toHaveLength(1);
    await expect(t.mutation(api.blends.create, { ...input, name: 'Different', code: code() })).rejects.toThrow();
  });

  it('the sweep removes expired invites and Blends nobody joined', async () => {
    const t = backend();
    const lonely = await create(t, 'asha');
    const paired = await create(t, 'ravi');
    await join(t, paired.code, 'meera');
    vi.advanceTimersByTime(8 * DAY);
    await t.mutation(internal.blends.sweep, {});
    expect(await blendRow(t, lonely.blendId)).toBeNull();
    expect(await blendRow(t, paired.blendId)).not.toBeNull();
    expect(await t.run(async (ctx) => (await ctx.db.query('blendInvites').take(10)).length)).toBe(0);
  });

  it('only the owner can rename; others are told it was not found', async () => {
    const t = backend();
    const blend = await create(t, 'asha');
    await join(t, blend.code, 'ravi');
    await t.mutation(api.blends.rename, { secret, blendId: blend.blendId, userId: 'asha', name: '  Road  trip ' });
    expect((await blendRow(t, blend.blendId))?.name).toBe('Road trip');
    expect(await codeOf(t.mutation(api.blends.rename, { secret, blendId: blend.blendId, userId: 'ravi', name: 'x' }))).toBe('notfound');
    expect(await codeOf(t.mutation(api.blends.rename, { secret, blendId: blend.blendId, userId: 'asha', name: '   ' }))).toBe('invalid');
  });

  it('get answers null for a non-member or a malformed id', async () => {
    const t = backend();
    const blend = await create(t, 'asha');
    expect(await t.query(api.blends.get, { secret, blendId: blend.blendId, userId: 'ravi' })).toBeNull();
    expect(await t.query(api.blends.get, { secret, blendId: 'nonsense', userId: 'asha' })).toBeNull();
    const mine = await t.query(api.blends.get, { secret, blendId: blend.blendId, userId: 'asha' });
    expect(mine?.members.map((member) => member.userId)).toEqual(['asha']);
    expect((await t.query(api.blends.listForUser, { secret, userId: 'asha' })).map((row) => row.id)).toEqual([blend.blendId]);
  });

  it('turning learning off reaches every membership and marks those Blends stale', async () => {
    const t = backend();
    const blend = await create(t, 'asha');
    await t.mutation(api.blends.saveBuild, { secret, blendId: blend.blendId, expectedVersion: 0, expectedInputVersion: 0, builtFor: '2026-10-05', tracks: [], pairs: [], gifts: [], glue: [], identities: [] });
    await t.mutation(api.blends.setLearning, { secret, userId: 'asha', learning: false });
    const mine = await t.query(api.blends.get, { secret, blendId: blend.blendId, userId: 'asha' });
    expect(mine?.members[0]?.learning).toBe(false);
    expect(mine?.stale).toBe(true);
  });

  it('profile learning-off atomically fences memberships, stored output, and tally rows', async () => {
    const t = backend();
    const user = {
      userId: 'asha', isGuest: false, createdAt: new Date(0).toISOString(), libraries: [], likedSongIds: [],
      recentlyPlayed: [], settings: { personalization: true }
    };
    await t.run(async (ctx) => ctx.db.insert('profiles', user));
    const blend = await create(t, 'asha');
    const track = { song: { ref: 'saavn:secret', title: 'Secret', artist: 'Private', artwork: '', duration: 60 }, for: ['asha'], kind: 'discovery' as const };
    await t.mutation(api.blends.saveBuild, { secret, blendId: blend.blendId, expectedVersion: 0, expectedInputVersion: 0, builtFor: '2026-10-05', tracks: [track], pairs: [], gifts: [], glue: [], identities: ['private|song'] });
    await t.run(async (ctx) => {
      await ctx.db.insert('tasteSongs', { userId: 'asha', identity: 'private|song', ref: 'saavn:secret', title: 'Secret', artist: 'Private', artwork: '', duration: 60, score: 10, likeBonus: true, recentListens: [], updatedAt: Date.now() });
      await ctx.db.insert('tasteMeta', { userId: 'asha', songCount: 1, updatedAt: Date.now() });
    });
    const changed = { ...user, settings: { personalization: false } };
    expect(await t.mutation(api.profiles.update, { secret, user: changed, expectedVersion: 0 })).toBe(true);
    const stored = await t.query(api.blends.get, { secret, blendId: blend.blendId, userId: 'asha' });
    expect(stored?.members[0]?.learning).toBe(false);
    expect(stored?.tracks).toEqual([]);
    expect(stored?.stale).toBe(true);
    expect(await t.run(async (ctx) => ctx.db.query('tasteSongs').withIndex('by_userId_and_identity', (q) => q.eq('userId', 'asha')).take(10))).toEqual([]);
    expect(await t.run(async (ctx) => ctx.db.query('tasteMeta').withIndex('by_userId', (q) => q.eq('userId', 'asha')).unique())).toBeNull();
  });

  it('every function refuses a wrong secret', async () => {
    const t = backend();
    await expect(t.query(api.blends.listForUser, { secret: 'nope', userId: 'asha' })).rejects.toThrow();
    await expect(t.mutation(api.blends.create, { secret: 'nope', userId: 'asha', displayName: 'a', name: 'b', consent, learning: true, code: code() })).rejects.toThrow();
  });
});
