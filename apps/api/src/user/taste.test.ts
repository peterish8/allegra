import assert from 'node:assert/strict';
import test from 'node:test';

import { applyImportSeed, IMPORT_SEED_MAX_ARTISTS, importSeedWeights, SIGNAL_WEIGHT } from './taste.js';

const many = Array.from({ length: 300 }, (_, n) => ({ name: `Artist ${n}`, count: 300 - n }));

test('an import of 300 artists seeds at most 25', () => {
  const weights = importSeedWeights(many);
  assert.equal(weights.length, IMPORT_SEED_MAX_ARTISTS);
  const taste = applyImportSeed(undefined, many);
  assert.ok(taste.artists.length <= IMPORT_SEED_MAX_ARTISTS);
  assert.equal(taste.signals, IMPORT_SEED_MAX_ARTISTS);
  assert.equal(taste.onboarded, true);
});

test('the biggest artist gets the full seed weight and the rest are log-scaled below it', () => {
  const weights = importSeedWeights(many);
  assert.equal(weights[0]?.weight, SIGNAL_WEIGHT.seed);
  for (let i = 1; i < weights.length; i++) {
    assert.ok((weights[i]?.weight ?? 0) <= (weights[i - 1]?.weight ?? 0));
    assert.ok((weights[i]?.weight ?? 0) > 0);
  }
  assert.ok(Math.abs((weights[1]?.weight ?? 0) - SIGNAL_WEIGHT.seed * Math.log2(300) / Math.log2(301)) < 1e-12);
});

test('names are merged case-insensitively before ranking; empty names and zero counts are ignored', () => {
  const weights = importSeedWeights([
    { name: 'Arijit Singh', count: 3 },
    { name: 'arijit singh ', count: 4 },
    { name: 'Pritam', count: 5 },
    { name: ' ', count: 50 },
    { name: 'Nobody', count: 0 }
  ]);
  assert.deepEqual(weights.map((w) => w.name), ['Arijit Singh', 'Pritam']);
  assert.equal(weights[0]?.weight, SIGNAL_WEIGHT.seed);
});

test('the seeded artists keep the import order: the biggest stays on top', () => {
  const taste = applyImportSeed(undefined, many);
  assert.deepEqual(taste.artists.slice(0, 3).map((a) => a.name), ['Artist 0', 'Artist 1', 'Artist 2']);
  assert.equal(taste.artists[0]?.score, SIGNAL_WEIGHT.seed);
});

test('languages are left alone and signals grow by the number applied', () => {
  const base = { artists: [], languages: [{ name: 'hindi', score: 2 }], signals: 7, onboarded: false, updatedAt: '2026-01-01T00:00:00.000Z' };
  const taste = applyImportSeed(base, [{ name: 'A', count: 2 }, { name: 'B', count: 1 }]);
  assert.deepEqual(taste.languages, base.languages);
  assert.equal(taste.signals, 9);
});
