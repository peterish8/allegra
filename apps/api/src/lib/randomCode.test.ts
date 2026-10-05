import assert from 'node:assert/strict';
import test from 'node:test';

import { isShareCode } from '../user/actions.js';
import { CODE_ALPHABET, randomCode } from './randomCode.js';

test('randomCode returns the requested length using only the readable alphabet', () => {
  for (const length of [8, 12]) {
    const code = randomCode(length);
    assert.equal(code.length, length);
    assert.ok([...code].every((character) => CODE_ALPHABET.includes(character)));
  }
});

test('randomCode distributes characters evenly across the alphabet', () => {
  const counts = new Map([...CODE_ALPHABET].map((character) => [character, 0]));
  const sampleCount = 10_000;

  for (let sample = 0; sample < sampleCount; sample += 1) {
    for (const character of randomCode(CODE_ALPHABET.length)) {
      counts.set(character, (counts.get(character) ?? 0) + 1);
    }
  }

  for (const [character, count] of counts) {
    assert.ok(count >= sampleCount * 0.97 && count <= sampleCount * 1.03, `${character}: ${count}`);
  }
});

test('randomCode does not repeat any of 10,000 twelve-character codes', () => {
  const codes = new Set(Array.from({ length: 10_000 }, () => randomCode(12)));
  assert.equal(codes.size, 10_000);
});

test('share-code validation accepts the generator alphabet and rejects other characters', () => {
  for (const character of CODE_ALPHABET) {
    assert.equal(isShareCode(character.repeat(8)), true);
  }

  for (const character of ['i', 'l', 'o', '0', '1', '-', '_']) {
    assert.equal(isShareCode(`abcdefg${character}`), false);
  }

  assert.equal(isShareCode(randomCode(8)), true);
});
