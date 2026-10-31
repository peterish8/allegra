import assert from 'node:assert/strict';
import test from 'node:test';

import { countLyricsTap, highlightLabel, LYRICS_TAP_WINDOW_MS, NO_TAPS, otherHighlight } from './lyricsTaps.ts';

test('three quick taps switch, then the run starts over', () => {
  let run = NO_TAPS;
  const results: boolean[] = [];
  for (const at of [1000, 1200, 1400, 1600]) {
    const next = countLyricsTap(run, at);
    run = next.run;
    results.push(next.triple);
  }
  assert.deepEqual(results, [false, false, true, false]);
});

test('a slow tap starts a new run instead of finishing a triple', () => {
  const first = countLyricsTap(NO_TAPS, 1000);
  const second = countLyricsTap(first.run, 1100);
  const late = countLyricsTap(second.run, 1100 + LYRICS_TAP_WINDOW_MS + 1);
  assert.equal(late.triple, false);
  assert.equal(late.run.count, 1);
});

test('the style flips and names itself', () => {
  assert.equal(otherHighlight('letters'), 'lines');
  assert.equal(otherHighlight('lines'), 'letters');
  assert.equal(highlightLabel('lines'), 'Line by line');
});
