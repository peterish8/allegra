import assert from 'node:assert/strict';
import test from 'node:test';

import type { UnifiedSong } from '@shared/types';

import { albumsInResults, collectAlbumTracks } from './album.ts';

const song = (id: string, artist: string, album: string): UnifiedSong => ({
  id, title: `Song ${id}`, artist, album, artwork: '', streamUrl: `/api/stream/${id}`, duration: 200, hasLyrics: false, playCount: 0, source: 'Saavn'
});

// Regression (2026-10-11): a soundtrack credits different singers per track. The search card said
// "5 songs"; the album page matched the whole credit line and showed one.
const SOUNDTRACK = [
  song('b1', 'Sai Abhyankkar, The Indian Choral Ensemble', 'Baththa (Original Motion Picture Soundtrack)'),
  song('b2', 'Vivek, Sai Abhyankkar, Shruti Haasan', 'Baththa (Original Motion Picture Soundtrack)'),
  song('b3', 'Sai Abhyankkar', 'Baththa (Original Motion Picture Soundtrack)'),
  song('b4', 'Rokesh, Sai Abhyankkar', 'Baththa (Original Motion Picture Soundtrack)'),
  // Connected through Vivek on b2, not through the composer.
  song('b5', 'Vivek, Harini', 'Baththa (Original Motion Picture Soundtrack)')
];

test('a soundtrack with different singers per track opens with every track', () => {
  const tracks = collectAlbumTracks(SOUNDTRACK[0]!, [SOUNDTRACK]);
  assert.deepEqual(tracks.map(({ id }) => id), ['b1', 'b2', 'b3', 'b4', 'b5']);
});

test('the search card counts exactly the tracks the album page will show', () => {
  const hits = albumsInResults(SOUNDTRACK, 6);
  assert.equal(hits.length, 1, 'one card for the soundtrack');
  assert.equal(hits[0]!.trackCount, 5);
  const opened = collectAlbumTracks(hits[0]!.seed, [SOUNDTRACK]);
  assert.equal(opened.length, hits[0]!.trackCount);
});

test('two different albums that share a name stay apart', () => {
  const mixed = [
    song('g1', 'Arijit Singh', 'Greatest Hits'),
    song('g2', 'Arijit Singh, Shreya Ghoshal', 'Greatest Hits'),
    song('k1', 'Kishore Kumar', 'Greatest Hits')
  ];
  assert.deepEqual(collectAlbumTracks(mixed[0]!, [mixed]).map(({ id }) => id), ['g1', 'g2']);
  assert.deepEqual(collectAlbumTracks(mixed[2]!, [mixed]).map(({ id }) => id), ['k1']);
  const hits = albumsInResults(mixed, 6);
  assert.deepEqual(hits.map((hit) => hit.trackCount), [2, 1]);
});

test('the catalog album id decides first: the soundtrack and its singles are different albums', () => {
  const withIds = [
    { ...song('s1', 'Sai Abhyankkar, The Indian Choral Ensemble', 'Baththa (Original Motion Picture Soundtrack)'), albumId: '81429928' },
    { ...song('s2', 'Sai Abhyankkar, Karthik Netha', 'Baththa (Original Motion Picture Soundtrack)'), albumId: '81429928' },
    { ...song('m1', 'Sai Abhyankkar, Harini', 'Magale (From "Baththa")'), albumId: '80304913' }
  ];
  assert.deepEqual(collectAlbumTracks(withIds[0]!, [withIds]).map(({ id }) => id), ['s1', 's2']);
  assert.deepEqual(collectAlbumTracks(withIds[2]!, [withIds]).map(({ id }) => id), ['m1']);
});

test('the seed is always there, even when no pool holds it', () => {
  assert.deepEqual(collectAlbumTracks(SOUNDTRACK[0]!, []).map(({ id }) => id), ['b1']);
  const single = song('x', 'Solo', '');
  assert.deepEqual(collectAlbumTracks(single, [SOUNDTRACK]), [single]);
});
