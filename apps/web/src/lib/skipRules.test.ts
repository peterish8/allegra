import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decidePrevious, hasUpcoming, manualNext, nextDistinct, previousDistinct, reshuffleOrder, shufflePlayOrder, type QueueSong } from './skipRules';

const song = (id: string, title = `Title ${id}`, artist = 'Artist'): QueueSong => ({ id, title, artist });
const a = song('a');
const b = song('b');
const c = song('c');
const list = [a, b, c];

describe('shufflePlayOrder', () => {
  it('drops songs that left the queue and appends songs the saved order never met', () => {
    const d = song('d');
    assert.deepEqual(shufflePlayOrder([a, c, d], ['c', 'gone', 'a']), ['c', 'a', 'd']);
  });
});

describe('reshuffleOrder', () => {
  it('keeps the saved order when it still holds the current song', () => {
    assert.deepEqual(reshuffleOrder(['a', 'b', 'c', 'd'], 'b', ['c', 'b', 'a']), ['c', 'b', 'a', 'd']);
  });

  it('deals a new order when the current song is not in it', () => {
    const order = reshuffleOrder(['a', 'b', 'c'], 'c', ['a', 'b'], () => 0);
    assert.equal(order.length, 3);
    assert.equal(order[0], 'c');
    assert.deepEqual([...order].sort(), ['a', 'b', 'c']);
  });
});

describe('nextDistinct / previousDistinct', () => {
  it('skips remasters of the current song', () => {
    const remaster = song('a2', a.title, a.artist);
    assert.equal(nextDistinct([a, remaster, b], 0, a, false)?.id, 'b');
    assert.equal(previousDistinct([b, remaster, a], 2, a, false)?.id, 'b');
  });

  it('only goes round when asked', () => {
    assert.equal(nextDistinct(list, 2, c, false), undefined);
    assert.equal(nextDistinct(list, 2, c, true)?.id, 'a');
    assert.equal(previousDistinct(list, 0, a, false), undefined);
    assert.equal(previousDistinct(list, 0, a, true)?.id, 'c');
  });
});

describe('manualNext', () => {
  it('goes round from the last song whatever the repeat mode', () => {
    assert.equal(manualNext({ list, current: c, shuffle: false, shuffleOrder: [] })?.id, 'a');
  });

  it('never points at a song that left the queue while shuffled', () => {
    // The saved order still names `gone`, which was swapped out of the queue.
    assert.equal(manualNext({ list, current: b, shuffle: true, shuffleOrder: ['b', 'gone', 'c', 'a'] })?.id, 'c');
  });

  it('is null when only the current song (or its remasters) is queued', () => {
    assert.equal(manualNext({ list: [a, song('a2', a.title, a.artist)], current: a, shuffle: false, shuffleOrder: [] }), null);
  });
});

describe('hasUpcoming', () => {
  it('is false on the last song, so radio can add similar songs instead of going round', () => {
    assert.equal(hasUpcoming({ list, current: c, shuffle: false, shuffleOrder: [] }), false);
    assert.equal(hasUpcoming({ list, current: b, shuffle: false, shuffleOrder: [] }), true);
  });

  it('follows the shuffle order', () => {
    assert.equal(hasUpcoming({ list, current: a, shuffle: true, shuffleOrder: ['c', 'b', 'a'] }), false);
    assert.equal(hasUpcoming({ list, current: c, shuffle: true, shuffleOrder: ['c', 'b', 'a'] }), true);
  });
});

describe('decidePrevious', () => {
  const base = { list, shuffle: false, shuffleOrder: [] as string[], repeatAll: false };

  it('goes back one near the start of a song', () => {
    assert.deepEqual(decidePrevious({ ...base, current: b, positionSec: 1 }), { kind: 'back', song: a });
  });

  it('restarts past three seconds', () => {
    assert.deepEqual(decidePrevious({ ...base, current: b, positionSec: 12 }), { kind: 'restart' });
  });

  it('restarts the first song unless repeat all lets it go to the last', () => {
    assert.deepEqual(decidePrevious({ ...base, current: a, positionSec: 0 }), { kind: 'restart' });
    assert.deepEqual(decidePrevious({ ...base, repeatAll: true, current: a, positionSec: 0 }), { kind: 'back', song: c });
  });

  it('a freshly picked song at position 0 goes back again (a second media-key press)', () => {
    assert.deepEqual(decidePrevious({ ...base, current: c, positionSec: 0 }), { kind: 'back', song: b });
  });
});
