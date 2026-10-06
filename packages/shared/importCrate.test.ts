import assert from 'node:assert/strict';
import test from 'node:test';

import { crateIds, crateStack, latestFoundText, spotifyTickerText } from './importCrate.ts';

test('the crate fans the newest three sleeves, newest on top', () => {
  assert.deepEqual(crateStack(['a', 'b', 'c', 'd', 'e']), ['c', 'd', 'e']);
  assert.deepEqual(crateStack(['a']), ['a']);
  assert.deepEqual(crateStack([], 3), []);
  assert.deepEqual(crateStack(['a', 'b'], 0), []);
});

test('while picking, the crate follows tick order and leaves out finished sources', () => {
  assert.deepEqual(crateIds(new Set(['b', 'a', 'c']), [], new Set(['a']), false), ['b', 'c']);
});

test('while transferring, the source running now is on top and finished ones are dealt out', () => {
  // Queue runs a, b, c in list order; a is done, so b runs and sits on top.
  assert.deepEqual(crateIds(new Set(['c', 'a', 'b']), ['a', 'b', 'c'], new Set(['a']), true), ['c', 'b']);
  assert.deepEqual(crateIds(new Set(['a']), ['a'], new Set(['a']), true), []);
});

test('the Spotify ticker shows the source and its real counts only', () => {
  assert.equal(spotifyTickerText('Road trip', null), 'Road trip · starting');
  assert.equal(spotifyTickerText('Road trip', { added: 140, skipped: 0, reviewNeeded: 0 }), 'Road trip · 140 added');
  assert.equal(spotifyTickerText('Road trip', { added: 140, skipped: 3, reviewNeeded: 2 }), 'Road trip · 140 added · 3 skipped · 2 not exact');
});

test('the file ticker names the most recent track that found a match', () => {
  const found = (title: string, song: unknown) => ({ track: { title, artist: `${title} artist` }, song });
  assert.equal(latestFoundText([]), null);
  assert.equal(latestFoundText([found('One', null)]), null);
  assert.equal(latestFoundText([found('One', {}), found('Two', {}), found('Three', null)]), 'Found · Two — Two artist');
});
