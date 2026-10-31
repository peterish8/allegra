import assert from 'node:assert/strict';
import test from 'node:test';

import type { AuthService } from '../auth/auth.js';
import { SpotifyStore } from '../db/spotifyStore.js';
import { SpotifyApiError, type SpotifyProvider, type SpotifyTrack } from '../providers/spotify.js';
import { parseLibraryOps, type LibraryOp } from '../shared/library.js';
import type { ImportMatcher } from './importMatch.js';
import { SpotifyTransferService } from './spotifyTransfer.js';
import { SPOTIFY_LIKED_ID } from '../shared/spotify.js';

const PLAYLIST = 'pl0000000001';

/** 120 Spotify rows, three 50-row steps. `snapshot` is mutable so a test can edit the playlist. */
function build() {
  const state = { snapshot: 'snap-a', likedScope: true, failures: new Map<string, Error>(), refreshes: 0, onRefresh: async () => {}, liked: Array.from({ length: 60 }, (_, i): SpotifyTrack => ({ id: `l${i}`, title: `Loved ${i}`, artist: 'Artist', durationSec: 200, addedAt: '2026-03-01T00:00:00Z' })), tracks: Array.from({ length: 120 }, (_, i): SpotifyTrack => ({ id: `t${i}`, title: `Song ${i}`, artist: 'Artist', durationSec: 200, addedAt: '2026-01-01T00:00:00Z' })) };
  const provider = {
    refresh: async () => { state.refreshes++; await state.onRefresh(); return { accessToken: 'a', expiresIn: 3600 }; },
    playlists: async () => [{ id: PLAYLIST, name: 'Road', snapshotId: state.snapshot, total: state.tracks.length }],
    playlist: async (_t: string, id: string) => {
      const failure = state.failures.get(id); if (failure) throw failure;
      return { id, name: 'Road', snapshotId: state.snapshot, total: state.tracks.length };
    },
    items: async (_t: string, _p: string, offset: number, limit = 50) => ({ tracks: state.tracks.slice(offset, offset + limit), total: state.tracks.length, snapshotId: '' }),
    likedSummary: async () => (state.likedScope ? { total: state.liked.length, snapshotId: `liked-${state.liked.length}` } : null),
    likedItems: async (_t: string, offset: number, limit = 50) => ({ tracks: state.liked.slice(offset, offset + limit), total: state.liked.length, snapshotId: '' })
  } as unknown as SpotifyProvider;
  const saved: LibraryOp[] = [];
  const auth = {
    getUser: async () => ({ libraries: [] }),
    library: { apply: async (_u: string, ops: readonly LibraryOp[]) => { saved.push(...ops); return { rejected: [] }; } }
  } as unknown as AuthService;
  const matcher = {
    match: async (rows: readonly { title: string }[]) => rows.map((row, index) => ({ index, confidence: 'exact', song: { ref: `saavn:${row.title}`, title: row.title, artist: 'Artist', artwork: '', duration: 200 } }))
  } as unknown as ImportMatcher;
  const store = new SpotifyStore(undefined, 'test-secret-0123456789');
  const service = new SpotifyTransferService(provider, 'client', 'http://localhost/cb', store, auth, matcher);
  return { state, saved, store, service };
}

async function connect(store: SpotifyStore) {
  await store.saveConnection({ userId: 'u', spotifyUserId: 's', refreshToken: 'r', dailyEnabled: true, connectedAt: 1, updatedAt: 1 });
}

const adds = (ops: readonly LibraryOp[]) => ops.filter(op => op.op === 'playlist_add').length;

