/**
 * The Stream page's last feed, kept on the phone so the page opens on it at once instead of a grid of placeholders
 * while the network answers (stale-while-revalidate: shown now, replaced as soon as the fresh feed lands).
 *
 * What is kept: the personal feed (`buildHomeFeed`) and YouTube Music's home (chips and the first shelves). Songs in
 * it carry catalog links that can expire; playing one whose link has gone stale is handled by playback recovery
 * (`playback/recovery.ts`, "expired": a fresh link, then it plays), and the fresh feed usually replaces the cached one
 * before anything is tapped.
 */
import type { HomeFeed } from './homeFeed';
import type { HomePage } from '../ytmusic/browse';

const KEY = 'stream-feed-cache-v1';
/** Older than this, the cached page is not shown (a week-old feed reads as broken, not fast). */
export const FEED_CACHE_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
/** YouTube Music's home is long; the page shows the first shelves before anyone scrolls. */
const MAX_SHELVES = 8;

export interface FeedCache {
  savedAt: number;
  feed: HomeFeed | null;
  home: HomePage | null;
}

const isFeed = (v: unknown): v is HomeFeed =>
  !!v && typeof v === 'object'
  && Array.isArray((v as HomeFeed).quickPicks) && Array.isArray((v as HomeFeed).keepListening)
  && Array.isArray((v as HomeFeed).dailyDiscover) && Array.isArray((v as HomeFeed).similar)
  && Array.isArray((v as HomeFeed).forgottenFavorites);

const isHome = (v: unknown): v is HomePage =>
  !!v && typeof v === 'object' && Array.isArray((v as HomePage).chips) && Array.isArray((v as HomePage).shelves);

/** The text stored: an empty feed is not worth keeping over a good one. Null when there is nothing to keep. */
export function encodeFeedCache(feed: HomeFeed | null, home: HomePage | null, now: number): string | null {
  const keepFeed = feed && (feed.quickPicks.length > 0 || feed.keepListening.length > 0) ? feed : null;
  const keepHome = home && home.shelves.length > 0
    // The continuation token belongs to the session that fetched it.
    ? { chips: home.chips, shelves: home.shelves.slice(0, MAX_SHELVES) }
    : null;
  if (!keepFeed && !keepHome) return null;
  return JSON.stringify({ savedAt: now, feed: keepFeed, home: keepHome });
}

/** The stored text back, or null when it is missing, unreadable, the wrong shape or too old. */
export function decodeFeedCache(raw: string | null | undefined, now: number, maxAgeMs = FEED_CACHE_MAX_AGE_MS): FeedCache | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { savedAt?: unknown; feed?: unknown; home?: unknown };
    if (typeof parsed.savedAt !== 'number' || now - parsed.savedAt > maxAgeMs || parsed.savedAt > now + 60_000) return null;
    const feed = isFeed(parsed.feed) ? parsed.feed : null;
    const home = isHome(parsed.home) ? parsed.home : null;
    if (!feed && !home) return null;
    return { savedAt: parsed.savedAt, feed, home };
  } catch {
    return null;
  }
}

type Storage = { getItem: (k: string) => Promise<string | null>; setItem: (k: string, v: string) => Promise<void> };
const storage = (): Storage | null => {
  try {
    return (require('@react-native-async-storage/async-storage') as { default: Storage }).default;
  } catch {
    return null;
  }
};

/** The cached page, if a recent one is kept. Never throws. */
export async function readFeedCache(now = Date.now()): Promise<FeedCache | null> {
  try {
    return decodeFeedCache(await storage()?.getItem(KEY), now);
  } catch {
    return null;
  }
}

/** Keeps the page as it is now (both halves; a half that has not loaded keeps what was cached). Never throws. */
export async function writeFeedCache(feed: HomeFeed | null, home: HomePage | null, now = Date.now()): Promise<void> {
  try {
    const store = storage();
    if (!store) return;
    let keptFeed = feed;
    let keptHome = home;
    if (!feed || !home) {
      const old = decodeFeedCache(await store.getItem(KEY), now);
      keptFeed = feed ?? old?.feed ?? null;
      keptHome = home ?? old?.home ?? null;
    }
    const text = encodeFeedCache(keptFeed, keptHome, now);
    if (text) await store.setItem(KEY, text);
  } catch {
    // A page that cannot be cached still works; it just opens on placeholders next time.
  }
}
