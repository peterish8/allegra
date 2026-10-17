import { CACHE_MISS, isCacheMiss, type CacheMiss, type CacheStore } from '../../lib/cache.js';
import { fetchBodyWithTimeout } from '../../lib/fetchWithTimeout.js';
import { foldLatin } from '../../shared/lyricsText.js';

/**
 * Lyric sites: the last place lyrics come from, when no provider and not JioSaavn has the song.
 * Each site is one adapter (tamil2lyrics.ts) that finds a song's page and reads its text. Pages
 * are fetched only by the API, politely (an honest User-Agent, one request a second per host, an
 * 8 s timeout, results cached), never from a listener's browser.
 *
 * Listeners never see a site's name or address: what reaches them is "Found online". The source
 * is kept here only so a later sync can record where its words came from.
 */

export const SITE_USER_AGENT = 'Allegra/1.0 (+https://allegravibe.vercel.app; lyrics lookup)';
const SITE_TIMEOUT_MS = 8_000;
const HOST_SPACING_MS = 1_000;
const FOUND_TTL_SECONDS = 86_400;
const MISS_TTL_SECONDS = 86_400;
/** Bump when an adapter's matching or cleanup changes, so old answers do not outlive the fix. */
const CACHE_VERSION = 'v2';

export type SiteScript = 'latin' | 'native';

/** What a lyric site is asked. */
export interface SiteQuery {
  /** The title without catalog decorations: "Mozhiye", not `Mozhiye (From "Baththa")`. */
  readonly title: string;
  /** Everyone the catalog credits: "Sai Abhyankkar, Sid Sriram, Karthik Netha". */
  readonly artist: string;
  /** The film a soundtrack song is from (filmOf), when the catalog says. */
  readonly film?: string;
  /** The catalog's language name ("tamil"), when known. */
  readonly language?: string;
}

/** One rendering of a song's words from a site. */
export interface SiteVersion {
  readonly script: SiteScript;
  /** ISO 639-1 ("ta"). */
  readonly language: string;
  /** Cleaned text: a line per lyric, a blank line between stanzas. */
  readonly text: string;
}

/** What a site has for a song. */
export interface SiteLyrics {
  /** Latin (transliteration) first, then the song's own script. Never empty. */
  readonly versions: readonly SiteVersion[];
  /** Server-side only: never sent to listeners. */
  readonly source: { readonly name: string; readonly url: string };
}

/** One lyric site's adapter. `find` resolves null for no match and never rejects. */
export interface LyricSite {
  /** Catalog language names the site covers ("tamil"). */
  readonly languages: readonly string[];
  find(query: SiteQuery): Promise<SiteLyrics | null>;
}

/** Options for PoliteFetcher; the defaults are what production uses. */
export interface PoliteFetcherOptions {
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  /** Minimum gap between two requests starting to the same host. */
  readonly spacingMs?: number;
}

/** Fetches site pages a second apart per host. Resolves null on any failure; never rejects. */
export class PoliteFetcher {
  private readonly nextSlot = new Map<string, number>();
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly spacingMs: number;

  public constructor(options: PoliteFetcherOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? SITE_TIMEOUT_MS;
    this.spacingMs = options.spacingMs ?? HOST_SPACING_MS;
  }

  /** The body of a 2xx answer, or null. */
  public async text(url: URL): Promise<string | null> {
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot.get(url.host) ?? 0);
    this.nextSlot.set(url.host, slot + this.spacingMs);
    if (slot > now) {
      await new Promise((resolve) => setTimeout(resolve, slot - now));
    }
    try {
      const response = await fetchBodyWithTimeout(
        url,
        { headers: { 'User-Agent': SITE_USER_AGENT, Accept: 'text/html,application/xml;q=0.9' }, redirect: 'follow' },
        this.timeoutMs,
        this.fetchImpl
      );
      return response.ok ? response.body : null;
    } catch {
      return null;
    }
  }
}

/** Every configured site, asked in turn for a song in a language it covers. Cached; never rejects. */
export class LyricSites {
  public constructor(
    private readonly sites: readonly LyricSite[],
    private readonly cache: CacheStore
  ) {}

  /** Whether any site covers the language. An unknown language is worth a try. */
  public covers(language: string | undefined): boolean {
    const wanted = language?.trim().toLowerCase();
    return this.sites.some((site) => !wanted || site.languages.includes(wanted));
  }

  /** The first site's answer for the song, cached a day (hits and misses). */
  public async find(query: SiteQuery): Promise<SiteLyrics | null> {
    if (!this.covers(query.language)) {
      return null;
    }
    const key = `lyrics-site:${CACHE_VERSION}:${foldLatin(query.title)}:${foldLatin(query.artist)}:${foldLatin(query.film ?? '')}`;
    const wanted = query.language?.trim().toLowerCase();
    try {
      const cached = await this.cache.get<SiteLyrics | CacheMiss>(key);
      if (cached) {
        return isCacheMiss(cached) ? null : cached;
      }
      let found: SiteLyrics | null = null;
      for (const site of this.sites) {
        if (wanted && !site.languages.includes(wanted)) {
          continue;
        }
        found = await site.find(query).catch((): null => null);
        if (found) {
          break;
        }
      }
      await this.cache.set(key, found ?? CACHE_MISS, found ? FOUND_TTL_SECONDS : MISS_TTL_SECONDS);
      return found;
    } catch {
      // A cache failure: no answer this time rather than a broken lyrics lookup.
      return null;
    }
  }
}

/**
 * The film a soundtrack song is from: `Mozhiye (From "Baththa")`, or an album named
 * `Baththa (Original Motion Picture Soundtrack)`. Undefined when neither says.
 */
export function filmOf(title: string, album: string | undefined): string | undefined {
  for (const text of [title, album ?? '']) {
    const from = text.match(/\(\s*from\s+["“']?([^"”')]+?)["”']?\s*\)/i);
    if (from?.[1]) {
      return from[1].trim();
    }
  }
  const soundtrack = album?.match(/^(.+?)\s*[([]\s*(?:original\s+)?(?:motion\s+picture\s+)?(?:sound\s*track|ost)\b/i);
  return soundtrack?.[1]?.trim() || undefined;
}

/** "A, B & C feat. D" as folded names, for comparing with the people a page credits. */
export function creditedNames(artist: string): string[] {
  return artist
    .split(/,|&|\band\b|\bfeat\.?\b|\bft\.?\b|\bx\b|\//i)
    .map((name) => foldLatin(name))
    .filter((name) => name.length >= 3);
}
