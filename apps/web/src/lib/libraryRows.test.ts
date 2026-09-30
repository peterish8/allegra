import assert from 'node:assert/strict';
import test from 'node:test';

import type { LibraryChange } from '@shared/library';

import { createLibrarySong, exactSaavnMatch, foldLibraryRows } from './libraryRows.ts';

test('keeps Gaana refs and snapshots while folding current likes', () => {
  const changes: LibraryChange[] = [
    { kind: 'like', rev: 1, ref: 'gaana:track-7', song: { ref: 'gaana:track-7', title: 'Raat', artist: 'Artist', artwork: '', duration: 210 }, liked: true, likedAt: 10 },
    { kind: 'like', rev: 2, ref: 'gaana:track-7', liked: false, likedAt: 20 },
    { kind: 'like', rev: 3, ref: 'gaana:track-7', song: { ref: 'gaana:track-7', title: 'Raat', artist: 'Artist', artwork: '', duration: 210 }, liked: true, likedAt: 30 }
  ];

  const rows = foldLibraryRows(changes);

  assert.equal(rows.likes.length, 1);
  assert.equal(rows.likes[0]?.ref, 'gaana:track-7');
  assert.equal(rows.likes[0]?.song?.title, 'Raat');
});

test('playlist items keep insertion order and honor their newest tombstone', () => {
  const changes: LibraryChange[] = [
    { kind: 'playlist', rev: 1, playlistId: 'mix', name: 'Mix', isPublic: false, deleted: false, createdAt: 1 },
    { kind: 'playlist_item', rev: 2, playlistId: 'mix', ref: 'saavn:second', deleted: false, addedAt: 20 },
    { kind: 'playlist_item', rev: 3, playlistId: 'mix', ref: 'gaana:first', song: { ref: 'gaana:first', title: 'First', artist: 'Artist', artwork: '', duration: 180 }, deleted: false, addedAt: 10 },
    { kind: 'playlist_item', rev: 4, playlistId: 'mix', ref: 'saavn:second', deleted: true, addedAt: 20 }
  ];

  const rows = foldLibraryRows(changes);

  assert.deepEqual(rows.itemsByPlaylist.get('mix')?.map((item) => item.ref), ['gaana:first']);
  assert.equal(rows.itemsByPlaylist.get('mix')?.[0]?.song?.title, 'First');
});

test('drops deleted playlists from the current view', () => {
  const rows = foldLibraryRows([
    { kind: 'playlist', rev: 1, playlistId: 'mix', name: 'Mix', isPublic: false, deleted: false, createdAt: 1 },
    { kind: 'playlist', rev: 2, playlistId: 'mix', name: 'Mix', isPublic: false, deleted: true, createdAt: 1 }
  ]);
  assert.deepEqual(rows.playlists, []);
});

test('Gaana rows stay identifiable and only exact Saavn matches become web playback', () => {
  const snapshot = { ref: 'gaana:g-1' as const, title: 'Raat', artist: 'Artist feat. Guest', album: 'Night', artwork: '/cover.jpg', duration: 180 };
  const saavn = { id: 's-1', title: 'Raat', artist: 'Artist', artwork: '/saavn.jpg', streamUrl: '/api/stream/s-1', duration: 180, hasLyrics: true, playCount: 0, source: 'Saavn' as const };
  const gaana = { ...saavn, id: 'g-1', source: 'Gaana' as const };

  const row = createLibrarySong(snapshot.ref, snapshot);

  assert.equal(row?.libraryRef, snapshot.ref);
  assert.equal(row?.librarySnapshot?.album, 'Night');
  assert.equal(row?.streamUrl, '');
  assert.equal(exactSaavnMatch(snapshot, [gaana, saavn])?.id, 's-1');
  assert.equal(exactSaavnMatch({ ...snapshot, title: 'Raat Raat' }, [saavn]), null);
});
