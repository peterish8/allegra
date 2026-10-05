import assert from 'node:assert/strict';
import test from 'node:test';

import { addDecayed, currentWeight } from '../shared/blendDecay.js';
import { identityKey } from '../shared/identity.js';
import type { SongSnapshot } from '../shared/songRef.js';
import { MemoryTasteTally } from './tasteTally.js';

const NOW = Date.UTC(2026, 9, 3);
const DAY = 24 * 60 * 60 * 1000;

function song(n: number): SongSnapshot {
  return {
    ref: `saavn:s${n}`,
    title: `Song ${n}`,
    artist: `Artist ${n % 7}`,
    artwork: 'https://c.saavncdn.com/x.jpg',
    duration: 60_000
  };
}

test('record adds minutes heard at the listen timestamp', async () => {
  const tally = new MemoryTasteTally(() => NOW);
  const playedAt = NOW - 3 * DAY;
  assert.equal(await tally.record('u', song(1), 120, playedAt), true);
  const [entry] = await tally.top('u', 200);
  assert.equal(entry?.identity, identityKey(song(1).title, song(1).artist));
  assert.ok(Math.abs(currentWeight(entry?.score ?? 0, playedAt) - 2) < 1e-9);
});

test('ignores a repeated playedAt for the same song', async () => {
  const tally = new MemoryTasteTally(() => NOW);
  const playedAt = NOW - DAY;
  assert.equal(await tally.record('u', song(1), 120, playedAt), true);
  assert.equal(await tally.record('u', song(1), 120, playedAt), false);
  const [entry] = await tally.top('u', 200);
  assert.ok(Math.abs(currentWeight(entry?.score ?? 0, playedAt) - 2) < 1e-9);
});

test('a stable play id adds only the new cumulative duration, within a bounded 16-event replay window', async () => {
  const tally = new MemoryTasteTally(() => NOW);
  const playedAt = NOW - DAY;
  assert.equal(await tally.record('u', song(1), 30, playedAt, 'play-1'), true);
  assert.equal(await tally.record('u', song(1), 30, playedAt + 1000, 'play-1'), false);
  assert.equal(await tally.record('u', song(1), 90, playedAt + 2000, 'play-1'), true);
  assert.equal(await tally.record('u', song(1), 45, playedAt + 3000, 'play-1'), false);
  const [entry] = await tally.top('u', 200);
  assert.ok(Math.abs(currentWeight(entry?.score ?? 0, playedAt) - 1.5) < 1e-8);
  for (let index = 0; index < 16; index += 1) {
    assert.equal(await tally.record('u', song(2), 1, playedAt + index + 10_000, `other-${index}`), true);
  }
  assert.equal(await tally.record('u', song(2), 1, playedAt, 'evicted-0'), true);
});

test('keeps the last eight listen timestamps for idempotency', async () => {
  const tally = new MemoryTasteTally(() => NOW);
  const start = NOW - 20 * DAY;
  for (let index = 0; index < 8; index += 1) {
    assert.equal(await tally.record('u', song(1), 60, start + index * 1000), true);
  }
  assert.equal(await tally.record('u', song(1), 60, start + 8_000), true);
  assert.equal(await tally.record('u', song(1), 60, start + 7_000), false);
  assert.equal(await tally.record('u', song(1), 60, start), true);
});

test('caps a listener at 200 rows and evicts the lowest score', async () => {
  const tally = new MemoryTasteTally(() => NOW);
  for (let index = 1; index <= 201; index += 1) {
    assert.equal(await tally.record('u', song(index), index * 60, NOW), true);
  }
  const entries = await tally.top('u', 200);
  assert.equal(entries.length, 200);
  assert.equal(entries.some((entry) => entry.identity === identityKey(song(1).title, song(1).artist)), false);
});

test('deletes a row when a skip brings its score to zero', async () => {
  const tally = new MemoryTasteTally(() => NOW);
  assert.equal(await tally.record('u', song(1), 30, NOW - 1000), true);
  assert.equal(await tally.record('u', song(1), 0, NOW), true);
  assert.equal((await tally.top('u', 200)).length, 0);
});

