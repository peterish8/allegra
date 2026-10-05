/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import presenceTest from '@convex-dev/presence/test';
import rateLimiterTest from '@convex-dev/rate-limiter/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api, internal } from './_generated/api';
import schema from './schema';

const modules = {
  ...import.meta.glob('./**/*.ts'),
  ...import.meta.glob('./_generated/*.js')
};

const DAY = 24 * 60 * 60 * 1000;

function backend() {
  const t = convexTest(schema, modules);
  presenceTest.register(t);
  rateLimiterTest.register(t);
  return t;
}

type Backend = ReturnType<typeof backend>;

async function insertReport(
  t: Backend,
  input: { code: string; status: 'open' | 'closed'; closedAt?: number }
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('reports', {
      code: input.code,
      ownerId: 'listener',
      libraryId: 'playlist',
      reason: 'other',
      details: 'What happened',
      contact: 'listener@example.test',
      createdAt: Date.parse('2026-09-01T00:00:00.000Z'),
      status: input.status,
      ...(input.closedAt === undefined ? {} : { closedAt: input.closedAt })
    });
  });
}

async function report(t: Backend, code: string) {
  return t.run(async (ctx) => ctx.db.query('reports').withIndex('by_code', (q) => q.eq('code', code)).unique());
}

describe('closed report retention', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-04T00:00:00.000Z'));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('sets closedAt when a share is taken down', async () => {
    const t = backend();
    await t.run(async (ctx) => {
      await ctx.db.insert('shares', { code: 'take-down', ownerId: 'listener', libraryId: 'playlist', createdAt: '2026-09-01T00:00:00.000Z' });
    });
    await insertReport(t, { code: 'take-down', status: 'open' });

    await t.mutation(internal.reports.takeDown, { code: 'take-down' });

    expect(await report(t, 'take-down')).toMatchObject({ status: 'closed', closedAt: Date.now() });
  });

  it('sets closedAt when a report is dismissed', async () => {
    const t = backend();
    await insertReport(t, { code: 'dismiss', status: 'open' });

    await t.mutation(internal.reports.dismiss, { code: 'dismiss' });

    expect(await report(t, 'dismiss')).toMatchObject({ status: 'closed', closedAt: Date.now() });
  });

  it('timestamps an already-closed report that predates the migration', async () => {
    const t = backend();
    await insertReport(t, { code: 'legacy-close', status: 'closed' });

    await t.mutation(internal.reports.dismiss, { code: 'legacy-close' });

    expect(await report(t, 'legacy-close')).toMatchObject({ status: 'closed', closedAt: Date.now() });
  });

  it('backfills legacy closed reports at migration time and leaves them readable for a year', async () => {
    const t = backend();
    await insertReport(t, { code: 'legacy-closed', status: 'closed' });
    await insertReport(t, { code: 'still-open', status: 'open' });

    await t.mutation(internal.retention.backfillClosedReports, { cursor: null });

    expect(await report(t, 'legacy-closed')).toMatchObject({ status: 'closed', closedAt: Date.now(), details: 'What happened', contact: 'listener@example.test' });
    expect(await report(t, 'still-open')).toMatchObject({ status: 'open', details: 'What happened', contact: 'listener@example.test' });
  });

  it('removes contact and details after a year but keeps the report record', async () => {
    const t = backend();
    const now = Date.now();
    await insertReport(t, { code: 'old', status: 'closed', closedAt: now - 366 * DAY });
    await insertReport(t, { code: 'recent', status: 'closed', closedAt: now - 364 * DAY });
    await insertReport(t, { code: 'open', status: 'open' });

    await t.mutation(internal.retention.trimClosedReports, {});

    expect(await report(t, 'old')).toMatchObject({
      code: 'old', reason: 'other', status: 'closed', createdAt: Date.parse('2026-09-01T00:00:00.000Z'), closedAt: now - 366 * DAY
    });
    expect((await report(t, 'old'))?.details).toBeUndefined();
    expect((await report(t, 'old'))?.contact).toBeUndefined();
    expect(await report(t, 'recent')).toMatchObject({ details: 'What happened', contact: 'listener@example.test' });
    expect(await report(t, 'open')).toMatchObject({ details: 'What happened', contact: 'listener@example.test' });
  });

  it('finishes expired reports across bounded pages without reprocessing trimmed rows forever', async () => {
    const t = backend();
    const closedAt = Date.now() - 366 * DAY;
    await t.run(async (ctx) => {
      for (let index = 0; index < 401; index += 1) {
        await ctx.db.insert('reports', {
          code: `old-${index}`,
          ownerId: 'listener',
          libraryId: 'playlist',
          reason: 'other',
          details: 'What happened',
          contact: 'listener@example.test',
          createdAt: Date.parse('2026-09-01T00:00:00.000Z'),
          status: 'closed',
          closedAt
        });
      }
    });

    await t.mutation(internal.retention.trimClosedReports, {});
    await t.finishAllScheduledFunctions(() => { vi.runAllTimers(); });

    for (const code of ['old-0', 'old-200', 'old-400']) {
      expect((await report(t, code))?.details).toBeUndefined();
      expect((await report(t, code))?.contact).toBeUndefined();
    }
  });
});

