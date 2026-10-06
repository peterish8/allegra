import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LONG_TERM_WEIGHT, SESSION_WEIGHT, isListenExit, listenVerdict, reachedEnd } from './listenSignal.ts';

const song = 240;

test('a song that ends by itself is finished', () => {
  assert.equal(listenVerdict({ heardSeconds: 238, exit: 'ended', exitPositionSec: 240, durationSec: song }), 'finished');
});

test('skipping in the last 15 seconds still counts as liking the song', () => {
  assert.equal(listenVerdict({ heardSeconds: 228, exit: 'skipped', exitPositionSec: 228, durationSec: song }), 'finished');
  assert.equal(LONG_TERM_WEIGHT.finished, 1);
});

test('skipping after 90 % of a long song counts as finished', () => {
  assert.equal(listenVerdict({ heardSeconds: 545, exit: 'skipped', exitPositionSec: 545, durationSec: 600 }), 'finished');
});

test('skipping inside 10 seconds is the strongest no', () => {
  const verdict = listenVerdict({ heardSeconds: 3, exit: 'skipped', exitPositionSec: 3, durationSec: song });
  assert.equal(verdict, 'instant-skip');
  assert.ok(SESSION_WEIGHT[verdict] < SESSION_WEIGHT['early-skip']);
});

test('skipping between 10 and 30 seconds is a vote against', () => {
  const verdict = listenVerdict({ heardSeconds: 25, exit: 'skipped', exitPositionSec: 25, durationSec: song });
  assert.equal(verdict, 'early-skip');
  assert.ok(LONG_TERM_WEIGHT[verdict] < 0);
});

test('leaving mid-song after 30 seconds is only "not now"', () => {
  const verdict = listenVerdict({ heardSeconds: 90, exit: 'skipped', exitPositionSec: 90, durationSec: song });
  assert.equal(verdict, 'heard');
  assert.equal(LONG_TERM_WEIGHT[verdict], 0);
});

test('seeking straight to the outro and leaving is not hearing it out', () => {
  assert.equal(reachedEnd({ heardSeconds: 4, exitPositionSec: 235, durationSec: song }), false);
  assert.equal(listenVerdict({ heardSeconds: 4, exit: 'skipped', exitPositionSec: 235, durationSec: song }), 'instant-skip');
});

test('a pause says nothing about taste', () => {
  assert.equal(listenVerdict({ heardSeconds: 20, exit: 'paused', exitPositionSec: 20, durationSec: song }), 'paused');
  assert.equal(LONG_TERM_WEIGHT.paused, 0);
});

test('switching to something else early reads like a skip', () => {
  assert.equal(listenVerdict({ heardSeconds: 12, exit: 'switched', durationSec: song }), 'early-skip');
});

test('unknown duration falls back to heard seconds', () => {
  assert.equal(listenVerdict({ heardSeconds: 45, exit: 'skipped' }), 'heard');
  assert.equal(listenVerdict({ heardSeconds: Number.NaN, exit: 'skipped' }), 'instant-skip');
});

test('isListenExit accepts only the four exits', () => {
  assert.ok(isListenExit('skipped'));
  assert.ok(!isListenExit('stopped'));
  assert.ok(!isListenExit(undefined));
});
