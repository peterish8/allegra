import assert from 'node:assert/strict';
import test from 'node:test';

import { shuffled } from './shuffle';

function seeded(values: readonly number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length] ?? 0;
}

test('keeps the same elements', () => {
  const input = [1, 2, 3, 4, 5, 6];
  assert.deepEqual([...shuffled(input)].sort(), input);
});

test('a seeded rand gives a known order', () => {
  // i=3 -> floor(0*4)=0 swap [3,0]; i=2 -> floor(0.5*3)=1 swap [2,1]; i=1 -> floor(0.99*2)=1 no-op.
  assert.deepEqual(shuffled(['a', 'b', 'c', 'd'], seeded([0, 0.5, 0.99])), ['d', 'c', 'b', 'a']);
});

test('does not mutate the input', () => {
  const input = [1, 2, 3, 4];
  const out = shuffled(input, seeded([0, 0, 0]));
  assert.deepEqual(input, [1, 2, 3, 4]);
  assert.notEqual(out, input);
});