test('manual sync pages to completion and a rescan adds nothing twice', async () => {
  const { saved, store, service } = build(); await connect(store);
  const steps = [];
  do steps.push(await service.sync('u', PLAYLIST)); while (!steps.at(-1)!.complete);
  assert.equal(steps.length, 3);
  assert.equal(adds(saved), 120);
  do steps.push(await service.sync('u', PLAYLIST)); while (!steps.at(-1)!.complete);
  assert.equal(adds(saved), 120, 'receipts stop duplicate playlist entries');
  // The sync writes past the device parser; its ops must still be ones a device could send back.
  assert.notEqual(parseLibraryOps(saved.slice(0, 60)), null, 'generated playlist ids pass parseLibraryOps');
});

test('daily run finishes the playlist, then skips it while the snapshot is unchanged', async () => {
  const { state, saved, store, service } = build(); await connect(store);
  await service.sync('u', PLAYLIST); // selects the playlist (one step in)
  assert.deepEqual(await service.dailyStep('u', 1), { more: false });
  assert.equal(adds(saved), 120);
  const before = saved.length;
  await service.dailyStep('u', 2);
  assert.equal(saved.length, before, 'unchanged snapshot does no work');
  state.snapshot = 'snap-b'; state.tracks.push({ id: 'new', title: 'New one', artist: 'Artist', durationSec: 180, addedAt: '2026-02-01T00:00:00Z' });
  await service.dailyStep('u', 3);
  assert.equal(adds(saved), 121, 'only the new Spotify row is added');
});

test('a playlist edited mid-scan restarts from the top', async () => {
  const { state, store, service } = build(); await connect(store);
  await service.sync('u', PLAYLIST);
  state.snapshot = 'snap-b';
  await service.sync('u', PLAYLIST);
  assert.equal((await store.playlists('u'))[0]!.offset, 50, 'restarted at 0, then advanced one step');
});

test('daily run stops at its time budget and asks to be called again', async () => {
  const { store, service } = build(); await connect(store);
  await service.sync('u', PLAYLIST);
  let clock = 0;
  assert.deepEqual(await service.dailyStep('u', 1, () => (clock += 50_000)), { more: true });
});

const listIds = (count: number) => Array.from({ length: count }, (_, i) => `pl${String(i).padStart(10, '0')}`);
async function select(store: SpotifyStore, ids: readonly string[]) {
  for (const [index, playlistId] of ids.entries()) await store.savePlaylist({ userId: 'u', playlistId, name: `List ${index}`, snapshotId: 'snap-a', total: 0, libraryId: `spotify-${playlistId}`, enabled: true, updatedAt: index + 1 });
}
const synced = async (store: SpotifyStore) => (await store.playlists('u')).filter(row => row.lastSyncedAt !== undefined).length;

test('one daily run reaches every enabled playlist, not just the first page of five', async () => {
  const { store, service } = build(); await connect(store);
  await select(store, listIds(12));
  assert.deepEqual(await service.dailyStep('u', 10), { more: false });
  assert.equal(await synced(store), 12);
  assert.ok((await store.playlists('u')).every(row => row.dailyCheckedAt === 10), 'each playlist is marked with the run');
});

test('a run cut off by its budget resumes where it stopped and visits each playlist once', async () => {
  const { store, service, saved } = build(); await connect(store);
  await select(store, listIds(7));
  let clock = 0; const tick = () => (clock += 20_000);
  const calls: { more: boolean }[] = [];
  do calls.push(await service.dailyStep('u', 10, tick)); while (calls.at(-1)!.more && calls.length < 50);
  assert.ok(calls.length > 1, 'the budget forced continuation calls');
  assert.equal(calls.at(-1)!.more, false);
  assert.equal(await synced(store), 7);
  assert.equal(adds(saved), 7 * 120, 'resumed steps add no duplicates');
  assert.deepEqual(await service.dailyStep('u', 10), { more: false }, 'a repeated call for a finished run does nothing');
});

