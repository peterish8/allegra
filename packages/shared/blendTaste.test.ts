import assert from 'node:assert/strict';
import test from 'node:test';

import { ARTIST_CREDIT, LAYER_BETA, memberTaste } from './blendTaste.ts';
import type { ArtistFactsMap, TasteItem } from './blendTypes.ts';

const NO_FACTS: ArtistFactsMap = new Map();
const items = (prefix: string, count: number, artist = 'Artist'): TasteItem[] =>
  Array.from({ length: count }, (_, n) => ({ identity: `${prefix}${n}`, artist: `${artist} ${n % 5}` }));
const sum = (values: Iterable<number>): number => [...values].reduce((total, value) => total + value, 0);

test('p and q each sum to 1 for any non-empty input', () => {
  const taste = memberTaste({
    userId: 'u',
    now: items('n', 30).map((item, n) => ({ ...item, weight: n + 1 })),
    loved: items('l', 70),
    kept: items('k', 12, 'Other, Guest & Third'),
    learning: true,
    facts: NO_FACTS
  });
  assert.ok(Math.abs(sum(taste.songs.values()) - 1) < 1e-9);
  assert.ok(Math.abs(sum(taste.artists.values()) - 1) < 1e-9);
});

test('a Loved layer of 900 and one of 60 contribute the same total', () => {
  const kept = items('k', 20);
  const big = memberTaste({ userId: 'a', now: [], loved: items('l', 900), kept, learning: true, facts: NO_FACTS });
  const small = memberTaste({ userId: 'b', now: [], loved: items('l', 60), kept, learning: true, facts: NO_FACTS });
  const lovedShare = (taste: ReturnType<typeof memberTaste>) => sum([...taste.songs].filter(([id]) => id.startsWith('l')).map(([, p]) => p));
  assert.ok(Math.abs(lovedShare(big) - lovedShare(small)) < 1e-9);
  assert.ok(Math.abs(lovedShare(big) - LAYER_BETA.loved / (LAYER_BETA.loved + LAYER_BETA.kept)) < 1e-9);
});

test('βnow ramps with the tally size and reaches 0.6 at 50 songs', () => {
  const nowShare = (count: number) => {
    const taste = memberTaste({ userId: 'u', now: items('n', count), loved: items('l', 40), kept: items('k', 40), learning: true, facts: NO_FACTS });
    return sum([...taste.songs].filter(([id]) => id.startsWith('n')).map(([, p]) => p));
  };
  const ramp = (count: number) => LAYER_BETA.nowMax * Math.min(1, count / LAYER_BETA.nowFullAt);
  for (const count of [5, 25, 50, 120]) {
    const beta = ramp(count);
    assert.ok(Math.abs(nowShare(count) - beta / (beta + LAYER_BETA.loved + LAYER_BETA.kept)) < 1e-9, `count ${count}`);
  }
  assert.ok(nowShare(25) < nowShare(50));
  assert.ok(Math.abs(nowShare(50) - nowShare(120)) < 1e-9);
});

test('with learning off the Now layer is ignored', () => {
  const taste = memberTaste({ userId: 'u', now: items('n', 80), loved: items('l', 10), kept: [], learning: false, facts: NO_FACTS });
  assert.equal([...taste.songs.keys()].some((id) => id.startsWith('n')), false);
  assert.ok(Math.abs(sum(taste.songs.values()) - 1) < 1e-9);
});

test('a song by "A, B & C" gives A two thirds and B, C a sixth each', () => {
  const taste = memberTaste({ userId: 'u', now: [], loved: [{ identity: 's', artist: 'A, B & C' }], kept: [], learning: true, facts: NO_FACTS });
  assert.ok(Math.abs((taste.artists.get('a') ?? 0) - ARTIST_CREDIT.lead) < 1e-12);
  assert.ok(Math.abs((taste.artists.get('b') ?? 0) - 1 / 6) < 1e-12);
  assert.ok(Math.abs((taste.artists.get('c') ?? 0) - 1 / 6) < 1e-12);
  assert.equal(taste.songArtist.get('s'), 'a');
});

test('nEff is 1 / Σ p²', () => {
  const taste = memberTaste({ userId: 'u', now: [], loved: items('l', 4), kept: [], learning: true, facts: NO_FACTS });
  assert.ok(Math.abs(taste.nEff - 4) < 1e-9);
});

test('empty input gives empty maps and nEff 0', () => {
  const taste = memberTaste({ userId: 'u', now: [], loved: [], kept: [], learning: true, facts: NO_FACTS });
  assert.equal(taste.songs.size, 0);
  assert.equal(taste.artists.size, 0);
  assert.equal(taste.languages.size, 0);
  assert.equal(taste.nEff, 0);
});

test('inactive Now evidence loses influence instead of normalizing its decay away', () => {
  const input = { userId: 'u', now: items('n', 50), loved: items('l', 50), kept: [], learning: true, facts: NO_FACTS };
  const fresh = memberTaste(input);
  const faded = memberTaste({ ...input, now: input.now.map((item) => ({ ...item, weight: 0.25 })) });
  const expired = memberTaste({ ...input, now: input.now.map((item) => ({ ...item, weight: 0.01 })) });
  assert.ok((fresh.songs.get('n0') ?? 0) > (faded.songs.get('n0') ?? 0));
  assert.equal(expired.songs.has('n0'), false);
  assert.ok(expired.songs.has('l0'));
});

test('an identity in two layers sums its shares', () => {
  const taste = memberTaste({ userId: 'u', now: [], loved: [{ identity: 'x', artist: 'A' }, { identity: 'y', artist: 'B' }], kept: [{ identity: 'x', artist: 'A' }], learning: true, facts: NO_FACTS });
  assert.ok(Math.abs((taste.songs.get('x') ?? 0) - (0.75 * 0.5 + 0.25 * 1)) < 1e-12);
});

test('languages are weighted by artist share and sum to the share of artists with a known language', () => {
  const facts: ArtistFactsMap = new Map([
    ['a', { key: 'a', popularity: 0.5, language: 'hindi', similar: [] }],
    ['b', { key: 'b', popularity: 0.5, language: 'tamil', similar: [] }]
  ]);
  const taste = memberTaste({
    userId: 'u',
    now: [],
    loved: [{ identity: '1', artist: 'A' }, { identity: '2', artist: 'A' }, { identity: '3', artist: 'B' }, { identity: '4', artist: 'Unknown' }],
    kept: [],
    learning: true,
    facts
  });
  assert.ok(Math.abs((taste.languages.get('hindi') ?? 0) - 0.5) < 1e-12);
  assert.ok(Math.abs((taste.languages.get('tamil') ?? 0) - 0.25) < 1e-12);
  assert.ok(Math.abs(sum(taste.languages.values()) - 0.75) < 1e-12);
});
