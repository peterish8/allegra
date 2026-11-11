import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  nextInOrder,
  orderWithAppended,
  previousAction,
  previousInOrder,
  shuffledOrder,
} from './queueRules.ts';

describe('the previous rule every platform shares', () => {
  it('restarts the song past three seconds, and goes back before it', () => {
    assert.equal(previousAction(3.01, true), 'restart');
    assert.equal(previousAction(3, true), 'back');
    assert.equal(previousAction(0.4, true), 'back');
  });

  it('restarts the first song of a queue when there is nothing behind it', () => {
    assert.equal(previousAction(0.4, false), 'restart');
  });
});

describe('a shuffled play order', () => {
  it('plays the current song first and every other song once', () => {
    const order = shuffledOrder(['a', 'b', 'c', 'd'], 'c');
    assert.equal(order[0], 'c');
    assert.deepEqual([...order].sort(), ['a', 'b', 'c', 'd']);
  });

  it('never repeats a song before the order is used up', () => {
    const order = shuffledOrder(['a', 'b', 'c', 'd', 'e'], 'a');
    const heard: string[] = [];
    let at: string | null = order[0]!;
    for (let i = 0; i < order.length; i += 1) {
      heard.push(at!);
      at = nextInOrder(order, at, false);
    }
    assert.deepEqual(heard, order);
    assert.equal(new Set(heard).size, order.length);
    assert.equal(at, null);
  });

  it('goes back to the song that was actually heard before', () => {
    const order = ['c', 'a', 'd', 'b'];
    assert.equal(previousInOrder(order, 'd', false), 'a');
    assert.equal(previousInOrder(order, 'c', false), null);
  });

  it('wraps both ways only when the listener asked to repeat', () => {
    assert.equal(nextInOrder(['a', 'b'], 'b', true), 'a');
    assert.equal(nextInOrder(['a', 'b'], 'b', false), null);
    assert.equal(previousInOrder(['a', 'b'], 'a', true), 'b');
  });

  it('sends appended songs to the end of the order, once', () => {
    assert.deepEqual(orderWithAppended(['b', 'a'], ['c', 'a', 'd']), ['b', 'a', 'c', 'd']);
  });
});
