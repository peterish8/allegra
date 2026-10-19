import assert from 'node:assert/strict';
import test from 'node:test';

import { applySeeds, applySignal, mergeTaste, normalizeGenreIds, tasteSummary } from './taste.js';

test('explicit genre picks are validated, exposed, and preserved as listening changes the taste profile', () => {
  const genres = normalizeGenreIds([' pop ', 'unknown', 'pop', 'southindian']);
  assert.deepEqual(genres, ['pop', 'southindian']);

  const seeded = applySeeds(undefined, ['Taylor Swift'], ['english'], new Date('2026-10-04T00:00:00.000Z'), genres);
  assert.deepEqual(tasteSummary(seeded).genres, ['pop', 'southindian']);

  const afterPlay = applySignal(seeded, { artist: 'Taylor Swift', language: 'english' }, 1, new Date('2026-10-05T00:00:00.000Z'));
  assert.deepEqual(tasteSummary(afterPlay).genres, ['pop', 'southindian']);
});

test('merging guest and account taste keeps both genre preference lists without duplicates', () => {
  const guest = applySeeds(undefined, [], [], new Date('2026-10-04T00:00:00.000Z'), ['pop']);
  const account = applySeeds(undefined, [], [], new Date('2026-10-04T00:00:00.000Z'), ['bollywood', 'pop']);

  assert.deepEqual(tasteSummary(mergeTaste(guest, account)).genres, ['pop', 'bollywood']);
});
