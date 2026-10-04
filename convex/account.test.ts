/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import presenceTest from '@convex-dev/presence/test';
import rateLimiterTest from '@convex-dev/rate-limiter/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ACCOUNT_RETENTION_DAYS, ACTIVE_TOUCH_DAYS, GUEST_RETENTION_DAYS } from '../packages/shared/legal';
import { api, internal } from './_generated/api';
import schema from './schema';

const modules = {
  ...import.meta.glob('./**/*.ts'),
  ...import.meta.glob('./_generated/*.js')
};

const secret = 'test-server-secret';
const DAY = 24 * 60 * 60 * 1000;

function backend() {
  const t = convexTest(schema, modules);
  presenceTest.register(t);
  rateLimiterTest.register(t);
  return t;
}

type Backend = ReturnType<typeof backend>;

function profile(userId: string, isGuest: boolean) {
  return { userId, isGuest, createdAt: '2026-09-01T00:00:00.000Z', libraries: [], likedSongIds: [], recentlyPlayed: [], settings: {} };
}

/** A signed-in account with something in every table the erase has to reach. Resolves to its user id. */
async function seedAccount(t: Backend, name: string, likes = 2): Promise<string> {
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert('users', { name, email: `${name}@example.test` });
    const sessionId = await ctx.db.insert('authSessions', { userId: id, expirationTime: Date.now() + DAY });
    await ctx.db.insert('authRefreshTokens', { sessionId, expirationTime: Date.now() + DAY });
    await ctx.db.insert('authAccounts', { userId: id, provider: 'google', providerAccountId: `google-${name}` });
    return id as string;
  });
  await t.mutation(api.profiles.save, { secret, user: { ...profile(userId, false), displayName: name, email: `${name}@example.test` } });
  await t.run(async (ctx) => {
    for (let index = 0; index < likes; index++) {
      await ctx.db.insert('libraryLikes', { userId, ref: `saavn:${name}-${index}`, liked: true, likedAt: index, updatedAt: index, rev: index + 1 });
    }
    await ctx.db.insert('libraryPlaylists', { userId, playlistId: 'p1', name: 'Late night', isPublic: true, createdAt: 1, deleted: false, updatedAt: 1, rev: likes + 1 });
    await ctx.db.insert('libraryItems', { userId, playlistId: 'p1', ref: 'saavn:a', addedAt: 1, deleted: false, updatedAt: 1, rev: likes + 2 });
    await ctx.db.insert('libraryState', { userId, rev: likes + 2 });
    await ctx.db.insert('shares', { code: `code${name}`, ownerId: userId, libraryId: 'p1', createdAt: '2026-09-02T00:00:00.000Z' });
  });
  await t.withIdentity({ subject: `${userId}|test-session` }).mutation(api.connect.register, {
    deviceId: `${name}-laptop`,
    name: `${name}'s laptop`,
    kind: 'web',
    appVersion: 'test',
    canPlay: true
  });
  return userId;
}

/** How many rows each table holds for this listener. */
async function rowsOf(t: Backend, userId: string): Promise<Record<string, number>> {
  return t.run(async (ctx) => {
    const authUserId = ctx.db.normalizeId('users', userId);
    const count = async (rows: Promise<unknown[]>): Promise<number> => (await rows).length;
    return {
      profiles: await count(ctx.db.query('profiles').withIndex('by_userId', (q) => q.eq('userId', userId)).take(10)),
      likes: await count(ctx.db.query('libraryLikes').withIndex('by_userId_and_ref', (q) => q.eq('userId', userId)).take(1000)),
      playlists: await count(ctx.db.query('libraryPlaylists').withIndex('by_userId_and_playlistId', (q) => q.eq('userId', userId)).take(10)),
      items: await count(ctx.db.query('libraryItems').withIndex('by_userId_and_playlistId_and_ref', (q) => q.eq('userId', userId)).take(10)),
      state: await count(ctx.db.query('libraryState').withIndex('by_userId', (q) => q.eq('userId', userId)).take(10)),
      shares: await count(ctx.db.query('shares').withIndex('by_owner_library', (q) => q.eq('ownerId', userId)).take(10)),
      devices: await count(ctx.db.query('devices').withIndex('by_userId_and_createdAt', (q) => q.eq('userId', userId)).take(10)),
      users: authUserId && (await ctx.db.get('users', authUserId)) ? 1 : 0,
      sessions: authUserId ? await count(ctx.db.query('authSessions').withIndex('userId', (q) => q.eq('userId', authUserId)).take(10)) : 0,
      accounts: authUserId ? await count(ctx.db.query('authAccounts').withIndex('userIdAndProvider', (q) => q.eq('userId', authUserId)).take(10)) : 0
    };
  });
}

