import { decodeFeedCache, encodeFeedCache, FEED_CACHE_MAX_AGE_MS } from './feedCache';
import type { HomeFeed } from './homeFeed';
import type { HomePage } from '../ytmusic/browse';

const song = { id: 's1', title: 'A', artist: 'B', highResArt: '', downloadUrl: '', source: 'Saavn' as const };
const feed: HomeFeed = { quickPicks: [song], keepListening: [], dailyDiscover: [], similar: [], forgottenFavorites: [], coldStart: false };
const home = { chips: [], shelves: Array.from({ length: 12 }, (_, i) => ({ title: `Shelf ${i}`, items: [] })), continuation: 'tok' } as unknown as HomePage;
const NOW = 1_760_000_000_000;

describe('feedCache', () => {
  it('keeps the feed and the first shelves of the home, and reads them back', () => {
    const back = decodeFeedCache(encodeFeedCache(feed, home, NOW), NOW + 1000);
    expect(back?.feed?.quickPicks[0].id).toBe('s1');
    expect(back?.home?.shelves).toHaveLength(8);
    // The continuation token belongs to the session that fetched it.
    expect((back?.home as HomePage & { continuation?: string }).continuation).toBeUndefined();
  });

  it('does not keep an empty feed over nothing', () => {
    const empty: HomeFeed = { ...feed, quickPicks: [] };
    expect(encodeFeedCache(empty, null, NOW)).toBeNull();
    expect(encodeFeedCache(empty, home, NOW)).not.toBeNull();
  });

  it('drops a cache that is too old, from the future, broken or the wrong shape', () => {
    const text = encodeFeedCache(feed, null, NOW);
    expect(decodeFeedCache(text, NOW + FEED_CACHE_MAX_AGE_MS + 1)).toBeNull();
    expect(decodeFeedCache(text, NOW - 10 * 60_000)).toBeNull();
    expect(decodeFeedCache('{not json', NOW)).toBeNull();
    expect(decodeFeedCache(JSON.stringify({ savedAt: NOW, feed: { quickPicks: 'x' } }), NOW)).toBeNull();
    expect(decodeFeedCache(null, NOW)).toBeNull();
  });
});
