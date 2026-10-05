import assert from 'node:assert/strict';
import test from 'node:test';

import { artistOf, FACTS, simCases, world } from './blendFixtures.ts';
import { pairMatch } from './blendMatch.ts';
import { giftFor, groupGlue, songPopularity, storiesFor, togetherSong, type Story } from './blendStories.ts';
import type { BlendTrack, MemberTaste, PairMatch } from './blendTypes.ts';
import type { SongRef } from './songRef.ts';

const cases = simCases();

/** Play counts that give each song its artist's popularity, as the simulation assumes. */
function playCountsFor(a: MemberTaste, b: MemberTaste): Map<string, number> {
  const counts = new Map<string, number>();
  for (const identity of new Set([...a.songs.keys(), ...b.songs.keys()])) {
    const popularity = FACTS.get(artistOf(identity))?.popularity ?? 0.5;
    counts.set(identity, 10 ** (8 * popularity) - 1);
  }
  return counts;
}

function together(name: string) {
  const pair = cases[name];
  assert.ok(pair, name);
  return togetherSong(pair[0], pair[1], FACTS, playCountsFor(pair[0], pair[1]));
}

test('two Arijit-heavy listeners get an Arijit song both play', () => {
  const song = together('both Arijit-heavy, different 2nd artist');
  assert.equal(song?.variant, 'together');
  assert.equal(artistOf(song?.identity ?? ''), 'arijit');
});

test('a pair sharing a niche band gets that band, not the shared superstar', () => {
  const song = together('shared niche indie + some pop');
  assert.equal(song?.variant, 'together');
  assert.equal(artistOf(song?.identity ?? ''), 'indiex');
});

test('similar artists only reads "the closest you get"; nothing in common gives no card', () => {
  assert.equal(together('neighbours only (Arijit vs Pritam/Atif)')?.variant, 'closest');
  assert.equal(together('same language, no shared artist'), null);
  assert.equal(together('Tamil vs Punjabi'), null);
});

test('song popularity is log-scaled to 100 M plays, and unknown is the middle', () => {
  assert.equal(songPopularity(0), 0);
  assert.equal(songPopularity(1e8 - 1), 1);
  assert.equal(songPopularity(1e12), 1);
  assert.equal(songPopularity(undefined), 0.5);
});

test('a gift is a favourite the other has not got, by an artist similar to one they like', () => {
  const pair = cases['neighbours only (Arijit vs Pritam/Atif)'];
  assert.ok(pair);
  const [arijitFan, pritamAtifFan] = pair;
  const gift = giftFor(pritamAtifFan, arijitFan, FACTS);
  assert.ok(gift);
  assert.ok(['pritam', 'atif'].includes(artistOf(gift)));
  const tamil = cases['Tamil vs Punjabi'];
  assert.ok(tamil);
  assert.equal(giftFor(tamil[0], tamil[1], FACTS), null);
});

const track = (id: string, forWho: string[]): BlendTrack => ({
  song: { ref: `saavn:${id}` as SongRef, title: id, artist: 'x', artwork: '', duration: 1 },
  for: forWho,
  kind: forWho.length >= 2 ? 'shared' : forWho.length === 1 ? 'pick' : 'discovery'
});

const pair = (a: string, b: string, match: number, extra: Partial<PairMatch> = {}): PairMatch => ({
  a, b, match, cover: { a: 0.26, b: 0.93 }, rare: 0, confidence: 'normal', together: 'arijit', contributions: [], ...extra
});

test('a two-person Blend shows match, song, directions, artist, gifts and brought, in that order, at most 6', () => {
  const stories = storiesFor({
    viewerId: 'asha',
    members: [{ userId: 'asha', joinedAt: 1 }, { userId: 'ravi', joinedAt: 2 }],
    pairs: [pair('asha', 'ravi', 70)],
    previousPairs: [],
    together: { identity: 'arijit#1', variant: 'together' },
    gifts: [{ fromUserId: 'asha', toUserId: 'ravi', identity: 'atif#2' }],
    tracks: [track('1', ['asha']), track('2', ['asha', 'ravi']), track('3', ['ravi']), track('4', [])],
    glue: []
  });
  assert.deepEqual(stories.map((story) => story.kind), ['match', 'song', 'directions', 'artist', 'gift', 'brought']);
  const directions = stories[2] as Extract<Story, { kind: 'directions' }>;
  assert.deepEqual(directions, { kind: 'directions', youEnjoyTheirs: 93, theyEnjoyYours: 26, otherUserId: 'ravi' });
  const brought = stories[5] as Extract<Story, { kind: 'brought' }>;
  assert.deepEqual(brought.counts, [{ userId: 'asha', songs: 2 }, { userId: 'ravi', songs: 2 }]);

  const asRavi = storiesFor({ viewerId: 'ravi', members: [{ userId: 'asha', joinedAt: 1 }, { userId: 'ravi', joinedAt: 2 }], pairs: [pair('asha', 'ravi', 70)], previousPairs: [], together: null, gifts: [], tracks: [], glue: [] });
  assert.deepEqual(asRavi.find((story) => story.kind === 'directions'), { kind: 'directions', youEnjoyTheirs: 26, theyEnjoyYours: 93, otherUserId: 'asha' });
  assert.equal(asRavi.some((story) => story.kind === 'song'), false);
});

