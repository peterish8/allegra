import assert from 'node:assert/strict';
import test from 'node:test';

import type { UnifiedSong } from '@shared/types';

import { savePlaylistWithSongs } from './savePlaylist';
import type { LibraryRecord } from './api';

const playlist: LibraryRecord = {
  id: 'set-1',
  name: 'Late night',
  isPublic: false,
  songIds: [],
  createdAt: '2026-10-11T00:00:00.000Z'
};
const songs = [{ id: 'one', title: 'One', artist: 'A', artwork: '', duration: 10, source: 'Saavn' } satisfies UnifiedSong];

test('savePlaylistWithSongs creates once and adds the complete ordered list', async () => {
  const calls: string[] = [];
  const result = await savePlaylistWithSongs('  Late night  ', songs, {
    create: async (name) => { calls.push(`create:${name}`); return playlist; },
    addSongs: async (id, tracks) => { calls.push(`add:${id}:${tracks.map((song) => song.id).join(',')}`); return true; },
    remove: async (id) => { calls.push(`remove:${id}`); return true; }
  });

  assert.deepEqual(result, { ok: true, playlist });
  assert.deepEqual(calls, ['create:Late night', 'add:set-1:one']);
});

test('savePlaylistWithSongs removes a new playlist when adding the full list fails', async () => {
  const calls: string[] = [];
  const result = await savePlaylistWithSongs('Mix', songs, {
    create: async () => playlist,
    addSongs: async () => { calls.push('add'); return false; },
    remove: async (id) => { calls.push(`remove:${id}`); return true; }
  });

  assert.deepEqual(result, { ok: false, error: 'The songs could not be saved. The empty playlist was removed, so you can try again.' });
  assert.deepEqual(calls, ['add', 'remove:set-1']);
});

test('savePlaylistWithSongs reports when rollback could not remove the playlist shell', async () => {
  const result = await savePlaylistWithSongs('Mix', songs, {
    create: async () => playlist,
    addSongs: async () => false,
    remove: async () => false
  });

  assert.deepEqual(result, { ok: false, error: 'The songs could not be saved, and the playlist could not be removed. You can remove it from Your library.' });
});
