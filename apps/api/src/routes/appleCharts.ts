import { Router } from 'express';

import { queryString, sendSuccess } from './common.js';

const APPLE_CHART_CACHE_CONTROL = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=21600';
const APPLE_RSS_ROOT = 'https://rss.marketingtools.apple.com/api/v2';
const UPSTREAM_TIMEOUT_MS = 8_000;

export type AppleChartType = 'songs' | 'playlists';

export interface AppleChartItem {
  readonly id: string;
  readonly rank: number;
  readonly title: string;
  readonly artist: string | null;
  readonly artworkUrl: string | null;
  readonly appleUrl: string;
  readonly releaseDate: string | null;
  readonly genres: readonly string[];
}

export interface AppleChartPayload {
  readonly source: 'Apple Music';
  readonly storefront: string;
  readonly type: AppleChartType;
  readonly available: boolean;
  readonly updatedAt: string | null;
  readonly items: readonly AppleChartItem[];
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function appleItemUrl(value: unknown, country: string): string | null {
  const raw = text(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:'
      && url.hostname === 'music.apple.com'
      && url.pathname.startsWith(`/${country.toLowerCase()}/`)
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function artworkUrl(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:'
      && (url.hostname === 'mzstatic.com' || url.hostname.endsWith('.mzstatic.com'))
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function normalizeItem(value: unknown, rank: number, country: string): AppleChartItem | null {
  const item = record(value);
  const id = text(item?.id);
  const title = text(item?.name);
  const appleUrl = appleItemUrl(item?.url, country);
  if (!id || !title || !appleUrl) return null;

  const rawGenres = Array.isArray(item?.genres) ? item.genres : [];
  const genres = rawGenres.flatMap((genre) => {
    const name = text(record(genre)?.name);
    return name ? [name] : [];
  }).slice(0, 5);

  return {
    id,
    rank,
    title,
    artist: text(item?.artistName),
    artworkUrl: artworkUrl(item?.artworkUrl100),
    appleUrl,
    releaseDate: text(item?.releaseDate),
    genres
  };
}

function emptyPayload(storefront: string, type: AppleChartType): AppleChartPayload {
  return { source: 'Apple Music', storefront, type, available: false, updatedAt: null, items: [] };
}

function updatedAt(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const milliseconds = Date.parse(raw);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

async function loadAppleChart(
  fetchImpl: typeof fetch,
  storefront: string,
  type: AppleChartType
): Promise<AppleChartPayload> {
  const country = storefront.toLowerCase();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${APPLE_RSS_ROOT}/${country}/music/most-played/50/${type}.json`, {
      headers: { accept: 'application/json' },
      signal: controller.signal
    });
    if (!response.ok) return emptyPayload(storefront, type);

    const feed = record(record(await response.json())?.feed);
    if (!Array.isArray(feed?.results)) return emptyPayload(storefront, type);

    const items = feed.results.flatMap((item, index) => {
      const normalized = normalizeItem(item, index + 1, storefront);
      return normalized ? [normalized] : [];
    });
    return {
      source: 'Apple Music',
      storefront,
      type,
      available: true,
      updatedAt: updatedAt(feed.updated),
      items
    };
  } catch {
    return emptyPayload(storefront, type);
  } finally {
    clearTimeout(timeout);
  }
}

export function appleChartsRouter(fetchImpl: typeof fetch = fetch): Router {
  const router = Router();

  router.get('/charts/apple', async (request, response) => {
    const storefront = (queryString(request.query.country) ?? 'IN').toUpperCase();
    const askedType = queryString(request.query.type) ?? 'songs';
    if (!/^[A-Z]{2}$/.test(storefront) || (askedType !== 'songs' && askedType !== 'playlists')) {
      response.status(400).json({ success: false, data: null, error: "Something's missing from that request." });
      return;
    }

    response.setHeader('Cache-Control', APPLE_CHART_CACHE_CONTROL);
    sendSuccess(response, await loadAppleChart(fetchImpl, storefront, askedType));
  });

  return router;
}
