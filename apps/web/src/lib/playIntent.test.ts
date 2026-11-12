import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createPlayIntent } from './playIntent';

describe('createPlayIntent', () => {
  it('lets only the newest pick land', () => {
    const intent = createPlayIntent();
    const slow = intent.begin();
    const fast = intent.begin();
    assert.equal(intent.isCurrent(slow), false);
    assert.equal(intent.isCurrent(fast), true);
  });

  it('a pick with no token (a DJ turn) still supersedes a waiting one', () => {
    const intent = createPlayIntent();
    const waiting = intent.begin();
    intent.begin();
    assert.equal(intent.isCurrent(waiting), false);
  });
});
