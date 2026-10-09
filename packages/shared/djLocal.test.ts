import assert from 'node:assert/strict';
import test from 'node:test';

import type { UnifiedSong } from './types.ts';
import {
  heuristicDjLocalIntent,
  rankDjLocalCandidates,
  resolveDjLocalIntent,
  type DjLocalCandidate,
  type DjLocalIntentContext
} from './djLocal.ts';

const context: DjLocalIntentContext = {
  goal: 'mix',
  message: 'Late night Tamil melodies',
  session: { vibe: '', energy: 3, language: null, constraints: [] },
  current: { id: 's1', title: 'Kadhal Rojave', artist: 'A. R. Rahman' },
  draft: [],
  draftName: ''
};

test('a sloppy model answer still yields a usable intent', () => {
  const output = '<think>hmm</think>```json\n{"reply":"On it","vibe":"late night","energy":"2","operation":"INSERT","searchQueries":["tamil melodies",],}\n```';
  const intent = resolveDjLocalIntent(output, context);
  assert.equal(intent.reply, 'On it');
  assert.equal(intent.energy, 2);
  assert.equal(intent.operation, 'replace_upcoming', 'insert without insertAfter degrades safely');
  assert.deepEqual(intent.searchQueries, ['tamil melodies']);
  assert.equal(intent.reaction, 'curious');
});

test('unparseable or empty output falls back to the request itself', () => {
  for (const output of ['', 'Sure! Here are some songs', '<think>never closed']) {
    const intent = resolveDjLocalIntent(output, context);
    assert.ok(intent.searchQueries.length > 0);
    assert.equal(intent.language, 'tamil');
    assert.equal(intent.languageAction, 'set');
    assert.equal(intent.operation, 'replace_upcoming');
  }
});

test('a model that omits searchQueries still searches', () => {
  const intent = resolveDjLocalIntent('{"reply":"ok","vibe":"x"}', context);
  assert.ok(intent.searchQueries.some((query) => /tamil/i.test(query)));
});

test('playlist removals only keep ids that are in the draft', () => {
  const draftContext: DjLocalIntentContext = {
    ...context,
    goal: 'playlist',
    message: 'remove the second one',
    draft: [{ song: { id: 'a', title: 'A', artist: 'X' } as never, reason: '' }]
  };
  const intent = resolveDjLocalIntent('{"removeTrackIds":["a","ghost"],"searchQueries":[]}', draftContext);
  assert.deepEqual(intent.removeTrackIds, ['a']);
  assert.deepEqual(intent.searchQueries, []);
  assert.equal(intent.operation, 'keep');
});

test('heuristics read "after N", "like this" and "no X songs"', () => {
  const intent = heuristicDjLocalIntent({ ...context, message: 'something like this after 2, no sad songs' });
  assert.equal(intent.operation, 'insert');
  assert.equal(intent.insertAfter, 2);
  assert.deepEqual(intent.addConstraints, ['no sad songs']);
  assert.ok(intent.searchQueries.includes('A. R. Rahman'));
});

function song(overrides: Partial<UnifiedSong> & Pick<UnifiedSong, 'id' | 'title' | 'artist'>): UnifiedSong {
  return {
    artwork: 'https://example.test/art.jpg',
    streamUrl: `https://example.test/${overrides.id}.mp3`,
    duration: 200,
    hasLyrics: false,
    playCount: 0,
    source: 'Saavn',
    ...overrides
  };
}

const QUERIES = ['late night tamil melodies', 'tamil hits'];
const ECHO_IDS = ['echo1', 'echo2', 'echo3'];
const SKIPPED_ID = 'skip2';

