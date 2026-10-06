import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PrefixCache, matchesQuery, normalizeQuery } from './typeahead.ts';

interface Row { readonly title: string; readonly artist: string }
const text = (row: Row): string => `${row.title} ${row.artist}`;

test('normalizeQuery ignores case and spacing', () => {
  assert.equal(normalizeQuery('  Kesariya   ARIJIT '), 'kesariya arijit');
});

test('matchesQuery needs every typed word to start a word in the text', () => {
  assert.ok(matchesQuery('Kesariya Arijit Singh', 'kesar ari'));
  assert.ok(matchesQuery('Kesariya Arijit Singh', 'ari kes'));
  assert.ok(!matchesQuery('Kesariya Arijit Singh', 'riya'));
  assert.ok(matchesQuery('anything', '   '));
});

test('instant answers from the longest cached prefix, narrowed', () => {
  const cache = new PrefixCache<Row>();
  cache.set('ke', [
    { title: 'Kesariya', artist: 'Arijit Singh' },
    { title: 'Kesari', artist: 'B Praak' },
    { title: 'Kehna Hi Kya', artist: 'Chitra' }
  ]);
  cache.set('kes', [
    { title: 'Kesariya', artist: 'Arijit Singh' },
    { title: 'Kesari', artist: 'B Praak' }
  ]);
  const answer = cache.instant('kesari arij', text);
  assert.ok(answer);
  assert.equal(answer.exact, false);
  assert.deepEqual(answer.items.map((row) => row.title), ['Kesariya']);
});

test('instant returns the exact entry when the query itself is cached', () => {
  const cache = new PrefixCache<Row>();
  cache.set('Kesariya', [{ title: 'Kesariya', artist: 'Arijit Singh' }]);
  const answer = cache.instant('kesariya', text);
  assert.equal(answer?.exact, true);
  assert.equal(answer?.items.length, 1);
});

test('instant is null when nothing related is known', () => {
  const cache = new PrefixCache<Row>();
  cache.set('tum', [{ title: 'Tum Hi Ho', artist: 'Arijit Singh' }]);
  assert.equal(cache.instant('kes', text), null);
  assert.equal(cache.instant('', text), null);
});

test('the cache drops the least recently used entry at capacity', () => {
  const cache = new PrefixCache<Row>(2);
  cache.set('a', []);
  cache.set('b', []);
  cache.get('a');
  cache.set('c', []);
  assert.equal(cache.size, 2);
  assert.ok(cache.get('a'));
  assert.equal(cache.get('b'), undefined);
});
