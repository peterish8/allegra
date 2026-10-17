import { fetchWithTimeout } from '../lib/fetchWithTimeout.js';

/** One row of a storefront's most-played songs chart: only what finding it in the catalog needs. */
export interface ChartEntry {
  readonly title: string;
  readonly artist: string;
}

export interface ChartFeed {
  readonly updatedAt: string | null;
  readonly entries: readonly ChartEntry[];
}

export interface AppleRssProviderOptions {
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

interface FeedResult {
  readonly name?: unknown;
  readonly artistName?: unknown;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isoDate(value: unknown): string | null {
  const raw = text(value);
  const milliseconds = raw ? Date.parse(raw) : Number.NaN;
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

/**
 * Apple's public marketing RSS: a storefront's 50 most-played songs, in chart order. Only titles and
 * artists are read; listeners never see where the chart came from. Null when the feed cannot be read.
 */
export class AppleRssProvider {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  public constructor(options: AppleRssProviderOptions = {}) {
    this.baseUrl = options.baseUrl ?? 'https://rss.marketingtools.apple.com/api/v2';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8_000;
  }

  public async mostPlayedSongs(storefront: string): Promise<ChartFeed | null> {
    try {
      const response = await fetchWithTimeout(
        `${this.baseUrl}/${storefront.toLowerCase()}/music/most-played/50/songs.json`,
        { headers: { Accept: 'application/json' } },
        this.timeoutMs,
        this.fetchImpl
      );
      if (!response.ok) return null;
      const body: unknown = await response.json();
      const feed = typeof body === 'object' && body !== null && 'feed' in body ? body.feed : null;
      if (typeof feed !== 'object' || feed === null || !('results' in feed) || !Array.isArray(feed.results)) return null;
      const entries = (feed.results as unknown[]).flatMap((item): ChartEntry[] => {
        const result = (typeof item === 'object' && item !== null ? item : {}) as FeedResult;
        const title = text(result.name);
        const artist = text(result.artistName);
        return title && artist ? [{ title, artist }] : [];
      });
      return { updatedAt: isoDate('updated' in feed ? feed.updated : null), entries };
    } catch {
      return null;
    }
  }
}