test('removes a delayed like bonus without changing other listens', async () => {
  const tally = new MemoryTasteTally(() => NOW);
  const picked = song(1);
  const firstListenAt = NOW - 20 * DAY;
  const likeAt = NOW - 12 * DAY;
  const secondListenAt = NOW - 5 * DAY;
  assert.equal(await tally.record('u', picked, 120, firstListenAt), true);
  await tally.bonus('u', picked, 'like', likeAt);
  assert.equal(await tally.record('u', picked, 180, secondListenAt), true);
  const expected = addDecayed(0, 2, firstListenAt) + addDecayed(0, 3, secondListenAt);
  await tally.bonus('u', picked, 'like', NOW - 10 * DAY);
  await tally.bonus('u', picked, 'unlike', NOW);
  const [afterUnlike] = await tally.top('u', 200);
  assert.ok(Math.abs((afterUnlike?.score ?? 0) - expected) < 1e-8);
  await tally.bonus('u', picked, 'unlike', NOW);
  const [afterRepeatedUnlike] = await tally.top('u', 200);
  assert.ok(Math.abs((afterRepeatedUnlike?.score ?? 0) - expected) < 1e-8);
});

test('adds a playlist bonus to a song without a tally row', async () => {
  const tally = new MemoryTasteTally(() => NOW);
  const at = NOW - 2 * DAY;
  await tally.bonus('u', song(4), 'playlistAdd', at);
  const [entry] = await tally.top('u', 200);
  assert.equal(entry?.identity, identityKey(song(4).title, song(4).artist));
  assert.ok(Math.abs(currentWeight(entry?.score ?? 0, at) - 5) < 1e-9);
});

test('seeds likes, items and recents only once', async () => {
  const tally = new MemoryTasteTally(() => NOW);
  const input = {
    likes: [{ song: song(1), at: NOW - DAY }],
    items: [{ song: song(2), at: NOW - 2 * DAY }],
    recents: [{ song: song(3), at: NOW - 3 * DAY }]
  };
  await tally.seed('u', input);
  const first = await tally.top('u', 200);
  await tally.seed('u', { ...input, likes: [{ song: song(4), at: NOW }] });
  const second = await tally.top('u', 200);
  assert.deepEqual(second, first);
  assert.deepEqual(new Set(first.map((entry) => entry.identity)), new Set([
    identityKey(song(1).title, song(1).artist),
    identityKey(song(2).title, song(2).artist),
    identityKey(song(3).title, song(3).artist)
  ]));
  const byIdentity = new Map(first.map((entry) => [entry.identity, entry.score]));
  assert.ok(Math.abs(currentWeight(byIdentity.get(identityKey(song(1).title, song(1).artist)) ?? 0, NOW - DAY) - 10) < 1e-9);
  assert.ok(Math.abs(currentWeight(byIdentity.get(identityKey(song(2).title, song(2).artist)) ?? 0, NOW - 2 * DAY) - 5) < 1e-9);
  assert.ok(Math.abs(currentWeight(byIdentity.get(identityKey(song(3).title, song(3).artist)) ?? 0, NOW - 3 * DAY) - 3) < 1e-9);
});

test('an unlike reverses a like bonus introduced by the one-time seed', async () => {
  const tally = new MemoryTasteTally(() => NOW);
  await tally.seed('u', { likes: [{ song: song(1), at: NOW - DAY }], items: [], recents: [] });
  await tally.bonus('u', song(1), 'unlike', NOW);
  assert.deepEqual(await tally.top('u', 200), []);
});

test('clear removes all tally rows and the seed marker', async () => {
  const tally = new MemoryTasteTally(() => NOW);
  for (let index = 0; index < 250; index += 1) {
    await tally.bonus('u', song(index), 'playlistAdd', NOW);
  }
  await tally.seed('u', { likes: [], items: [], recents: [] });
  await tally.clear('u');
  assert.deepEqual(await tally.top('u', 200), []);
  await tally.seed('u', { likes: [{ song: song(1), at: NOW }], items: [], recents: [] });
  assert.equal((await tally.top('u', 200)).length, 1);
});