test('the match card carries the change reason when the match moved 5 or more', () => {
  const previous = pair('asha', 'ravi', 60, { contributions: [{ artist: 'arijit', value: 0.2 }] });
  const next = pair('asha', 'ravi', 68, { contributions: [{ artist: 'arijit', value: 0.4 }] });
  const [first] = storiesFor({ viewerId: 'asha', members: [{ userId: 'asha', joinedAt: 1 }, { userId: 'ravi', joinedAt: 2 }], pairs: [next], previousPairs: [previous], together: null, gifts: [], tracks: [], glue: [] });
  assert.deepEqual(first, { kind: 'match', match: 68, confidence: 'normal', change: { kind: 'up', points: 8, artist: 'arijit' } });
});

test('a group shows group match, most and least in tune for the viewer, and glue; never a song card', () => {
  const members = [{ userId: 'a', joinedAt: 1 }, { userId: 'b', joinedAt: 2 }, { userId: 'c', joinedAt: 3 }, { userId: 'd', joinedAt: 4 }];
  const pairs = [pair('a', 'b', 60), pair('a', 'c', 60), pair('a', 'd', 20), pair('b', 'c', 50), pair('b', 'd', 40), pair('c', 'd', 70)];
  const stories = storiesFor({
    viewerId: 'a', members, pairs, previousPairs: [],
    together: { identity: 'arijit#1', variant: 'together' },
    gifts: [{ fromUserId: 'a', toUserId: 'b', identity: 'x' }],
    tracks: [], glue: ['arijit']
  });
  assert.deepEqual(stories.map((story) => story.kind), ['groupMatch', 'mostInTune', 'leastInTune', 'glue']);
  assert.deepEqual(stories[0], { kind: 'groupMatch', match: 50 });
  // b and c tie at 60: b joined first.
  assert.deepEqual(stories[1], { kind: 'mostInTune', userId: 'b', match: 60 });
  assert.deepEqual(stories[2], { kind: 'leastInTune', userId: 'd', match: 20 });
  assert.equal(stories.some((story) => story.kind === 'song'), false);
});

test('groups of 3 and 6 get the group cards and never a song card', () => {
  for (const size of [3, 6]) {
    const members = Array.from({ length: size }, (_, n) => ({ userId: `m${n}`, joinedAt: n }));
    const pairs: PairMatch[] = [];
    for (let i = 0; i < size; i++) for (let j = i + 1; j < size; j++) pairs.push(pair(`m${i}`, `m${j}`, 40 + i + j));
    const stories = storiesFor({ viewerId: 'm0', members, pairs, previousPairs: [], together: { identity: 'x', variant: 'together' }, gifts: [], tracks: [], glue: ['arijit'] });
    assert.deepEqual(stories.map((story) => story.kind), ['groupMatch', 'mostInTune', 'leastInTune', 'glue']);
    assert.deepEqual(stories[1], { kind: 'mostInTune', userId: `m${size - 1}`, match: 40 + size - 1 });
    assert.deepEqual(stories[2], { kind: 'leastInTune', userId: 'm1', match: 41 });
  }
});

test('glue holds artists that at least half the group likes', () => {
  const listener = world(5);
  const members = [listener({ arijit: 0.5, rahman: 0.5 }), listener({ arijit: 0.5, diljit: 0.5 }), listener({ weeknd: 1 }), listener({ arijit: 1 })];
  assert.deepEqual(groupGlue(members), ['arijit']);
  assert.ok(pairMatch(members[0] as MemberTaste, members[1] as MemberTaste, FACTS).match > 0);
});