test('a rate-limited playlist stays unmarked and the retry resumes it', async () => {
  const { state, store, service } = build(); await connect(store);
  const ids = listIds(3); await select(store, ids);
  state.failures.set(ids[1]!, new SpotifyApiError(429, 'Spotify is busy. Try again shortly.', 30));
  await assert.rejects(service.dailyStep('u', 10), (error: unknown) => error instanceof SpotifyApiError && error.status === 429 && error.retryAfter === 30);
  const marked = (await store.playlists('u')).filter(row => row.dailyCheckedAt === 10).map(row => row.playlistId);
  assert.deepEqual(marked, [ids[0]], 'only the playlist finished before the 429 is marked');
  state.failures.clear();
  assert.deepEqual(await service.dailyStep('u', 10), { more: false });
  assert.equal(await synced(store), 3);
});

test('a playlist Spotify no longer serves is skipped for the day without blocking the rest', async () => {
  const { state, store, service } = build(); await connect(store);
  const ids = listIds(3); await select(store, ids);
  state.failures.set(ids[0]!, new SpotifyApiError(404, 'Spotify could not find that playlist.'));
  assert.deepEqual(await service.dailyStep('u', 10), { more: false });
  assert.equal(await synced(store), 2);
  assert.equal((await store.playlists('u')).find(row => row.playlistId === ids[0])!.dailyCheckedAt, 10, 'not retried within the same run');
});

test('a disconnected account stops the daily step so the scheduler does not retry it', async () => {
  const { store, service } = build(); await connect(store);
  await select(store, [PLAYLIST]);
  await service.disconnect('u');
  await assert.rejects(service.dailyStep('u', 10), (error: unknown) => error instanceof SpotifyApiError && error.status === 401);
});

test('a refresh that finishes after a reconnect does not overwrite the new credential', async () => {
  const { state, store, service } = build();
  await store.saveConnection({ userId: 'u', spotifyUserId: 's', refreshToken: 'old', dailyEnabled: false, connectedAt: 1, updatedAt: 1 });
  state.onRefresh = async () => {
    state.onRefresh = async () => {};
    await store.saveConnection({ userId: 'u', spotifyUserId: 's2', refreshToken: 'new', dailyEnabled: false, connectedAt: 2, updatedAt: 2 });
  };
  await assert.rejects(service.sourcePlaylists('u'), (error: unknown) => error instanceof SpotifyApiError && error.status === 401);
  const current = await store.connection('u');
  assert.equal(current?.refreshToken, 'new');
  assert.equal(current?.spotifyUserId, 's2');
});

test('a sync step in flight across disconnect writes no playlist row or receipts afterwards', async () => {
  const { state, store, service } = build(); await connect(store);
  // Disconnect lands while the step is fetching Spotify, after it read the credential.
  void state;
  const provider = (service as unknown as { provider: { playlist: (t: string, id: string) => Promise<unknown> } }).provider;
  const original = provider.playlist;
  provider.playlist = async (t, id) => { await service.disconnect('u'); return original(t, id); };
  await assert.rejects(service.sync('u', PLAYLIST), (error: unknown) => error instanceof SpotifyApiError && error.status === 401);
  assert.deepEqual(await store.playlists('u'), [], 'no playlist name or selection is recreated');
  assert.equal((await store.receipts('u', PLAYLIST, ['t0'])).size, 0);
});

test('disconnect keeps no Spotify identity, and a tombstone cannot be opted back into daily runs', async () => {
  const { store, service } = build(); await connect(store);
  await service.disconnect('u');
  const tombstone = await store.connection('u');
  assert.equal(tombstone?.refreshToken, '');
  assert.equal(tombstone?.spotifyUserId, '');
  assert.equal(await service.setDaily('u', true), false);
  assert.equal((await service.status('u')).connected, false);
});

