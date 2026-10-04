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
/** Lookups still running, so the player and a prefetch for the same song share one. */
const inFlight = new Map<string, Promise<ProviderLyrics | null>>();

const ask = (name: LyricsProviderName, q: LyricsQuery): Promise<ProviderLyrics | null> =>
  LYRICS_PROVIDERS[name]?.(q).catch(() => null) ?? Promise.resolve(null);

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
  async fetchBest(
    query: LyricsQuery,
    order: LyricsProviderName[] = DEFAULT_PROVIDER_ORDER,
    syncedOnly = false,
  ): Promise<ProviderLyrics | null> {
    const q = cleanQuery(query);
    if (!q.title || !q.artist) return null;

    const key = cacheKey(q.title, q.artist, q.album, q.duration ? Math.round(q.duration) : '', syncedOnly);
    const cached = cache.get(key);
    if (cached) return cached;

    const running = inFlight.get(key);
    if (running) return running;

    const lookup = bestInOrder(order.map(name => ask(name, q)), syncedOnly)
      .then(hit => {
        if (hit) cache.set(key, hit);
        return hit;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, lookup);
    return lookup;
  },

  async fetchAll(query: LyricsQuery, order: LyricsProviderName[] = DEFAULT_PROVIDER_ORDER): Promise<ProviderLyrics[]> {
    const q = cleanQuery(query);
    if (!q.title || !q.artist) return [];
    const settled = await Promise.all(order.map(name => ask(name, q)));
    return settled.filter((r): r is ProviderLyrics => r !== null);
  },

  clearCache(): void {
    cache.clear();
  },
};
