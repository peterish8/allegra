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

test('"like this, but not the same artist" searches by the song and rules the artist out', () => {
  const intent = heuristicDjLocalIntent({ ...context, message: 'something like this but not the same artist' });
  assert.deepEqual(intent.excludeArtists, ['a. r. rahman']);
  assert.ok(intent.searchQueries.includes('Kadhal Rojave'));
  assert.ok(!intent.searchQueries.some((query) => /rahman/i.test(query)), `queries were ${intent.searchQueries.join(' | ')}`);
});

test('"no songs by X" rules X out; "only X" and "all X songs" keep to X; moods and languages are not names', () => {
  assert.deepEqual(heuristicDjLocalIntent({ ...context, message: 'chill songs, no songs by Anirudh tonight' }).excludeArtists, ['anirudh']);
  assert.equal(heuristicDjLocalIntent({ ...context, message: 'only Anirudh please' }).onlyArtist, 'anirudh');
  assert.equal(heuristicDjLocalIntent({ ...context, message: 'all Arijit Singh songs' }).onlyArtist, 'arijit singh');
  assert.equal(heuristicDjLocalIntent({ ...context, message: 'only tamil songs' }).onlyArtist, null);
  assert.equal(heuristicDjLocalIntent({ ...context, message: 'just something calm' }).onlyArtist, null);
  const only = heuristicDjLocalIntent({ ...context, message: 'only Anirudh please' });
  assert.ok(only.searchQueries.includes('anirudh'));
});

test('the model can add exclusions but never drop the ones the request made', () => {
  const intent = resolveDjLocalIntent('{"excludeArtists":["Sid Sriram"]}', { ...context, message: 'no songs by Anirudh' });
  assert.deepEqual(intent.excludeArtists, ['anirudh', 'sid sriram']);
});

function rank(overrides: Partial<Parameters<typeof rankDjLocalCandidates>[0]> & Pick<Parameters<typeof rankDjLocalCandidates>[0], 'candidates'>) {
  return rankDjLocalCandidates({
    queries: ['tamil songs'], goal: 'mix', songLimit: 8, language: null, current: null,
    recent: [], liked: [], skipped: [], draft: [], strategy: 'replace', removeTrackIds: [],
    ...overrides
  });
}

const POOL: DjLocalCandidate[] = [
  { song: song({ id: 'a1', title: 'One', artist: 'Anirudh Ravichander' }), queryIndex: 0 },
  { song: song({ id: 'a2', title: 'Two', artist: 'Anirudh Ravichander, Dhee' }), queryIndex: 0 },
  { song: song({ id: 'a3', title: 'Three', artist: 'Anirudh Ravichander' }), queryIndex: 0 },
  { song: song({ id: 's1', title: 'Four', artist: 'Sid Sriram' }), queryIndex: 0 },
  { song: song({ id: 'h1', title: 'Five', artist: 'Harini' }), queryIndex: 0 },
  { song: song({ id: 'x1', title: 'Six', artist: 'Silent One', streamUrl: '' }), queryIndex: 0 }
];

test('hard filters: an excluded artist and a song with no stream are never picked', () => {
  const ids = rank({ candidates: POOL, excludeArtists: ['anirudh'] }).map(({ song: picked }) => picked.id);
  assert.deepEqual([...ids].sort(), ['h1', 's1']);
});

test('"only X" keeps to X and lifts the two-per-artist cap', () => {
  const picks = rank({ candidates: POOL, onlyArtist: 'anirudh' });
  assert.equal(picks.length, 3);
  assert.ok(picks.every(({ song: picked }) => /anirudh/i.test(picked.artist)));
  assert.equal(picks[0]?.reason, 'You asked for Anirudh Ravichander.');
  assert.ok(picks.every(({ reason }) => reason.includes('Anirudh Ravichander')), picks.map((pick) => pick.reason).join(' | '));
});

test('a featured artist counts toward the two-song limit, not only the one listed first', () => {
  const featured: DjLocalCandidate[] = [
    { song: song({ id: 'f1', title: 'One', artist: 'Vivek, Sai Abhyankkar' }), queryIndex: 0 },
    { song: song({ id: 'f2', title: 'Two', artist: 'Pa. Vijay, Sai Abhyankkar' }), queryIndex: 0 },
    { song: song({ id: 'f3', title: 'Three', artist: 'Rokesh, Sai Abhyankkar' }), queryIndex: 0 },
    { song: song({ id: 'f4', title: 'Four', artist: 'Dholu Bholu & Sai Abhyankkar' }), queryIndex: 0 },
    { song: song({ id: 'o1', title: 'Five', artist: 'G.V. Prakash Kumar' }), queryIndex: 1 },
    { song: song({ id: 'o2', title: 'Six', artist: 'Harini' }), queryIndex: 1 }
  ];
  const picks = rank({ candidates: featured, songLimit: 4 });
  const withSai = picks.filter(({ song: picked }) => /Sai Abhyankkar/.test(picked.artist));
  assert.equal(withSai.length, 2, picks.map(({ song: picked }) => picked.artist).join(' | '));
  assert.ok(picks.some(({ song: picked }) => picked.id === 'o1') && picks.some(({ song: picked }) => picked.id === 'o2'));
});

test('no artist plays twice in a row when another order allows it', () => {
  const picks = rank({ candidates: POOL });
  for (let index = 1; index < picks.length; index += 1) {
    const lead = (artist: string): string => artist.split(',')[0] ?? artist;
    assert.notEqual(lead(picks[index]!.song.artist), lead(picks[index - 1]!.song.artist), picks.map((pick) => pick.song.id).join(','));
  }
});

test('discover leans away from liked artists and says why a new one was picked', () => {
  const liked = [{ id: 'l', title: 'Old', artist: 'Anirudh Ravichander' }];
  const familiar = rank({ candidates: POOL, liked, exploration: 'familiar' });
  const discover = rank({ candidates: POOL, liked, exploration: 'discover' });
  assert.match(familiar[0]!.song.artist, /Anirudh/);
  assert.doesNotMatch(discover[0]!.song.artist, /Anirudh/);
  assert.ok(discover.some(({ reason }) => /isn't in your recent plays or likes/.test(reason)));
  assert.ok(!discover.some(({ reason }) => /You've liked/.test(reason)), 'discover never sells a pick as one you liked');
});

test('a planned shape orders the set by which search found each song', () => {
  const laned: DjLocalCandidate[] = [
    { song: song({ id: 'up1', title: 'Up', artist: 'P' }), queryIndex: 1, lane: 'lively' },
    { song: song({ id: 'mid', title: 'Mid', artist: 'Q' }), queryIndex: 0 },
    { song: song({ id: 'down1', title: 'Down', artist: 'R' }), queryIndex: 2, lane: 'calm' }
  ];
  assert.deepEqual(rank({ candidates: laned, shape: 'build' }).map(({ song: picked }) => picked.id), ['down1', 'mid', 'up1']);
  assert.deepEqual(rank({ candidates: laned, shape: 'wind' }).map(({ song: picked }) => picked.id), ['up1', 'mid', 'down1']);
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
