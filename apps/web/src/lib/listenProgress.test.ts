import assert from 'node:assert/strict';
import test from 'node:test';

import { advanceListen, restartsListen, startListen } from './listenProgress.ts';

const play = (to: number, from = 0, listen = startListen()) => {
  const crossings: number[] = [];
  for (let at = from + 0.25; at <= to + 1e-9; at += 0.25) if (advanceListen(listen, at)) crossings.push(at);
  return { listen, crossings };
};

test('a listen enters history once, after five seconds actually heard', () => {
  const { crossings } = play(30);
  assert.deepEqual(crossings, [5]);
});

test('a song skipped before five seconds never enters history', () => {
  const { listen, crossings } = play(4.75);
  assert.deepEqual(crossings, []);
  assert.equal(listen.inHistory, false);
});

test('seeking does not count as hearing the song', () => {
  const listen = startListen();
  assert.equal(advanceListen(listen, 1), false);
  assert.equal(advanceListen(listen, 120), false, 'a jump forward adds nothing');
  assert.equal(listen.heard, 1);
  const { crossings } = play(124.5, 120, listen);
  assert.deepEqual(crossings, [124]);
});

test('the same song starting over from its end is a new listen, a seek back mid-song is not', () => {
  const heardOut = play(200).listen;
  assert.equal(restartsListen(heardOut, 0.2, 200), true, 'repeat one: end, then the top again');
  const midway = play(90).listen;
  assert.equal(restartsListen(midway, 0.2, 200), false);
  assert.equal(restartsListen(heardOut, 0.2, 0), false, 'unknown length: no guess');
});