describe('library tombstone retention and resync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-05T00:00:00.000Z'));
    vi.stubEnv('CONVEX_SERVER_SECRET', 'test-secret');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('prunes only 90-day-old tombstones by updatedAt and records the highest revision', async () => {
    const t = backend();
    const now = Date.now();
    const old = now - 91 * DAY;
    const recent = now - 89 * DAY;
    await t.run(async (ctx) => {
      await ctx.db.insert('libraryState', { userId: 'listener', rev: 20, prunedRev: 3 });
      await ctx.db.insert('libraryLikes', { userId: 'listener', ref: 'saavn:old-like', liked: false, likedAt: old - 100 * DAY, updatedAt: old, rev: 12 });
      await ctx.db.insert('libraryLikes', { userId: 'listener', ref: 'saavn:recent-unlike', liked: false, likedAt: old, updatedAt: recent, rev: 15 });
      await ctx.db.insert('libraryLikes', { userId: 'listener', ref: 'saavn:live-like', liked: true, likedAt: old, updatedAt: old, rev: 16 });
      await ctx.db.insert('libraryPlaylists', {
        userId: 'listener', playlistId: 'old-playlist', name: 'Old', isPublic: false, createdAt: old,
        deleted: true, updatedAt: old, rev: 18
      });
      await ctx.db.insert('libraryPlaylists', {
        userId: 'listener', playlistId: 'live-playlist', name: 'Live', isPublic: false, createdAt: old,
        deleted: false, updatedAt: old, rev: 19
      });
      await ctx.db.insert('libraryItems', {
        userId: 'listener', playlistId: 'live-playlist', ref: 'saavn:old-item', addedAt: old,
        deleted: true, updatedAt: old, rev: 20
      });
      await ctx.db.insert('libraryItems', {
        userId: 'listener', playlistId: 'live-playlist', ref: 'saavn:recent-item', addedAt: old,
        deleted: true, updatedAt: recent, rev: 21
      });
    });

    expect(await t.mutation(internal.retention.pruneLibraryTombstones, {})).toEqual({ pruned: 3, done: true });
    const remaining = await t.run(async (ctx) => ({
      state: await ctx.db.query('libraryState').withIndex('by_userId', (q) => q.eq('userId', 'listener')).unique(),
      likes: await ctx.db.query('libraryLikes').collect(),
      playlists: await ctx.db.query('libraryPlaylists').collect(),
      items: await ctx.db.query('libraryItems').collect()
    }));
    expect(remaining.state?.prunedRev).toBe(20);
    expect(remaining.likes.map((row) => row.ref).sort()).toEqual(['saavn:live-like', 'saavn:recent-unlike']);
    expect(remaining.playlists.map((row) => row.playlistId)).toEqual(['live-playlist']);
    expect(remaining.items.map((row) => row.ref)).toEqual(['saavn:recent-item']);
  });

  it('restarts stale cursors from live revision zero and pages forward without repeating', async () => {
    const t = backend();
    await t.run(async (ctx) => {
      await ctx.db.insert('libraryState', { userId: 'listener', rev: 8, prunedRev: 6 });
      await ctx.db.insert('libraryLikes', { userId: 'listener', ref: 'saavn:live-a', liked: true, likedAt: 1, updatedAt: 1, rev: 2 });
      await ctx.db.insert('libraryLikes', { userId: 'listener', ref: 'saavn:live-b', liked: true, likedAt: 2, updatedAt: 2, rev: 3 });
      await ctx.db.insert('libraryLikes', { userId: 'listener', ref: 'saavn:live-c', liked: true, likedAt: 7, updatedAt: 7, rev: 7 });
    });

    const first = await t.query(api.library.changes, { secret: 'test-secret', userId: 'listener', since: 5, limit: 1 });
    expect(first).toMatchObject({ resync: true, more: true, changes: [{ ref: 'saavn:live-a', rev: 2 }] });
    const revisions = [...first.changes.map((change) => change.rev)];
    let since = first.rev;
    let more = first.more;
    while (more) {
      const page = await t.query(api.library.changes, { secret: 'test-secret', userId: 'listener', since, limit: 1, resync: true });
      expect(page.resync).toBe(true);
      revisions.push(...page.changes.map((change) => change.rev));
      since = page.rev;
      more = page.more;
    }
    expect(revisions).toEqual([2, 3, 7]);

    const current = await t.query(api.library.changes, { secret: 'test-secret', userId: 'listener', since: 6, limit: 10 });
    expect(current).toMatchObject({ changes: [{ ref: 'saavn:live-c', rev: 7 }] });
    expect(current.resync).toBeUndefined();
  });
});
