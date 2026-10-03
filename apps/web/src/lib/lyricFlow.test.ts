import assert from 'node:assert/strict';
import test from 'node:test';

import { followSettled, followStep, lineAt, lyricClockAt, MAX_AHEAD_S } from './lyricFlow.ts';

test('the clock carries on between reports, but never far past the last one', () => {
  assert.equal(lyricClockAt(10, 1_000, 1_250, undefined), 10.25);
  assert.equal(lyricClockAt(10, 1_000, 9_000, undefined), 10 + MAX_AHEAD_S);
});

test('a late report does not step the clock backwards; a seek does', () => {
  assert.equal(lyricClockAt(10, 1_000, 1_000, 10.2), 10.2);
  assert.equal(lyricClockAt(4, 1_000, 1_000, 10.2), 4);
});

test('the follow lands without overshoot and settles in about a second and a half', () => {
  let state = { offset: 140, velocity: 0 };
  let lowest = Infinity;
  for (let frame = 0; frame < 96; frame += 1) {
    state = followStep(state.offset, state.velocity, 1 / 60);
    lowest = Math.min(lowest, state.offset);
  }
  assert.ok(lowest >= 0);
  assert.ok(followSettled(state));
});

test('the follow keeps its speed when the next line lands mid-glide', () => {
  let state = { offset: 100, velocity: 0 };
  for (let frame = 0; frame < 18; frame += 1) state = followStep(state.offset, state.velocity, 1 / 60);
  const next = followStep(state.offset + 80, state.velocity, 1 / 60);
  assert.equal(Math.sign(next.velocity), Math.sign(state.velocity));
});

test('lineAt finds the line being sung', () => {
  const starts = [0, 2, 5, 9];
  assert.equal(lineAt(starts, -1), 0);
  assert.equal(lineAt(starts, 2), 1);
  assert.equal(lineAt(starts, 8.9), 2);
  assert.equal(lineAt(starts, 100), 3);
});