test('playlist counts come from the renamed items field, or the items endpoint when the list leaves them out', async () => {
  const { SpotifyProvider } = await import('../providers/spotify.js');
  const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    const body = url.includes('/me/playlists')
      ? { items: [{ id: 'a', name: 'Renamed', snapshot_id: 's', items: { total: 12 } }, { id: 'b', name: 'Missing', snapshot_id: 's' }], next: null }
      : url.includes('/playlists/b/items') ? { total: 40 } : {};
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const rows = await new SpotifyProvider('client', fetchImpl).playlists('token');
  assert.deepEqual(rows.map(row => [row.name, row.total]), [['Renamed', 12], ['Missing', 40]]);
  assert.ok(rows.every(row => row.totalUnknown === undefined), 'confirmed counts are not marked unknown');
});

test('a count Spotify leaves out and the check cannot confirm is unknown, while a confirmed zero stays empty', async () => {
  const { SpotifyProvider } = await import('../providers/spotify.js');
  const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.includes('/me/playlists')) return new Response(JSON.stringify({ items: [{ id: 'empty', name: 'Empty', snapshot_id: 's' }, { id: 'flaky', name: 'Flaky', snapshot_id: 's' }], next: null }), { status: 200 });
    if (url.includes('/playlists/empty/items')) return new Response(JSON.stringify({ total: 0 }), { status: 200 });
    return new Response('{}', { status: 500 });
  };
  const rows = await new SpotifyProvider('client', fetchImpl).playlists('token');
  assert.deepEqual(rows.map(row => [row.name, row.total, row.totalUnknown ?? false]), [['Empty', 0, false], ['Flaky', 0, true]]);
});

test('Liked Songs lead the sources and sync into likes, not a playlist', async () => {
  const { saved, store, service } = build(); await connect(store);
  const sources = await service.sourcePlaylists('u');
  assert.equal(sources[0]!.id, SPOTIFY_LIKED_ID);
  assert.equal(sources[0]!.total, 60);
  assert.equal(sources[0]!.needsReconnect, undefined);
  let step; do step = await service.sync('u', SPOTIFY_LIKED_ID); while (!step.complete);
  assert.equal(saved.filter(op => op.op === 'like').length, 60);
  assert.equal(saved.some(op => op.op === 'playlist_upsert' || op.op === 'playlist_add'), false);
  assert.notEqual(parseLibraryOps(saved.slice(0, 50)), null, 'like ops pass parseLibraryOps');
  do step = await service.sync('u', SPOTIFY_LIKED_ID); while (!step.complete);
  assert.equal(saved.filter(op => op.op === 'like').length, 60, 'receipts stop duplicate likes');
});

test('a connection without the library scope lists Liked Songs as needing a reconnect', async () => {
  const { state, store, service } = build(); await connect(store);
  state.likedScope = false;
  const sources = await service.sourcePlaylists('u');
  assert.equal(sources[0]!.needsReconnect, true);
  await assert.rejects(service.sync('u', SPOTIFY_LIKED_ID), (error: { status?: number }) => error.status === 403);
});

test('playlist covers prefer the smallest sharp Spotify image and ignore other hosts', async () => {
  const { SpotifyProvider } = await import('../providers/spotify.js');
  const fetchImpl = async (): Promise<Response> => new Response(JSON.stringify({ items: [
    { id: 'a', name: 'Sized', snapshot_id: 's', items: { total: 1 }, images: [{ url: 'https://i.scdn.co/image/640', width: 640 }, { url: 'https://i.scdn.co/image/300', width: 300 }, { url: 'https://i.scdn.co/image/60', width: 60 }] },
    { id: 'b', name: 'Mosaic', snapshot_id: 's', items: { total: 1 }, images: [{ url: 'https://mosaic.scdn.co/640/abc', width: null }] },
    { id: 'c', name: 'Elsewhere', snapshot_id: 's', items: { total: 1 }, images: [{ url: 'http://evil.example/x.jpg', width: 300 }] }
  ], next: null }), { status: 200 });
  const rows = await new SpotifyProvider('client', fetchImpl).playlists('token');
  assert.deepEqual(rows.map(row => row.imageUrl), ['https://i.scdn.co/image/300', 'https://mosaic.scdn.co/640/abc', null]);
});
