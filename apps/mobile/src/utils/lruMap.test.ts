import { LruMap } from './lruMap';

describe('bounded caches (1.41.0 memory pass)', () => {
  it('keeps only the most recent entries', () => {
    const cache = new LruMap<string, number>(2);
    cache.set('a', 1).set('b', 2).set('c', 3);
    expect(cache.has('a')).toBe(false);
    expect(cache.size).toBe(2);
  });

  it('counts a read as use, so a cover still on screen is not the one dropped', () => {
    const cache = new LruMap<string, number>(2);
    cache.set('a', 1).set('b', 2);
    expect(cache.get('a')).toBe(1);
    cache.set('c', 3);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
  });

  it('replaces a value without growing, and deletes and clears', () => {
    const cache = new LruMap<string, number>(3);
    cache.set('a', 1).set('a', 2);
    expect(cache.size).toBe(1);
    expect(cache.get('a')).toBe(2);
    expect(cache.delete('a')).toBe(true);
    cache.set('x', 1);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('missing')).toBeUndefined();
  });
});
