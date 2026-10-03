import assert from 'node:assert/strict';
import test from 'node:test';

import { parseLyrics } from './lrc.js';

test('LRC parser accepts dirty timestamps and emits instrumental lines', () => {
  const lines = parseLyrics('[0:3.75]Hello\n[01:05]   \n[00:10.25]World', 120);

  assert.deepEqual(lines, [
    { timestamp: 3.75, text: 'Hello', lineOrder: 0 },
    { timestamp: 10.25, text: 'World', lineOrder: 1 },
    { timestamp: 65, text: '[INSTRUMENTAL]', lineOrder: 2 }
  ]);
});

test('optional brackets still parse and empty stamped lines become instrumental', () => {
  const lines = parseLyrics('(0:01)One\n[00:02.5]\n00:03 Two', 30);
  assert.equal(lines[0]?.text, 'One');
  assert.equal(lines.some((line) => line.text === '[INSTRUMENTAL]'), true);
});

test('plain lyrics are interpolated across duration', () => {
  assert.deepEqual(parseLyrics('one\ntwo\nthree', 90), [
    { timestamp: 0, text: 'one', lineOrder: 0 },
    { timestamp: 30, text: 'two', lineOrder: 1 },
    { timestamp: 60, text: 'three', lineOrder: 2 }
  ]);
});

test('word tags time the words and never become extra lines', () => {
  const lines = parseLyrics('[00:01.00]<00:01.000>Hel<00:01.200>lo <00:01.500><00:01.600>there<00:02.000>\n[00:03.00] plain', 200);
  assert.deepEqual(lines.map((line) => [line.timestamp, line.text]), [[1, 'Hello there'], [3, 'plain']]);
  assert.deepEqual(lines[0]?.words, [
    { text: 'Hel', start: 1, end: 1.2 },
    { text: 'lo ', start: 1.2, end: 1.5 },
    { text: 'there', start: 1.6, end: 2 }
  ]);
  assert.equal(lines[1]?.words, undefined);
});

test('LRC header tags are metadata and never become lyric lines', () => {
  const lines = parseLyrics(['[ar: Someone]', '[length: 3:47]', '[offset:+200]', '[00:01.00] first', '[00:02.00] second'].join(String.fromCharCode(10)), 200);
  assert.deepEqual(lines.map((line) => line.text), ['first', 'second']);
  const plain = parseLyrics(['[length: 3:47]', 'only text'].join(String.fromCharCode(10)), 100);
  assert.deepEqual(plain.map((line) => line.text), ['only text']);
});
