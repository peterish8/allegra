import { createImageCache } from './imageCache';

const deferred = <T,>() => {
  let resolve!: (value: T | null) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T | null>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe('createImageCache', () => {
  it('holds a loaded image and answers from it afterwards', async () => {
    const fetcher = jest.fn(async (key: string) => ({ key }));
    const cache = createImageCache(fetcher);
    expect(cache.peek('a')).toBeUndefined();
    const first = await cache.load('a');
    expect(cache.peek('a')).toBe(first);
    expect(await cache.load('a')).toBe(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('shares one load between callers that ask while it is in flight', async () => {
    const gate = deferred<{ key: string }>();
    const fetcher = jest.fn(() => gate.promise);
    const cache = createImageCache(fetcher);
    const a = cache.load('a');
    const b = cache.load('a');
    gate.resolve({ key: 'a' });
    expect(await a).toBe(await b);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not remember a failure, so the next ask tries again', async () => {
    const fetcher = jest.fn<Promise<{ ok: true } | null>, [string]>()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ ok: true });
    const cache = createImageCache(fetcher);
    expect(await cache.load('a')).toBeNull();
    expect(await cache.load('a')).toBeNull();
    expect(await cache.load('a')).toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('drops the least recently used image once it is full', async () => {
    const cache = createImageCache(async (key: string) => ({ key }), 2);
    await cache.load('a');
    await cache.load('b');
    cache.peek('a'); // a is now newer than b
    await cache.load('c');
    expect(cache.peek('b')).toBeUndefined();
    expect(cache.peek('a')).toBeDefined();
    expect(cache.peek('c')).toBeDefined();
  });
});
