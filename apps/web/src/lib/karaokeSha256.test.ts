import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import test from 'node:test';

import { Sha256 } from './liveKaraoke/roformer/sha256.ts';

const reference = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex');

test('matches the standard digests for empty and short input', () => {
  assert.equal(new Sha256().hex(), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(new Sha256().update(new TextEncoder().encode('abc')).hex(), reference(new TextEncoder().encode('abc')));
});

test('padding is right at every length around a block boundary', () => {
  for (let length = 50; length < 140; length++) {
    const data = randomBytes(length);
    assert.equal(new Sha256().update(data).hex(), reference(data), `length ${length}`);
  }
});

test('feeding the bytes in uneven pieces gives the same digest as all at once', () => {
  // How a download arrives: reads of whatever size the network hands over.
  const data = randomBytes(300_000);
  const hasher = new Sha256();
  for (let at = 0, step = 1; at < data.length; at += step, step = (step * 7 + 13) % 9_000 + 1) {
    hasher.update(data.subarray(at, Math.min(data.length, at + step)));
  }
  assert.equal(hasher.hex(), reference(data));
});