function liveFailureCandidates(): DjLocalCandidate[] {
  const q0 = (item: UnifiedSong): DjLocalCandidate => ({ song: item, queryIndex: 0 });
  const q1 = (item: UnifiedSong): DjLocalCandidate => ({ song: item, queryIndex: 1 });
  return [
    q0(song({ id: 'echo1', title: 'Late Night', artist: 'Studio Echo', language: 'tamil' })),
    q0(song({ id: 'echo2', title: 'Latenight', artist: 'Mono Fields', language: 'tamil' })),
    q0(song({ id: 'echo3', title: 'A Late Night Walk', artist: 'Quiet Harbour', language: 'tamil' })),
    q0(song({ id: 'ta1', title: 'Vaanam Paarthen', artist: 'Anirudh Ravi', language: 'tamil' })),
    q0(song({ id: 'ta2', title: 'Kaatru Veliyidai', artist: 'Sid Mohan', language: 'tamil' })),
    q0(song({ id: 'ta3', title: 'Mazhai Thuli', artist: 'Harini Devi', language: 'tamil' })),
    q0(song({ id: 'ta4', title: 'Nenjukkul', artist: 'Karthik Raj', language: 'tamil' })),
    q1(song({ id: 'like1', title: 'First Light', artist: 'Liked Artist' })),
    q1(song({ id: 'like2', title: 'Second Light', artist: 'Liked Artist' })),
    q1(song({ id: 'cur2', title: 'Another Hour', artist: 'Playing Now' })),
    q1(song({ id: SKIPPED_ID, title: 'Rough Cut', artist: 'Skipped Band' }))
  ];
}

function liveFailurePicks() {
  return rankDjLocalCandidates({
    candidates: liveFailureCandidates(),
    queries: QUERIES,
    goal: 'mix',
    songLimit: 8,
    language: 'tamil',
    current: { id: 'cur1', title: 'Playing', artist: 'Playing Now' },
    recent: [],
    liked: [{ id: 'l0', title: 'Old Favourite', artist: 'Liked Artist' }],
    skipped: [{ id: 'sk0', title: 'Nope', artist: 'Skipped Band' }],
    draft: [],
    strategy: 'replace',
    removeTrackIds: []
  });
}

test('songs only titled like the request are not the top picks', () => {
  const top = liveFailurePicks().slice(0, 5).map(({ song: picked }) => picked.id);
  for (const id of ECHO_IDS) assert.ok(!top.includes(id), `${id} should not be in the top 5: ${top.join(', ')}`);
});

test('adjacent picks never share a reason', () => {
  const picks = liveFailurePicks();
  for (let i = 1; i < picks.length; i += 1) {
    assert.notEqual(picks[i]?.reason, picks[i - 1]?.reason, `picks ${i - 1} and ${i} repeat "${picks[i]?.reason}"`);
  }
});

test('a language reason appears only on songs the catalog labelled with that language', () => {
  for (const { song: picked, reason } of liveFailurePicks()) {
    if (/A Tamil pick/.test(reason)) assert.equal(picked.language, 'tamil', `${picked.id} was not labelled tamil`);
  }
});

test('a skipped artist is not picked while other songs are available', () => {
  const ids = liveFailurePicks().map(({ song: picked }) => picked.id);
  assert.equal(ids.length, 8);
  assert.ok(!ids.includes(SKIPPED_ID));
});

test('no lead artist fills more than two slots', () => {
  const counts = new Map<string, number>();
  for (const { song: picked } of liveFailurePicks()) {
    counts.set(picked.artist, (counts.get(picked.artist) ?? 0) + 1);
  }
  for (const [artist, count] of counts) assert.ok(count <= 2, `${artist} has ${count} picks`);
});

test('a language in the session reaches the catalog searches on the model path', () => {
  const intent = resolveDjLocalIntent(
    '{"searchQueries":["late night tamil melodies"],"languageAction":"set","language":"tamil"}',
    context
  );
  assert.ok(
    intent.searchQueries.some((query) => query === 'tamil melodies' || query === 'tamil hits'),
    `queries were ${intent.searchQueries.join(' | ')}`
  );
});
