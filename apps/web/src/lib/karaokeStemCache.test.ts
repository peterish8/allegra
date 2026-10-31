import assert from 'node:assert/strict';
import test from 'node:test';

import { pickEvictions, stemCacheKey } from './liveKaraoke/roformer/stemCache.ts';
import { ROFORMER_MODEL } from './liveKaraoke/roformer/config.ts';

const MB = 1024 * 1024;

test('nothing is evicted while the cache fits', () => {
  assert.deepEqual(pickEvictions([{ name: 'a', bytes: 10 * MB, lastPlayed: 1 }], 100 * MB, null), []);
});

test('least recently played songs go first, only until the cache fits', () => {
  const songs = [
    { name: 'new', bytes: 40 * MB, lastPlayed: 300 },
    { name: 'old', bytes: 40 * MB, lastPlayed: 100 },
    { name: 'mid', bytes: 40 * MB, lastPlayed: 200 }
  ];
  assert.deepEqual(pickEvictions(songs, 90 * MB, null), ['old']);
  assert.deepEqual(pickEvictions(songs, 30 * MB, null), ['old', 'mid', 'new']);
});

test('the song playing now is never evicted, even when it is the oldest', () => {
  const songs = [
    { name: 'playing', bytes: 60 * MB, lastPlayed: 1 },
    { name: 'other', bytes: 60 * MB, lastPlayed: 2 }
  ];
  assert.deepEqual(pickEvictions(songs, 100 * MB, 'playing'), ['other']);
});

test('the cache key changes with the model, so a new separator never serves old stems', () => {
  assert.ok(stemCacheKey().startsWith(ROFORMER_MODEL.dataSha256.slice(0, 12)));
  assert.match(stemCacheKey(), /-L\d+-h\d+$/);
});
