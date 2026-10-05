import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryCacheStore } from '../lib/cache.js';
import type { UnifiedSong } from '../types.js';
import { ImportMatcher, scoreCandidate } from './importMatch.js';

function song(id: string, title: string, artist: string, extra: Partial<UnifiedSong> = {}): UnifiedSong {
  return { id, title, artist, artwork: '', streamUrl: '', duration: 240, hasLyrics: false, playCount: 0, source: 'Saavn', ...extra };
}

const TUM_HI_HO = song('s1', 'Tum Hi Ho', 'Arijit Singh');

function fakeCatalog(results: (query: string) => UnifiedSong[] | Promise<UnifiedSong[]>) {
  let calls = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  return {
    get calls() { return calls; },
    get maxInFlight() { return maxInFlight; },
    search: async (query: string) => {
      calls += 1;
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { results: await results(query), source: 'Saavn' as const };
      } finally {
        inFlight -= 1;
      }
    }
  };
}

test('exact: same title, same lead artist, duration within five seconds', () => {
  assert.equal(scoreCandidate({ title: 'Tum Hi Ho', artist: 'Arijit Singh', durationSec: 243 }, TUM_HI_HO), 'exact');
  assert.equal(scoreCandidate({ title: 'Tum Hi Ho - Remastered 2013', artist: 'Arijit Singh' }, TUM_HI_HO), 'close');
});

test('close: a feat. credit that changes the lead, or a near title by the same lead', () => {
  const featured = song('s2', 'Kesariya', 'Pritam, Arijit Singh');
  assert.equal(scoreCandidate({ title: 'Kesariya', artist: 'Arijit Singh feat. Pritam' }, featured), 'close');
  assert.equal(scoreCandidate({ title: 'Tum Hi Hoo', artist: 'Arijit Singh' }, TUM_HI_HO), 'close');
  assert.equal(scoreCandidate({ title: 'Tum Hi Ho', artist: 'Arijit Singh', durationSec: 300 }, TUM_HI_HO), 'close');
});

test('none: different song, or a Gaana-only row', () => {
  assert.equal(scoreCandidate({ title: 'Channa Mereya', artist: 'Arijit Singh' }, TUM_HI_HO), 'none');
  assert.equal(scoreCandidate({ title: 'Tum Hi Ho', artist: 'Arijit Singh' }, { ...TUM_HI_HO, source: 'Gaana' }), 'none');
});

test('match returns a Saavn snapshot, prefers exact, and keeps batch order', async () => {
  const catalog = fakeCatalog(() => [song('x', 'Tum Hi Ho', 'Someone Else'), TUM_HI_HO]);
  const matcher = new ImportMatcher(catalog, new MemoryCacheStore());
  const [result] = await matcher.match([{ title: 'Tum Hi Ho', artist: 'Arijit Singh' }]);
  assert.equal(result?.confidence, 'exact');
  assert.equal(result?.song?.ref, 'saavn:s1');
  assert.equal(result?.index, 0);
});

test('a second request for the same track is answered from the cache', async () => {
  const catalog = fakeCatalog(() => [TUM_HI_HO]);
  const matcher = new ImportMatcher(catalog, new MemoryCacheStore());
  await matcher.match([{ title: 'Tum Hi Ho', artist: 'Arijit Singh' }]);
  const [again] = await matcher.match([{ title: 'Tum Hi Ho', artist: 'Arijit Singh' }]);
  assert.equal(catalog.calls, 1);
  assert.equal(again?.confidence, 'exact');
});

test('a misses-only result is remembered; Gaana-only answers count as none', async () => {
  const catalog = fakeCatalog(() => [{ ...TUM_HI_HO, source: 'Gaana' }]);
  const matcher = new ImportMatcher(catalog, new MemoryCacheStore());
  const [first] = await matcher.match([{ title: 'Tum Hi Ho', artist: 'Arijit Singh' }]);
  await matcher.match([{ title: 'Tum Hi Ho', artist: 'Arijit Singh' }]);
  assert.deepEqual(first, { index: 0, song: null, confidence: 'none' });
  assert.equal(catalog.calls, 1);
});

test('a throwing catalog gives none for that track without failing the batch, and is not cached', async () => {
  const catalog = fakeCatalog((query) => {
    if (query.startsWith('Broken')) throw new Error('timeout');
    return [TUM_HI_HO];
  });
  const matcher = new ImportMatcher(catalog, new MemoryCacheStore());
  const results = await matcher.match([{ title: 'Broken', artist: 'X' }, { title: 'Tum Hi Ho', artist: 'Arijit Singh' }]);
  assert.deepEqual(results.map((r) => r.confidence), ['none', 'exact']);
  assert.equal(results[0]?.retryable, true);
  await matcher.match([{ title: 'Broken', artist: 'X' }]);
  assert.equal(catalog.calls, 3);
});

test('a hanging catalog has a bounded batch response and remains retryable', async () => {
  const matcher = new ImportMatcher({ search: () => new Promise(() => undefined) }, new MemoryCacheStore(), 20);
  const started = Date.now();
  const matches = await matcher.match(Array.from({ length: 10 }, (_, i) => ({ title: `Missing ${i}`, artist: 'Artist' })));
  assert.ok(Date.now() - started < 500);
  assert.ok(matches.every((match) => match.retryable && match.song === null));
});

test('release versions and different album evidence are not silently exact matches', () => {
  assert.equal(scoreCandidate({ title: 'Tum Hi Ho (Live)', artist: 'Arijit Singh' }, TUM_HI_HO), 'close');
  assert.equal(scoreCandidate({ title: 'Tum Hi Ho', artist: 'Arijit Singh', album: 'Other album' }, { ...TUM_HI_HO, album: 'Aashiqui 2' }), 'close');
});

test('no more than four catalog searches run at once', async () => {
  const catalog = fakeCatalog(() => [TUM_HI_HO]);
  const matcher = new ImportMatcher(catalog, new MemoryCacheStore());
  const tracks = Array.from({ length: 20 }, (_, n) => ({ title: `Song ${n}`, artist: `Artist ${n}` }));
  await matcher.match(tracks);
  assert.equal(catalog.calls, 20);
  assert.ok(catalog.maxInFlight <= 4, `saw ${catalog.maxInFlight}`);
  assert.ok(catalog.maxInFlight > 1);
});

test('Spotify credit order and longer album names still match exactly when the length agrees', () => {
  // Spotify lists the composer first; Saavn often credits only the singer.
  assert.equal(scoreCandidate({ title: 'Tum Hi Ho', artist: 'Mithoon, Arijit Singh', album: 'Aashiqui 2', durationSec: 262 }, { ...TUM_HI_HO, duration: 262, album: 'Aashiqui 2 (Original Motion Picture Soundtrack)' }), 'exact');
  assert.equal(scoreCandidate({ title: 'Kesariya', artist: 'Pritam, Arijit Singh', album: 'Brahmastra', durationSec: 268 }, song('s3', 'Kesariya', 'Arijit Singh', { duration: 270, album: 'Brahmastra Part One Shiva' })), 'exact');
  // Without a length to agree on, a shared artist alone stays a suggestion.
  assert.equal(scoreCandidate({ title: 'Tum Hi Ho', artist: 'Mithoon, Arijit Singh' }, TUM_HI_HO), 'close');
  // A different length is a different recording.
  assert.equal(scoreCandidate({ title: 'Tum Hi Ho', artist: 'Mithoon, Arijit Singh', durationSec: 320 }, { ...TUM_HI_HO, duration: 262 }), 'close');
});
