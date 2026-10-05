import assert from 'node:assert/strict';
import test from 'node:test';

import type { AuthService } from '../auth/auth.js';
import { SpotifyStore } from '../db/spotifyStore.js';
import type { SpotifyProvider, SpotifyTrack } from '../providers/spotify.js';
import { parseLibraryOps, type LibraryOp } from '../shared/library.js';
import type { ImportMatcher } from './importMatch.js';
import { SpotifyTransferService } from './spotifyTransfer.js';
import { SPOTIFY_LIKED_ID } from '../shared/spotify.js';

const PLAYLIST = 'pl0000000001';

/** 120 Spotify rows, three 50-row steps. `snapshot` is mutable so a test can edit the playlist. */
function build() {
  const state = { snapshot: 'snap-a', likedScope: true, liked: Array.from({ length: 60 }, (_, i): SpotifyTrack => ({ id: `l${i}`, title: `Loved ${i}`, artist: 'Artist', durationSec: 200, addedAt: '2026-03-01T00:00:00Z' })), tracks: Array.from({ length: 120 }, (_, i): SpotifyTrack => ({ id: `t${i}`, title: `Song ${i}`, artist: 'Artist', durationSec: 200, addedAt: '2026-01-01T00:00:00Z' })) };
  const provider = {
    refresh: async () => ({ accessToken: 'a', expiresIn: 3600 }),
    playlists: async () => [{ id: PLAYLIST, name: 'Road', snapshotId: state.snapshot, total: state.tracks.length }],
    playlist: async () => ({ id: PLAYLIST, name: 'Road', snapshotId: state.snapshot, total: state.tracks.length }),
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
  assert.deepEqual(await service.dailyStep('u'), { more: false });
  assert.equal(adds(saved), 120);
  const before = saved.length;
  await service.dailyStep('u');
  assert.equal(saved.length, before, 'unchanged snapshot does no work');
  state.snapshot = 'snap-b'; state.tracks.push({ id: 'new', title: 'New one', artist: 'Artist', durationSec: 180, addedAt: '2026-02-01T00:00:00Z' });
  await service.dailyStep('u');
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
  assert.deepEqual(await service.dailyStep('u', () => (clock += 50_000)), { more: true });
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
