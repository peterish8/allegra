/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';
import { retryDelayMs } from './spotifyCron';

const modules = { ...import.meta.glob('./**/*.ts'), ...import.meta.glob('./_generated/*.js') };
const secret = 'test-server-secret';
const userId = 'spotify-user';

function connection(id: string, overrides: Partial<{ dailyEnabled: boolean; encryptedRefreshToken: string }> = {}) {
  return { userId: id, spotifyUserId: `spotify-${id}`, encryptedRefreshToken: 'encrypted', dailyEnabled: true, connectedAt: 1, updatedAt: 1, ...overrides };
}
function playlist(playlistId: string, extra: { dailyCheckedAt?: number; enabled?: boolean } = {}) {
  return {
    userId, playlistId, name: 'List', snapshotId: 'snapshot', total: 0, libraryId: `lib-${playlistId}`, offset: 0,
    scanSnapshotId: 'snapshot', scanTotal: 0, added: 0, skipped: 0, reviewNeeded: 0, enabled: extra.enabled ?? true, updatedAt: 1,
    ...(extra.dailyCheckedAt !== undefined ? { dailyCheckedAt: extra.dailyCheckedAt } : {})
  };
}
async function connect(t: ReturnType<typeof convexTest>) {
  await t.mutation(api.spotify.saveConnection, { secret, userId, spotifyUserId: 'spotify-account', encryptedRefreshToken: 'encrypted-refresh', dailyEnabled: true, connectedAt: 1, updatedAt: 1 });
  return (await t.query(api.spotify.connection, { secret, userId }))!.generation!;
}

