import assert from 'node:assert/strict';
import test from 'node:test';

import type { SongSnapshot } from '@shared/songRef';
import type { UnifiedSong } from '@shared/types';

import { snapshotFromSong, withFoundCover } from './connectSnapshot.ts';
import type { LibrarySong } from './libraryRows.ts';

const catalogSong: UnifiedSong = {
  id: 'EbFWakDs',
  title: 'Kesariya',
  artist: 'Arijit Singh',
  album: 'Brahmastra',
  artwork: 'https://c.saavncdn.com/191/Kesariya-500x500.jpg',
  streamUrl: '/api/stream/EbFWakDs',
  duration: 268,
  hasLyrics: true,
  playCount: 10,
  source: 'Saavn'
};

test('a catalog song travels with its ref and its cover', () => {
  assert.deepEqual(snapshotFromSong(catalogSong), {
    ref: 'saavn:EbFWakDs',
    title: 'Kesariya',
    artist: 'Arijit Singh',
    album: 'Brahmastra',
    artwork: 'https://c.saavncdn.com/191/Kesariya-500x500.jpg',
    duration: 268
  });
});

test('a library song keeps its stored snapshot but sends the cover this browser shows', () => {
  // Liked on the phone, whose only cover was a file of its own: stored without a cover.
  const stored: SongSnapshot = { ref: 'saavn:EbFWakDs', title: 'Kesariya', artist: 'Arijit Singh', artwork: '', duration: 268 };
  const liked: LibrarySong = { ...catalogSong, libraryRef: 'saavn:EbFWakDs', librarySnapshot: stored };

  const sent = snapshotFromSong(liked);

  assert.equal(sent?.artwork, 'https://c.saavncdn.com/191/Kesariya-500x500.jpg');
  assert.equal(sent?.title, 'Kesariya');
  assert.equal(sent?.album, undefined, 'the stored snapshot is what travels, apart from its cover');
});

test('a stored snapshot that already has the cover is sent as it is', () => {
  const stored: SongSnapshot = { ref: 'saavn:EbFWakDs', title: 'Kesariya', artist: 'Arijit Singh', artwork: catalogSong.artwork, duration: 268 };
  const liked: LibrarySong = { ...catalogSong, libraryRef: 'saavn:EbFWakDs', librarySnapshot: stored };
  assert.equal(snapshotFromSong(liked), stored);
});

test('a song shown without a cover keeps the stored one, and a cover nobody else can open is never sent', () => {
  const stored: SongSnapshot = { ref: 'saavn:EbFWakDs', title: 'Kesariya', artist: 'Arijit Singh', artwork: 'https://c.saavncdn.com/old.jpg', duration: 268 };
  const bare: LibrarySong = { ...catalogSong, artwork: '', libraryRef: 'saavn:EbFWakDs', librarySnapshot: stored };
  assert.equal(snapshotFromSong(bare)?.artwork, 'https://c.saavncdn.com/old.jpg');
  assert.equal(snapshotFromSong({ ...catalogSong, artwork: 'blob:https://allegra.test/1' })?.artwork, '');
});

test('a song that arrived without a cover is sent on with the one this browser found', () => {
  const sent: SongSnapshot = { ref: 'saavn:EbFWakDs', title: 'Kesariya', artist: 'Arijit Singh', artwork: '', duration: 268 };
  assert.equal(withFoundCover(sent, catalogSong.artwork).artwork, catalogSong.artwork);
  assert.equal(withFoundCover(sent, ''), sent);
  const covered = { ...sent, artwork: 'https://c.saavncdn.com/theirs.jpg' };
  assert.equal(withFoundCover(covered, catalogSong.artwork).artwork, catalogSong.artwork, 'the cover found here is the one shown here');
});
