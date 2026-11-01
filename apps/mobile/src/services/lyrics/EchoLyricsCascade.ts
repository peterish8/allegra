/**
 * Walks the Echo Music lyrics providers in order.
 *
 * `fetchBest` asks every provider at once but still answers in priority order:
 * the best-ranked synced result, else the best-ranked plain one. It answers as
 * soon as every provider ranked above the winner has settled, so a slow or dead
 * provider costs one timeout, never one each. `fetchAll` returns everything
 * that came back — used by the lyrics picker.
 */
import { cacheKey, TtlCache } from '../net/fetchWithTimeout';
import {
  DEFAULT_PROVIDER_ORDER,
  LYRICS_PROVIDERS,
  LyricsProviderName,
  LyricsQuery,
  ProviderLyrics,
} from './providers';

const cache = new TtlCache<ProviderLyrics>(6 * 60 * 60 * 1000);
/**
 * Songs every provider answered "none" for, with no timeout or server error on the way: not asked again for a while.
 * A lookup that hit an error is never remembered, so a flaky network does not hide lyrics that exist.
 */
export const MISS_TTL_MS = 30 * 60 * 1000;
const misses = new TtlCache<true>(MISS_TTL_MS);

/**
 * A lookup still running, shared by everyone who asked for the same song (the player and a prefetch). `waiting`
 * counts the callers that can still give up; a caller without a signal never gives up, and keeps it alive.
 */
interface SharedLookup {
  readonly promise: Promise<ProviderLyrics | null>;
  readonly controller: AbortController;
  waiting: number;
  keptAlive: boolean;
}
const inFlight = new Map<string, SharedLookup>();

const ask = (name: LyricsProviderName, q: LyricsQuery): Promise<ProviderLyrics | null> =>
  LYRICS_PROVIDERS[name]?.(q).catch(() => null) ?? Promise.resolve(null);

/** Starts the providers for [key], remembering a hit, or a clean miss. */
function startLookup(key: string, q: LyricsQuery, order: LyricsProviderName[], syncedOnly: boolean): SharedLookup {
  const controller = new AbortController();
  let failed = false;
  const net = { signal: controller.signal, onFailure: () => { failed = true; } };
  const promise = bestInOrder(order.map(name => ask(name, { ...q, net })), syncedOnly)
    .then(hit => {
      if (hit) {
        cache.set(key, hit);
      } else if (!failed && !controller.signal.aborted) {
        misses.set(key, true);
      }
      return hit;
    })
    .finally(() => {
      if (inFlight.get(key)?.promise === promise) {
        inFlight.delete(key);
      }
    });
  return { promise, controller, waiting: 0, keptAlive: false };
}

/**
 * [lookup]'s answer for one caller. With a [signal], the caller gets null as soon as it aborts, and the providers are
 * cancelled once no caller is still waiting.
 */
function follow(lookup: SharedLookup, signal: AbortSignal | undefined): Promise<ProviderLyrics | null> {
  if (!signal) {
    lookup.keptAlive = true;
    return lookup.promise;
  }
  if (signal.aborted) {
    return Promise.resolve(null);
  }
  lookup.waiting += 1;
  return new Promise(resolve => {
    let settled = false;
    const done = (answer: ProviderLyrics | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener('abort', onAbort);
      lookup.waiting -= 1;
      resolve(answer);
    };
    const onAbort = (): void => {
      done(null);
      if (lookup.waiting === 0 && !lookup.keptAlive) {
        lookup.controller.abort();
      }
    };
    signal.addEventListener('abort', onAbort);
    lookup.promise.then(done, () => done(null));
  });
}

async function bestInOrder(answers: Promise<ProviderLyrics | null>[], syncedOnly: boolean): Promise<ProviderLyrics | null> {
  let plainFallback: ProviderLyrics | null = null;
  for (const answer of answers) {
    const hit = await answer;
    if (hit?.synced) return hit;
    plainFallback ??= hit;
  }
  return syncedOnly ? null : plainFallback;
}

const cleanQuery = (q: LyricsQuery): LyricsQuery => ({
  ...q,
  title: q.title
    .replace(/\.(mp3|m4a|flac|wav|ogg|opus)$/i, '')
    .replace(/[([](official|lyrics?|audio|video|visuali[sz]er|mv|hd|4k|mp3_\d+k)[^)\]]*[)\]]/gi, '')
    .replace(/\s+/g, ' ')
    .trim(),
  artist: q.artist === 'Unknown Artist' ? '' : q.artist.trim(),
});

export const EchoLyricsCascade = {
  /**
   * The best lyrics for [query]. [signal] (the song changed) makes this caller's answer null at once and cancels the
   * providers if nobody else still waits for the same song.
   */
  async fetchBest(
    query: LyricsQuery,
    order: LyricsProviderName[] = DEFAULT_PROVIDER_ORDER,
    syncedOnly = false,
    signal?: AbortSignal,
  ): Promise<ProviderLyrics | null> {
    const q = cleanQuery(query);
    if (!q.title || !q.artist) return null;

    const key = cacheKey(q.title, q.artist, q.album, q.duration ? Math.round(q.duration) : '', syncedOnly);
    const cached = cache.get(key);
    if (cached) return cached;
    if (misses.get(key)) return null;

    let lookup = inFlight.get(key);
    if (!lookup || lookup.controller.signal.aborted) {
      lookup = startLookup(key, q, order, syncedOnly);
      inFlight.set(key, lookup);
    }
    return follow(lookup, signal);
  },

  async fetchAll(query: LyricsQuery, order: LyricsProviderName[] = DEFAULT_PROVIDER_ORDER): Promise<ProviderLyrics[]> {
    const q = cleanQuery(query);
    if (!q.title || !q.artist) return [];
    const settled = await Promise.all(order.map(name => ask(name, q)));
    return settled.filter((r): r is ProviderLyrics => r !== null);
  },

  clearCache(): void {
    cache.clear();
    misses.clear();
  },
};
