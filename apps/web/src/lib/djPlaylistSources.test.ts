import assert from 'node:assert/strict';
import test from 'node:test';

import { samplePlaylistTracks } from './djPlaylistSources';

test('playlist source sampling keeps order and reaches the end of long playlists', () => {
  const tracks = Array.from({ length: 101 }, (_, index) => index);
  const sampled = samplePlaylistTracks(tracks, 5);

  assert.deepEqual(sampled, [0, 25, 50, 75, 100]);
});

test('playlist source sampling leaves short lists intact and handles empty limits', () => {
  assert.deepEqual(samplePlaylistTracks(['a', 'b'], 40), ['a', 'b']);
  assert.deepEqual(samplePlaylistTracks(['a', 'b'], 0), []);
  assert.deepEqual(samplePlaylistTracks(['a', 'b'], 1), ['a']);
});
