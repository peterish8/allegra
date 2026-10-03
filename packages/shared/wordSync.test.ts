import assert from 'node:assert/strict';
import test from 'node:test';

import {
  alignSyllables,
  displayWords,
  enhancedLine,
  estimateWords,
  parseWordTags,
  stripWordTags,
  sweepAt,
  wordsFor,
} from './wordSync.ts';

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`);

test('syllables get their spaces back from the line they belong to', () => {
  const aligned = alignSyllables(
    [
      { text: 'Beau', start: 1, end: 1.2 },
      { text: 'ti', start: 1.2, end: 1.4 },
      { text: 'ful', start: 1.4, end: 1.8 },
      { text: 'day', start: 2, end: 2.5 },
    ],
    'Beautiful day',
  );
  assert.deepEqual(aligned.map(s => s.text), ['Beau', 'ti', 'ful ', 'day']);
});

test('without the line, spaceless pieces are whole words (CJK stays joined)', () => {
  assert.deepEqual(alignSyllables([{ text: 'hi', start: 0, end: 1 }, { text: 'there', start: 1, end: 2 }]).map(s => s.text), ['hi ', 'there']);
  assert.deepEqual(alignSyllables([{ text: '你', start: 0, end: 1 }, { text: '好', start: 1, end: 2 }]).map(s => s.text), ['你', '好']);
});

test('an enhanced line round-trips through the parser, pauses included', () => {
  const line = enhancedLine(12.3, [
    { text: 'Hel', start: 12.3, end: 12.52 },
    { text: 'lo ', start: 12.52, end: 12.8 },
    { text: 'world', start: 13.2, end: 13.6 },
  ]);
  assert.equal(line, '[00:12.30]<00:12.300>Hel<00:12.520>lo <00:12.800><00:13.200>world<00:13.600>');
  const parsed = parseWordTags(line.slice('[00:12.30]'.length), 12.3, 20);
  assert.equal(parsed.text, 'Hello world');
  assert.deepEqual(parsed.words?.map(w => w.text), ['Hel', 'lo ', 'world']);
  near(parsed.words![1].end, 12.8);
  near(parsed.words![2].start, 13.2);
  near(parsed.words![2].end, 13.6);
});

test('a last word with no closing tag holds until the next line, at most 3 s', () => {
  assert.equal(parseWordTags('<00:01.00>one <00:01.50>two', 1, 2.4).words![1].end, 2.4);
  assert.equal(parseWordTags('<00:01.00>one <00:01.50>two', 1, 30).words![1].end, 4.5);
});

test('plain text passes through, and word tags strip clean', () => {
  assert.deepEqual(parseWordTags('  just  a line ', 0), { text: 'just a line' });
  assert.equal(stripWordTags('<00:10.00>Word <00:10.50>by <00:11.00>word'), 'Word by word');
});

test('words that no longer spell the line are ignored', () => {
  const words = [{ text: 'Hello ', start: 0, end: 1 }, { text: 'world', start: 1, end: 2 }];
  assert.equal(wordsFor('Hello world', words), words);
  assert.equal(wordsFor('Halo dunia', words), null);
});

test('display words keep syllables of one word together', () => {
  const words = displayWords(
    { timestamp: 1, text: 'Beautiful day', words: [
      { text: 'Beau', start: 1, end: 1.2 },
      { text: 'ti', start: 1.2, end: 1.4 },
      { text: 'ful ', start: 1.4, end: 1.8 },
      { text: 'day', start: 2, end: 2.5 },
    ] },
    3,
    false,
  )!;
  assert.deepEqual(words.map(w => [w.text, w.gapAfter, w.weight]), [['Beautiful', true, 9], ['day', false, 3]]);
  assert.deepEqual(words[0].segments, [1, 1.2, 4, 1.2, 1.4, 2, 1.4, 1.8, 3]);
});

test('a line without timings is lit whole, or estimated when asked', () => {
  const line = { timestamp: 10, text: 'one two three' };
  assert.equal(displayWords(line, 14, false), null);
  const est = displayWords(line, 14, true)!;
  assert.deepEqual(est.map(w => w.text), ['one', 'two', 'three']);
  near(est[0].start, 10);
  assert.ok(est[2].end <= 10 + 4 * 0.9 + 1e-9);
  // Never stretched over a long gap.
  const long = estimateWords('short', 0, 60);
  assert.ok(long[long.length - 1].end < 2);
});

test('the sweep lights letters by syllable', () => {
  const segs = [1, 1.2, 4, 1.2, 1.4, 2, 1.4, 1.8, 3];
  assert.equal(sweepAt(0.5, segs, 9), 0);
  near(sweepAt(1.1, segs, 9), 2 / 9);
  near(sweepAt(1.3, segs, 9), 5 / 9);
  assert.equal(sweepAt(2, segs, 9), 1);
});
