import assert from 'node:assert/strict';
import test from 'node:test';
import { alignCtc, tokenize } from './lyricAlign/ctc.ts';
import { ALIGN_VOCAB } from './lyricAlign/config.ts';
import { readLocalTiming, rememberLocalTiming } from './lyricAlign/localTiming.ts';

function emissions(symbols: readonly (string | null)[]): Float32Array {
  const logits = new Float32Array(symbols.length * 31).fill(-12);
  symbols.forEach((symbol, i) => { logits[i * 31 + (symbol ? ALIGN_VOCAB[symbol]! : 0)] = 12; });
  return logits;
}

test('Alignment follows acoustic characters and leaves instrumental gaps between lines', () => {
  const symbols = [null, null, 'a', 'a', null, 'b', 'b', null, null, null, 'c', 'c', null];
  const result = alignCtc(emissions(symbols), symbols.length, 31, 13, ['ab', 'c']);
  assert.deepEqual(result.wordTimes, [{ start: 2, end: 7 }, { start: 10, end: 12 }]);
  assert.ok(result.confidence > 0.99);
});

test('Repeated characters require a blank and retain their original word index', () => {
  const symbols = [null, 'a', null, 'a', null, 'b', null];
  const result = alignCtc(emissions(symbols), symbols.length, 31, 7, ['aa b']);
  assert.deepEqual(result.wordTimes, [{ start: 1, end: 4 }, { start: 5, end: 6 }]);
});

test('Romanized words normalize accents, apostrophes and numbers without changing word count', () => {
  const result = tokenize(['Café 2 it’s']);
  assert.deepEqual(result.words, ['Café', '2', 'it’s']);
  assert.equal(result.owners.filter((n) => n === 1).length, 3);
  assert.throws(() => tokenize(['தமிழ்']), /Native-script/);
});

test('Impossible audio and oversized alignments fail instead of inventing timings', () => {
  assert.throws(() => alignCtc(new Float32Array(31), 1, 31, 1, ['hello']), /too large/);
});

test('Guest timing survives another visit, with word timing retained and corrupt storage rejected', () => {
  const storage = new Map<string, string>();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } });
  try {
    const lines = [{ text: 'Hello world', timestamp: 4, lineOrder: 0, words: [{ text: 'Hello ', start: 4, end: 5 }, { text: 'world', start: 6, end: 7 }] }];
    rememberLocalTiming('saavn:test', { source: 'On this device', type: 'synced', matchScore: .9, matchReason: 'Previewed', lines });
    assert.deepEqual(readLocalTiming('saavn:test')?.lines, lines);
    assert.equal(readLocalTiming('saavn:another'), null);
    storage.set('allegra-local-lyric-timing-v1:saavn:test', JSON.stringify({ lines: [{ text: 'Bad', timestamp: -1 }] }));
    assert.equal(readLocalTiming('saavn:test'), null);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
