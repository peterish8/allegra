/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { addDecayed, currentWeight } from '../packages/shared/blendDecay';
import { identityKey } from '../packages/shared/identity';
import { api, internal } from './_generated/api';
import schema from './schema';

const modules = {
  ...import.meta.glob('./**/*.ts'),
  ...import.meta.glob('./_generated/*.js')
};

const secret = 'test-server-secret';
const NOW = Date.UTC(2026, 9, 3);
const DAY = 24 * 60 * 60 * 1000;

function backend() {
  return convexTest(schema, modules);
}

function song(n: number) {
  return {
    ref: `saavn:s${n}`,
    title: `Song ${n}`,
    artist: `Artist ${n % 7}`,
    artwork: 'https://c.saavncdn.com/x.jpg',
    duration: 60_000
  };
}

async function top(t: ReturnType<typeof backend>, userId: string) {
  return t.query(api.taste.top, { secret, userId, limit: 200 });
}

async function metaRow(t: ReturnType<typeof backend>, userId: string) {
  return t.run(async (ctx) => ctx.db.query('tasteMeta').withIndex('by_userId', (q) => q.eq('userId', userId)).unique());
}

describe('taste tally', () => {
  beforeEach(() => {
    vi.stubEnv('CONVEX_SERVER_SECRET', secret);
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('adds minutes heard at the listen timestamp', async () => {
    const t = backend();
    const playedAt = NOW - 3 * DAY;
    expect(await t.mutation(api.taste.record, {
      secret, userId: 'listener', song: song(1), secondsHeard: 120, playedAt
    })).toEqual({ applied: true });

    const [entry] = await top(t, 'listener');
    expect(entry?.identity).toBe(identityKey(song(1).title, song(1).artist));
    expect(currentWeight(entry?.score ?? 0, playedAt)).toBeCloseTo(2, 10);
  });

  it('ignores a repeated playedAt for the same song', async () => {
    const t = backend();
    const input = { secret, userId: 'listener', song: song(1), secondsHeard: 120, playedAt: NOW - DAY };
    expect(await t.mutation(api.taste.record, input)).toEqual({ applied: true });
    expect(await t.mutation(api.taste.record, input)).toEqual({ applied: false });
    const [entry] = await top(t, 'listener');
    expect(currentWeight(entry?.score ?? 0, input.playedAt)).toBeCloseTo(2, 10);
  });

  it('keeps only the most recent eight listen timestamps', async () => {
    const t = backend();
    const start = NOW - 20 * DAY;
    for (let index = 0; index < 8; index += 1) {
      await t.mutation(api.taste.record, {
        secret, userId: 'listener', song: song(1), secondsHeard: 60, playedAt: start + index * 1000
      });
    }
    await t.mutation(api.taste.record, {
      secret, userId: 'listener', song: song(1), secondsHeard: 60, playedAt: start + 8_000
    });

    const row = await t.run(async (ctx) => ctx.db.query('tasteSongs')
      .withIndex('by_userId_and_identity', (q) => q.eq('userId', 'listener').eq('identity', identityKey(song(1).title, song(1).artist)))
      .unique());
    expect(row?.recentListens).toEqual(Array.from({ length: 8 }, (_, index) => start + (index + 1) * 1000));
  });

  it('caps a listener at 200 rows and evicts the lowest score', async () => {
    const t = backend();
    for (let index = 1; index <= 201; index += 1) {
      await t.mutation(api.taste.record, {
        secret, userId: 'listener', song: song(index), secondsHeard: index * 60, playedAt: NOW
      });
    }

    const entries = await top(t, 'listener');
    expect(entries).toHaveLength(200);
    expect(entries.some((entry) => entry.identity === identityKey(song(1).title, song(1).artist))).toBe(false);
    expect(await metaRow(t, 'listener')).toMatchObject({ songCount: 200 });
  });

  it('deletes a row when a skip brings its score to zero', async () => {
    const t = backend();
    const identity = identityKey(song(1).title, song(1).artist);
    await t.mutation(api.taste.record, { secret, userId: 'listener', song: song(1), secondsHeard: 30, playedAt: NOW - 1_000 });
    await t.mutation(api.taste.record, { secret, userId: 'listener', song: song(1), secondsHeard: 0, playedAt: NOW });

    const row = await t.run(async (ctx) => ctx.db.query('tasteSongs')
      .withIndex('by_userId_and_identity', (q) => q.eq('userId', 'listener').eq('identity', identity))
      .unique());
    expect(row).toBeNull();
    expect(await metaRow(t, 'listener')).toMatchObject({ songCount: 0 });
  });

  it('removes the original delayed like bonus without changing other listens', async () => {
    const t = backend();
    const picked = song(1);
    const firstListenAt = NOW - 20 * DAY;
    const likeAt = NOW - 12 * DAY;
    const secondListenAt = NOW - 5 * DAY;
    await t.mutation(api.taste.record, {
      secret, userId: 'listener', song: picked, secondsHeard: 120, playedAt: firstListenAt
    });
    await t.mutation(api.taste.bonus, { secret, userId: 'listener', song: picked, kind: 'like', at: likeAt });
    await t.mutation(api.taste.record, {
      secret, userId: 'listener', song: picked, secondsHeard: 180, playedAt: secondListenAt
    });
    const beforeLikeScore = addDecayed(0, 2, firstListenAt) + addDecayed(0, 3, secondListenAt);

    await t.mutation(api.taste.bonus, { secret, userId: 'listener', song: picked, kind: 'like', at: NOW - 10 * DAY });
    await t.mutation(api.taste.bonus, { secret, userId: 'listener', song: picked, kind: 'unlike', at: NOW });
    const [afterUnlike] = await top(t, 'listener');
    expect(afterUnlike?.score).toBeCloseTo(beforeLikeScore, 9);

    const row = await t.run(async (ctx) => ctx.db.query('tasteSongs')
      .withIndex('by_userId_and_identity', (q) => q.eq('userId', 'listener').eq('identity', identityKey(picked.title, picked.artist)))
      .unique());
    expect(row).toMatchObject({ likeBonus: false });
    expect(row?.likeBonusAt).toBeUndefined();
    await t.mutation(api.taste.bonus, { secret, userId: 'listener', song: picked, kind: 'unlike', at: NOW });
    const [afterRepeatedUnlike] = await top(t, 'listener');
    expect(afterRepeatedUnlike?.score).toBeCloseTo(beforeLikeScore, 9);
  });

  it('adds a playlist bonus to a song that has no tally row yet', async () => {
    const t = backend();
    await t.mutation(api.taste.bonus, {
      secret, userId: 'listener', song: song(4), kind: 'playlistAdd', at: NOW - 2 * DAY
    });
    const [entry] = await top(t, 'listener');
    expect(entry?.identity).toBe(identityKey(song(4).title, song(4).artist));
    expect(currentWeight(entry?.score ?? 0, NOW - 2 * DAY)).toBeCloseTo(5, 10);
  });

  it('learning-off profile blocks late tally writes and hides previously stored taste', async () => {
    const t = backend();
    await t.mutation(api.taste.record, { secret, userId: 'listener', song: song(1), secondsHeard: 120, playedAt: NOW - DAY });
    await t.run(async (ctx) => ctx.db.insert('profiles', {
      userId: 'listener', isGuest: false, createdAt: new Date(0).toISOString(), libraries: [], likedSongIds: [], recentlyPlayed: [], settings: { personalization: false }
    }));
    expect(await t.mutation(api.taste.record, { secret, userId: 'listener', song: song(2), secondsHeard: 120, playedAt: NOW })).toEqual({ applied: false });
    await t.mutation(api.taste.bonus, { secret, userId: 'listener', song: song(2), kind: 'like', at: NOW });
    expect(await top(t, 'listener')).toEqual([]);
  });

  it('stable play IDs add cumulative duration deltas without duplicate checkpoint weight', async () => {
    const t = backend();
    const playId = 'play-session-1';
    expect(await t.mutation(api.taste.record, { secret, userId: 'listener', song: song(1), secondsHeard: 30, playedAt: NOW - DAY, playId })).toEqual({ applied: true });
    expect(await t.mutation(api.taste.record, { secret, userId: 'listener', song: song(1), secondsHeard: 30, playedAt: NOW, playId })).toEqual({ applied: false });
    expect(await t.mutation(api.taste.record, { secret, userId: 'listener', song: song(1), secondsHeard: 90, playedAt: NOW, playId })).toEqual({ applied: true });
    const [entry] = await top(t, 'listener');
    expect(currentWeight(entry?.score ?? 0, NOW - DAY)).toBeCloseTo(1.5, 8);
  });

  it('seeds likes, playlist items and recents once per listener', async () => {
    const t = backend();
    const input = {
      secret,
      userId: 'listener',
      likes: [{ song: song(1), at: NOW - DAY }],
      items: [{ song: song(2), at: NOW - 2 * DAY }],
      recents: [{ song: song(3), at: NOW - 3 * DAY }]
    };
    await t.mutation(api.taste.seed, input);
    const first = await top(t, 'listener');
    await t.mutation(api.taste.seed, {
      ...input,
      likes: [{ song: song(4), at: NOW }]
    });
    const second = await top(t, 'listener');

    expect(first.map((entry) => entry.identity).sort()).toEqual([
      identityKey(song(1).title, song(1).artist),
      identityKey(song(2).title, song(2).artist),
      identityKey(song(3).title, song(3).artist)
    ].sort());
    expect(second).toEqual(first);
    expect(await metaRow(t, 'listener')).toMatchObject({ seededAt: NOW });
    const byIdentity = new Map(first.map((entry) => [entry.identity, entry.score]));
    expect(currentWeight(byIdentity.get(identityKey(song(1).title, song(1).artist)) ?? 0, NOW - DAY)).toBeCloseTo(10, 10);
    expect(currentWeight(byIdentity.get(identityKey(song(2).title, song(2).artist)) ?? 0, NOW - 2 * DAY)).toBeCloseTo(5, 10);
    expect(currentWeight(byIdentity.get(identityKey(song(3).title, song(3).artist)) ?? 0, NOW - 3 * DAY)).toBeCloseTo(3, 10);
  });

  it('an unlike removes a like bonus first introduced by the one-time seed', async () => {
    const t = backend();
    await t.mutation(api.taste.seed, { secret, userId: 'listener', likes: [{ song: song(8), at: NOW - DAY }], items: [], recents: [] });
    await t.mutation(api.taste.bonus, { secret, userId: 'listener', song: song(8), kind: 'unlike', at: NOW });
    expect(await top(t, 'listener')).toEqual([]);
  });

  it('clears all rows in scheduled batches and removes the metadata row', async () => {
    const t = backend();
    await t.run(async (ctx) => {
      for (let index = 0; index < 450; index += 1) {
        const item = song(index);
        await ctx.db.insert('tasteSongs', {
          userId: 'listener', identity: identityKey(item.title, item.artist), ref: item.ref,
          title: item.title, artist: item.artist, artwork: item.artwork, duration: item.duration,
          score: index + 1, likeBonus: false, recentListens: [], updatedAt: NOW
        });
      }
      await ctx.db.insert('tasteMeta', { userId: 'listener', songCount: 450, updatedAt: NOW });
    });

    await t.mutation(api.taste.clear, { secret, userId: 'listener' });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const count = await t.run(async (ctx) => ctx.db.query('tasteSongs')
      .withIndex('by_userId_and_identity', (q) => q.eq('userId', 'listener'))
      .take(500));
    expect(count).toHaveLength(0);
    expect(await metaRow(t, 'listener')).toBeNull();
  });

  it('rejects a wrong secret for every public function', async () => {
    const t = backend();
    const bad = 'wrong';
    await expect(t.mutation(api.taste.record, {
      secret: bad, userId: 'listener', song: song(1), secondsHeard: 60, playedAt: NOW
    })).rejects.toThrow('Unauthorized');
    await expect(t.mutation(api.taste.bonus, {
      secret: bad, userId: 'listener', song: song(1), kind: 'like', at: NOW
    })).rejects.toThrow('Unauthorized');
    await expect(t.mutation(api.taste.seed, {
      secret: bad, userId: 'listener', likes: [], items: [], recents: []
    })).rejects.toThrow('Unauthorized');
    await expect(t.query(api.taste.top, { secret: bad, userId: 'listener', limit: 10 })).rejects.toThrow('Unauthorized');
    await expect(t.mutation(api.taste.clear, { secret: bad, userId: 'listener' })).rejects.toThrow('Unauthorized');
  });
});
