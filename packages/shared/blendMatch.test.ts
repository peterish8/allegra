import assert from 'node:assert/strict';
import test from 'node:test';

import { FACTS, simCases, world } from './blendFixtures.ts';
import { explainChange, MATCH, pairMatch } from './blendMatch.ts';
import { memberTaste } from './blendTaste.ts';
import type { PairMatch } from './blendTypes.ts';

/** PLAN.md §4.6, highest first; each row must score at or above the next. */
const TABLE: [string, number][] = [
  ['same listener, other days', 86],
  ['both Arijit-heavy, different 2nd artist', 70],
  ['900 imported likes vs 60-song listener', 66],
  ['shared niche indie + some pop', 62],
  ['broad vs narrow subset', 48],
  ['neighbours only (Arijit vs Pritam/Atif)', 44],
  ['thin profile (3 songs each, same artist)', 44],
  ['superstar only overlap (Arijit)', 37],
  ['same language, no shared artist', 26],
  ['Tamil vs Punjabi', 8]
];

const cases = simCases();
const scoreOf = (name: string): PairMatch => {
  const pair = cases[name];
  assert.ok(pair, name);
  return pairMatch(pair[0], pair[1], FACTS);
};

test('the simulated pairs score in the order of the plan table', () => {
  const scores = TABLE.map(([name]) => scoreOf(name).match);
  for (let i = 1; i < scores.length; i++) {
    assert.ok((scores[i - 1] ?? 0) >= (scores[i] ?? 0), `${TABLE[i - 1]?.[0]} (${scores[i - 1]}) should be ≥ ${TABLE[i]?.[0]} (${scores[i]})`);
  }
});

test('each simulated pair is within 3 points of the plan table (a faithful port)', () => {
  for (const [name, expected] of TABLE) {
    const { match } = scoreOf(name);
    assert.ok(Math.abs(match - expected) <= 3, `${name}: ${match} vs ${expected}`);
  }
});

test('the two directions match the plan for broad vs narrow', () => {
  const pair = cases['broad vs narrow subset'];
  assert.ok(pair);
  const result = pairMatch(pair[0], pair[1], FACTS);
  const broad = pair[0].userId;
  const narrowEnjoysBroad = result.a === broad ? result.cover.a : result.cover.b;
  const broadEnjoysNarrow = result.a === broad ? result.cover.b : result.cover.a;
  assert.ok(Math.abs(narrowEnjoysBroad - 0.26) < 0.03);
  assert.ok(Math.abs(broadEnjoysNarrow - 0.93) < 0.03);
});

test('the match is symmetric and the cover values swap', () => {
  for (const [a, b] of Object.values(cases)) {
    const ab = pairMatch(a, b, FACTS);
    const ba = pairMatch(b, a, FACTS);
    assert.deepEqual(ab, ba);
    assert.ok(ab.a < ab.b);
  }
});

test('every output is finite and the match is an integer from 0 to 99, over 200 random pairs', () => {
  const listener = world(12345);
  const artists = [...FACTS.keys()];
  let seed = 1;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let n = 0; n < 200; n++) {
    const mix = () => {
      const chosen: Record<string, number> = {};
      const count = 1 + Math.floor(random() * 4);
      for (let k = 0; k < count; k++) chosen[artists[Math.floor(random() * artists.length)] ?? 'arijit'] = random() + 0.01;
      return chosen;
    };
    const result = pairMatch(listener(mix(), 1 + Math.floor(random() * 40)), listener(mix(), 1 + Math.floor(random() * 40)), FACTS);
    assert.ok(Number.isInteger(result.match) && result.match >= 0 && result.match <= 99);
    for (const value of [result.cover.a, result.cover.b, result.rare, ...result.contributions.map((c) => c.value)]) assert.ok(Number.isFinite(value));
  }
});

test('a thin pair has low confidence ("Early days")', () => {
  assert.equal(scoreOf('thin profile (3 songs each, same artist)').confidence, 'low');
  assert.equal(scoreOf('same listener, other days').confidence, 'normal');
});

test('an empty member scores 0 with low confidence', () => {
  const empty = memberTaste({ userId: 'z', now: [], loved: [], kept: [], learning: true, facts: FACTS });
  const [someone] = cases['same listener, other days'] ?? [];
  assert.ok(someone);
  const result = pairMatch(someone, empty, FACTS);
  assert.equal(result.match, 0);
  assert.equal(result.confidence, 'low');
});

test('the artist that brings a pair together prefers a shared niche artist over a superstar', () => {
  assert.equal(scoreOf('shared niche indie + some pop').together, 'indiex');
  assert.equal(scoreOf('both Arijit-heavy, different 2nd artist').together, 'arijit');
  assert.equal(scoreOf('Tamil vs Punjabi').together, '');
});

test('contributions keep at most 10 artists, largest first', () => {
  const { contributions } = scoreOf('broad vs narrow subset');
  assert.ok(contributions.length <= MATCH.contributionsKept);
  for (let i = 1; i < contributions.length; i++) assert.ok((contributions[i - 1]?.value ?? 0) >= (contributions[i]?.value ?? 0));
});

test('explainChange is null under 5 points and otherwise names the artist that moved most', () => {
  const base: PairMatch = {
    a: 'a', b: 'b', match: 50, cover: { a: 0.5, b: 0.5 }, rare: 0, confidence: 'normal', together: 'x',
    contributions: [{ artist: 'arijit', value: 0.3 }, { artist: 'pritam', value: 0.1 }]
  };
  assert.equal(explainChange(undefined, base), null);
  assert.equal(explainChange(base, { ...base, match: 54 }), null);
  assert.deepEqual(
    explainChange(base, { ...base, match: 57, contributions: [{ artist: 'arijit', value: 0.32 }, { artist: 'pritam', value: 0.3 }] }),
    { kind: 'up', points: 7, artist: 'pritam' }
  );
  assert.deepEqual(
    explainChange(base, { ...base, match: 40, contributions: [{ artist: 'pritam', value: 0.1 }] }),
    { kind: 'down', points: 10, artist: 'arijit' }
  );
});

test('the constants are the plan values', () => {
  assert.deepEqual(MATCH.level, { song: 1, artist: 0.85, similar: 0.4, language: 0.15 });
  assert.equal(MATCH.fullAffinityShare, 0.02);
  assert.equal(MATCH.languageShare, 0.1);
  assert.equal(MATCH.rareBonus, 0.5);
  assert.equal(MATCH.shrinkK, 8);
  assert.equal(MATCH.prior, 0.2);
  assert.equal(MATCH.gamma, 0.75);
});