describe('Spotify scheduling and disconnect cleanup', () => {
  beforeEach(() => vi.stubEnv('CONVEX_SERVER_SECRET', secret));
  afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

  it('pages through every opted-in account in bounded batches without duplicates', async () => {
    const t = convexTest(schema, modules);
    await t.run(async ({ db }) => {
      for (let i = 0; i < 205; i++) await db.insert('spotifyConnections', connection(`user-${String(i).padStart(3, '0')}`));
      await db.insert('spotifyConnections', connection('user-off', { dailyEnabled: false }));
    });
    const first = await t.query(internal.spotify.dailyAccounts, {});
    const second = await t.query(internal.spotify.dailyAccounts, { after: first.next! });
    const third = await t.query(internal.spotify.dailyAccounts, { after: second.next! });
    expect([first.users.length, second.users.length, third.users.length]).toEqual([100, 100, 5]);
    expect(third.next).toBeNull();
    const all = [...first.users, ...second.users, ...third.users];
    expect(new Set(all).size).toBe(205);
    expect(all).not.toContain('user-off');
  });

  it('schedules every account of a run, staggered, with the run start carried to each', async () => {
    vi.stubEnv('ALLEGRA_API_URL', 'https://api.example.test');
    const t = convexTest(schema, modules);
    await t.run(async ({ db }) => { for (let i = 0; i < 150; i++) await db.insert('spotifyConnections', connection(`user-${String(i).padStart(3, '0')}`)); });
    await t.action(internal.spotifyCron.scheduleBatch, { runStartedAt: 42, scheduled: 0 });
    const afterFirst = await t.run(async ({ db }) => await db.system.query('_scheduled_functions').collect());
    const users = afterFirst.filter(job => job.name.includes('dailyUser'));
    const continuation = afterFirst.find(job => job.name.includes('scheduleBatch'));
    expect(users).toHaveLength(100);
    expect(users.every(job => (job.args[0] as { runStartedAt: number }).runStartedAt === 42)).toBe(true);
    const times = users.map(job => job.scheduledTime).sort((a, b) => a - b);
    expect(times.at(-1)! - times[0]!).toBeGreaterThanOrEqual(99 * 2_000 - 50);
    expect(continuation?.args[0]).toMatchObject({ runStartedAt: 42, scheduled: 100 });
    await t.action(internal.spotifyCron.scheduleBatch, continuation!.args[0] as { after: string; runStartedAt: number; scheduled: number });
    const all = await t.run(async ({ db }) => await db.system.query('_scheduled_functions').collect());
    const ids = all.filter(job => job.name.includes('dailyUser')).map(job => (job.args[0] as { userId: string }).userId);
    expect(new Set(ids).size).toBe(150);
  });

  it('walks a run over never-checked and older playlists only, oldest first', async () => {
    const t = convexTest(schema, modules);
    await connect(t);
    await t.run(async ({ db }) => {
      await db.insert('spotifyPlaylists', playlist('checked-this-run', { dailyCheckedAt: 100 }));
      await db.insert('spotifyPlaylists', playlist('checked-earlier', { dailyCheckedAt: 50 }));
      await db.insert('spotifyPlaylists', playlist('never-checked'));
      await db.insert('spotifyPlaylists', playlist('disabled', { enabled: false }));
    });
    const rows = await t.query(api.spotify.dailyPlaylists, { secret, userId, runStartedAt: 100, limit: 5 });
    expect(rows.map(row => row.playlistId)).toEqual(['never-checked', 'checked-earlier']);
  });

  it('marks a playlist for a run idempotently and never moves its mark backwards', async () => {
    const t = convexTest(schema, modules);
    const generation = await connect(t);
    await t.run(async ({ db }) => { await db.insert('spotifyPlaylists', playlist('p')); });
    expect(await t.mutation(api.spotify.markDailyChecked, { secret, userId, playlistId: 'p', runStartedAt: 100, generation })).toBe(true);
    expect(await t.mutation(api.spotify.markDailyChecked, { secret, userId, playlistId: 'p', runStartedAt: 100, generation })).toBe(true);
    expect(await t.mutation(api.spotify.markDailyChecked, { secret, userId, playlistId: 'p', runStartedAt: 60, generation })).toBe(true);
    const row = await t.run(async ({ db }) => await db.query('spotifyPlaylists').withIndex('by_userId_and_playlistId', q => q.eq('userId', userId).eq('playlistId', 'p')).unique());
    expect(row?.dailyCheckedAt).toBe(100);
  });

  it('fences every write from a step that started before disconnect or reconnect', async () => {
    const t = convexTest(schema, modules);
    const old = await connect(t);
    const step = { secret, userId, playlistId: 'p', name: 'Road', snapshotId: 's', total: 1, libraryId: 'lib-p', enabled: true, updatedAt: 2 };
    expect(await t.mutation(api.spotify.savePlaylist, { ...step, generation: old })).toBe(true);
    expect(await t.mutation(api.spotify.claimPlaylist, { secret, userId, playlistId: 'p', token: 'lease', now: 10, leaseMs: 60_000, generation: old })).not.toBeNull();
    await t.mutation(api.spotify.disconnect, { secret, userId });
    const checkpoint = { secret, userId, playlistId: 'p', token: 'lease', receipts: [{ trackId: 't1', libraryId: 'lib-p' }], offset: 1, snapshotId: 's', total: 1, added: 1, skipped: 0, reviewNeeded: 0, complete: true, now: 11 };
    expect(await t.mutation(api.spotify.checkpoint, { ...checkpoint, generation: old })).toBe(false);
    expect(await t.mutation(api.spotify.savePlaylist, { ...step, generation: old })).toBe(false);
    expect(await t.mutation(api.spotify.savePlaylist, step)).toBe(false);

    await connect(t);
    expect(await t.mutation(api.spotify.savePlaylist, { ...step, generation: old })).toBe(false);
    expect(await t.mutation(api.spotify.claimPlaylist, { secret, userId, playlistId: 'p', token: 'x', now: 20, leaseMs: 60_000, generation: old })).toBeNull();
    expect(await t.mutation(api.spotify.markDailyChecked, { secret, userId, playlistId: 'p', runStartedAt: 5, generation: old })).toBe(false);
    const leftovers = await t.run(async ({ db }) => ({
      playlists: await db.query('spotifyPlaylists').withIndex('by_userId_and_updatedAt', q => q.eq('userId', userId)).take(10),
      receipts: await db.query('spotifyReceipts').withIndex('by_userId_and_playlistId', q => q.eq('userId', userId)).take(10)
    }));
    expect(leftovers).toEqual({ playlists: [], receipts: [] });
  });

  it('keeps no Spotify identity on the disconnect tombstone and cannot opt it into daily runs', async () => {
    const t = convexTest(schema, modules);
    await connect(t);
    await t.mutation(api.spotify.disconnect, { secret, userId });
    const tombstone = await t.query(api.spotify.connection, { secret, userId });
    expect(tombstone).toMatchObject({ spotifyUserId: '', encryptedRefreshToken: '', dailyEnabled: false });
    expect(tombstone?.encryptedAccessToken).toBeUndefined();
    expect(await t.mutation(api.spotify.setDaily, { secret, userId, enabled: true, updatedAt: 3 })).toBe(false);
    expect((await t.query(internal.spotify.dailyAccounts, {})).users).not.toContain(userId);
  });

  it('stops stale disconnect cleanup after a reconnect and rejects the old refresh', async () => {
    const t = convexTest(schema, modules);
    await connect(t);
    await t.run(async ({ db }) => { for (let i = 0; i < 200; i++) await db.insert('spotifyPlaylists', playlist(`playlist-${i}`)); });
    await t.mutation(api.spotify.disconnect, { secret, userId });
    await t.mutation(api.spotify.saveConnection, { secret, userId, spotifyUserId: 'new-spotify-account', encryptedRefreshToken: 'new-encrypted-refresh', dailyEnabled: false, connectedAt: 2, updatedAt: 2 });
    await t.mutation(api.spotify.savePlaylist, { secret, userId, playlistId: 'new-playlist', name: 'New', snapshotId: 'new-snapshot', total: 0, libraryId: 'new-library', enabled: true, updatedAt: 2 });

    await t.mutation(internal.spotify.disconnectRest, { userId, generation: 2 });
    const result = await t.run(async ({ db }) => ({
      connection: await db.query('spotifyConnections').withIndex('by_userId', q => q.eq('userId', userId)).unique(),
      playlist: await db.query('spotifyPlaylists').withIndex('by_userId_and_playlistId', q => q.eq('userId', userId).eq('playlistId', 'new-playlist')).unique()
    }));
    expect(result.connection?.spotifyUserId).toBe('new-spotify-account');
    expect(result.playlist?.playlistId).toBe('new-playlist');
    expect(await t.mutation(api.spotify.refreshConnection, { secret, userId, expectedGeneration: 1, encryptedRefreshToken: 'old-refresh', encryptedAccessToken: 'old-access', accessExpiresAt: 100, updatedAt: 3 })).toBe(false);
    expect((await t.query(api.spotify.connection, { secret, userId }))?.encryptedRefreshToken).toBe('new-encrypted-refresh');
  });

  it('honours a Retry-After hint within bounds and waits an hour without one', () => {
    expect(retryDelayMs('30')).toBe(60_000);
    expect(retryDelayMs('600')).toBe(600_000);
    expect(retryDelayMs('86400')).toBe(3_600_000);
    expect(retryDelayMs(null)).toBe(3_600_000);
    expect(retryDelayMs('')).toBe(3_600_000);
    expect(retryDelayMs('soon')).toBe(3_600_000);
  });
});