const NOTHING = { profiles: 0, likes: 0, playlists: 0, items: 0, state: 0, shares: 0, devices: 0, users: 0, sessions: 0, accounts: 0 };

describe('account erase', () => {
  beforeEach(() => {
    vi.stubEnv('CONVEX_SERVER_SECRET', secret);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('removes everything held about one listener and nothing of anyone else', async () => {
    const t = backend();
    const asha = await seedAccount(t, 'asha');
    const ravi = await seedAccount(t, 'ravi');
    const before = await rowsOf(t, ravi);
    expect(await rowsOf(t, asha)).toEqual({ ...NOTHING, profiles: 1, likes: 2, playlists: 1, items: 1, state: 1, shares: 1, devices: 1, users: 1, sessions: 1, accounts: 1 });
    expect((await t.query(api.account.extras, { secret, userId: asha })).devices).toEqual([
      expect.objectContaining({ name: "asha's laptop", kind: 'web' })
    ]);

    await t.mutation(api.account.erase, { secret, userId: asha });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await rowsOf(t, asha)).toEqual(NOTHING);
    expect(await t.query(api.profiles.identity, { secret, userId: asha })).toBeNull();
    expect(await rowsOf(t, ravi)).toEqual(before);

    // Repeating it finds nothing and does not fail.
    await t.mutation(api.account.erase, { secret, userId: asha });
  });

  it('finishes a library too large for one pass', async () => {
    const t = backend();
    const asha = await seedAccount(t, 'asha', 450);

    await t.mutation(api.account.erase, { secret, userId: asha });
    // The profile and the sign-in session are gone at once; the rest follows.
    const first = await rowsOf(t, asha);
    expect(first.profiles).toBe(0);
    expect(first.sessions).toBe(0);
    expect(first.likes).toBe(250);
    expect(first.users).toBe(0);
    expect(await t.query(api.profiles.identity, { secret, userId: asha })).toBeNull();

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await rowsOf(t, asha)).toEqual(NOTHING);
  });

  it('marks an export incomplete rather than silently dropping extra shares', async () => {
    const t = backend();
    const userId = await seedAccount(t, 'export');
    await t.run(async ctx => {
      for (let index = 0; index < 100; index++) await ctx.db.insert('shares', { code: `extra${index}`, ownerId: userId, libraryId: `p${index}`, createdAt: '2026-10-02T00:00:00.000Z' });
    });
    const extras = await t.query(api.account.extras, { secret, userId });
    expect(extras.complete).toBe(false);
    expect(extras.shares).toHaveLength(100);
  });

  it('refuses a caller without the server secret', async () => {
    const t = backend();
    const asha = await seedAccount(t, 'asha');
    await expect(t.mutation(api.account.erase, { secret: 'wrong', userId: asha })).rejects.toThrow('Unauthorized');
    expect((await rowsOf(t, asha)).profiles).toBe(1);
  });
});

