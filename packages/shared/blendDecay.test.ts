import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DECAY_HALF_LIFE_MS,
  DECAY_LANDMARK_MS,
  TALLY_AMOUNT,
  TALLY_MAX_SONGS,
  TALLY_RECENT_LISTENS,
  addDecayed,
  currentWeight,
  decayFactor,
  listenAmount
} from './blendDecay.ts';

const MIN_SUPPORTED_MS = Date.UTC(1976, 0, 1);
const MAX_SUPPORTED_MS = Date.UTC(2076, 0, 1);

test('a tally weight halves after one 45-day half-life', () => {
  const atMs = Date.UTC(2026, 5, 1);
  const score = addDecayed(0, 10, atMs);
  const weight = currentWeight(score, atMs + DECAY_HALF_LIFE_MS);

  assert.ok(Math.abs(weight - 5) < 1e-9);
  assert.equal(DECAY_LANDMARK_MS, Date.UTC(2026, 0, 1));
  assert.equal(DECAY_HALF_LIFE_MS, 45 * 86_400_000);
});

test('adds at separate times equal the sum of their current weights', () => {
  const firstAt = Date.UTC(2026, 0, 1);
  const secondAt = Date.UTC(2026, 1, 1);
  const readAt = Date.UTC(2026, 2, 1);
  const score = addDecayed(addDecayed(0, 10, firstAt), 4, secondAt);
  const expected = 10 * 0.5 ** ((readAt - firstAt) / DECAY_HALF_LIFE_MS)
    + 4 * 0.5 ** ((readAt - secondAt) / DECAY_HALF_LIFE_MS);

  assert.ok(Math.abs(currentWeight(score, readAt) - expected) < 1e-12);
});

test('a negative update cannot reduce a tally below zero', () => {
  const atMs = Date.UTC(2026, 5, 1);
  assert.equal(addDecayed(addDecayed(0, 1, atMs), -5, atMs), 0);
});

test('factor and current weight stay finite and positive at both supported boundaries', () => {
  for (const atMs of [MIN_SUPPORTED_MS, MAX_SUPPORTED_MS]) {
    const factor = decayFactor(atMs);
    assert.ok(Number.isFinite(factor));
    assert.ok(factor > 0);

    const boundaryScore = addDecayed(0, listenAmount(10, 200), atMs);
    for (const nowMs of [MIN_SUPPORTED_MS, MAX_SUPPORTED_MS]) {
      const weight = currentWeight(boundaryScore, nowMs);
      assert.ok(Number.isFinite(weight));
      assert.ok(weight > 0);
    }
  }
});

test('stored score ordering matches current-weight ordering for 50 seeded pairs', () => {
  const random = seededRandom(0xB1E_DA7A);
  const range = MAX_SUPPORTED_MS - MIN_SUPPORTED_MS;
  const nowMs = MAX_SUPPORTED_MS;

  for (let index = 0; index < 50; index += 1) {
    const firstAt = MIN_SUPPORTED_MS + Math.floor(random() * range);
    const secondAt = MIN_SUPPORTED_MS + Math.floor(random() * range);
    const firstScore = addDecayed(0, 1 + random() * 100, firstAt);
    const secondScore = addDecayed(0, 1 + random() * 100, secondAt);

    assert.equal(
      Math.sign(firstScore - secondScore),
      Math.sign(currentWeight(firstScore, nowMs) - currentWeight(secondScore, nowMs))
    );
  }
});

test('listens shorter than ten seconds count as skips', () => {
  assert.equal(TALLY_AMOUNT.skip, -1);
  assert.equal(listenAmount(5, 200), -1);
  assert.equal(listenAmount(9, 200), -1);
  assert.equal(listenAmount(10, 200), 10 / 60);
});

test('listen amounts use minutes heard and cap at one song duration', () => {
  assert.equal(listenAmount(120, 200), 2);
  assert.equal(listenAmount(900, 200), 200 / 60);
  assert.equal(listenAmount(120, 0), 2);
});

test('tally constants retain the planned weights and bounds', () => {
  assert.deepEqual(TALLY_AMOUNT, { likeBonus: 10, playlistAdd: 5, skip: -1, seedRecent: 3 });
  assert.equal(TALLY_MAX_SONGS, 200);
  assert.equal(TALLY_RECENT_LISTENS, 8);
});

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}