describe('retention sweep', () => {
  beforeEach(() => {
    vi.stubEnv('CONVEX_SERVER_SECRET', secret);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  async function insertProfile(t: Backend, userId: string, isGuest: boolean, lastActiveAt?: number) {
    await t.run(async (ctx) => {
      await ctx.db.insert('profiles', { ...profile(userId, isGuest), ...(lastActiveAt !== undefined ? { lastActiveAt } : {}) });
    });
  }

  async function remaining(t: Backend): Promise<string[]> {
    return t.run(async (ctx) => (await ctx.db.query('profiles').take(100)).map((row) => row.userId).sort());
  }

  it('keeps a guest until the policy period and touch interval have elapsed', async () => {
    const t = backend();
    const now = Date.parse('2026-10-01T00:00:00.000Z');
    vi.setSystemTime(new Date(now));
    await insertProfile(t, 'guest-inside-touch-slack', true, now - (GUEST_RETENTION_DAYS + ACTIVE_TOUCH_DAYS - 1) * DAY);

    await t.mutation(internal.account.sweepInactive, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await remaining(t)).toEqual(['guest-inside-touch-slack']);
  });

  it('erases a guest after the policy period and touch interval have elapsed', async () => {
    const t = backend();
    const now = Date.parse('2026-10-01T00:00:00.000Z');
    vi.setSystemTime(new Date(now));
    await insertProfile(t, 'guest-past-touch-slack', true, now - (GUEST_RETENTION_DAYS + ACTIVE_TOUCH_DAYS + 1) * DAY);

    await t.mutation(internal.account.sweepInactive, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await remaining(t)).toEqual([]);
  });

  it('keeps an account until the policy period and touch interval have elapsed', async () => {
    const t = backend();
    const now = Date.parse('2026-10-01T00:00:00.000Z');
    vi.setSystemTime(new Date(now));
    await insertProfile(t, 'account-inside-touch-slack', false, now - (ACCOUNT_RETENTION_DAYS + ACTIVE_TOUCH_DAYS - 1) * DAY);

    await t.mutation(internal.account.sweepInactive, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await remaining(t)).toEqual(['account-inside-touch-slack']);
  });

  it('erases an account after the policy period and touch interval have elapsed', async () => {
    const t = backend();
    const now = Date.parse('2026-10-01T00:00:00.000Z');
    vi.setSystemTime(new Date(now));
    await insertProfile(t, 'account-past-touch-slack', false, now - (ACCOUNT_RETENTION_DAYS + ACTIVE_TOUCH_DAYS + 1) * DAY);

    await t.mutation(internal.account.sweepInactive, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await remaining(t)).toEqual([]);
  });

  it('erases only profiles unused for longer than the policy allows', async () => {
    const t = backend();
    const now = Date.now();
    await insertProfile(t, 'guest-stale', true, now - (GUEST_RETENTION_DAYS + 1) * DAY);
    await insertProfile(t, 'guest-fresh', true, now - (GUEST_RETENTION_DAYS - 1) * DAY);
    // Written before the marker existed: never guessed at.
    await insertProfile(t, 'guest-legacy', true);
    // An account gets the longer period: old enough to drop a guest, not an account.
    await insertProfile(t, 'account-quiet', false, now - (GUEST_RETENTION_DAYS + 30) * DAY);
    await insertProfile(t, 'account-stale', false, now - (ACCOUNT_RETENTION_DAYS + 1) * DAY);

    const swept = await t.mutation(internal.account.sweepInactive, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(swept).toEqual({ guests: 1, accounts: 1 });
    expect(await remaining(t)).toEqual(['account-quiet', 'guest-fresh', 'guest-legacy']);
  });

  it('every profile write moves the last-active time on', async () => {
    const t = backend();
    vi.setSystemTime(new Date('2026-10-01T00:00:00.000Z'));
    await t.mutation(api.profiles.save, { secret, user: profile('guest-1', true) });
    const created = await t.run(async (ctx) => (await ctx.db.query('profiles').first())?.lastActiveAt);
    expect(created).toBe(Date.parse('2026-10-01T00:00:00.000Z'));

    vi.setSystemTime(new Date('2026-10-05T00:00:00.000Z'));
    expect(await t.mutation(api.profiles.update, { secret, user: { ...profile('guest-1', true), lastActiveAt: created }, expectedVersion: 0 })).toBe(true);
    const updated = await t.run(async (ctx) => (await ctx.db.query('profiles').first())?.lastActiveAt);
    expect(updated).toBe(Date.parse('2026-10-05T00:00:00.000Z'));
  });

  it('the backfill dates old profiles from what they already record', async () => {
    const t = backend();
    await t.run(async (ctx) => {
      await ctx.db.insert('profiles', {
        ...profile('played', true),
        recentlyPlayed: [{ songId: 's1', playDuration: 30, playedAt: '2026-09-20T10:00:00.000Z' }]
      });
      await ctx.db.insert('profiles', profile('untouched', true));
      await ctx.db.insert('profiles', { ...profile('already', true), lastActiveAt: 42 });
    });

    await t.mutation(internal.account.backfillLastActive, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const marks = await t.run(async (ctx) => Object.fromEntries((await ctx.db.query('profiles').take(10)).map((row) => [row.userId, row.lastActiveAt])));
    expect(marks).toEqual({
      played: Date.parse('2026-09-20T10:00:00.000Z'),
      untouched: Date.parse('2026-09-01T00:00:00.000Z'),
      already: 42
    });
  });
});

describe('reports', () => {
  beforeEach(() => vi.stubEnv('CONVEX_SERVER_SECRET', secret));
  afterEach(() => vi.unstubAllEnvs());

  it('files a report against a live link, and a takedown turns the link off', async () => {
    const t = backend();
    await t.mutation(api.shares.save, { secret, share: { code: 'abcd2345', ownerId: 'owner-1', libraryId: 'p1', createdAt: '2026-09-02T00:00:00.000Z' } });

    expect(await t.mutation(api.reports.file, { secret, code: 'zzzzzzzz', reason: 'abuse' })).toBe(false);
    expect(await t.mutation(api.reports.file, { secret, code: 'abcd2345', reason: 'copyright', details: 'My photo.' })).toBe(true);

    const open = await t.query(internal.reports.open, {});
    expect(open).toEqual([expect.objectContaining({ code: 'abcd2345', ownerId: 'owner-1', libraryId: 'p1', reason: 'copyright', details: 'My photo.', status: 'open' })]);

    expect(await t.mutation(internal.reports.takeDown, { code: 'abcd2345' })).toBe(1);
    expect(await t.query(api.shares.get, { secret, code: 'abcd2345' })).toBeNull();
    expect(await t.query(internal.reports.open, {})).toEqual([]);
  });
});
