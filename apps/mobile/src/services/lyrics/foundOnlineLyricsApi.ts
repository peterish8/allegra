import { parseSongRef } from '@shared/songRef';
import { ALLEGRA_API_URL } from '../account/config';
import { buildUrl, fetchJson } from '../net/fetchWithTimeout';
import { mapFoundOnlineLyrics, type FoundOnlineLyrics } from './foundOnlineLyrics';

const LOOKUP_TIMEOUT_MS = 12_000;

export interface FoundOnlineLyricsQuery {
  title: string;
  artist: string;
  duration?: number;
  ref?: string;
  album?: string;
  language?: string;
  signal?: AbortSignal;
}

/** The website's final lyrics fallback. The shared fetch wrapper bounds the request and returns null on failure. */
export async function fetchFoundOnlineLyrics(query: FoundOnlineLyricsQuery): Promise<FoundOnlineLyrics | null> {
  if (!query.title.trim() || !query.artist.trim()) return null;
  const ref = query.ref && parseSongRef(query.ref) ? query.ref : undefined;
  const response = await fetchJson<unknown>(buildUrl(`${ALLEGRA_API_URL}/api/lyrics`, {
    title: query.title,
    artist: query.artist,
    duration: query.duration && query.duration > 0 ? query.duration : undefined,
    ref,
    album: query.album,
    language: query.language,
  }), { timeoutMs: LOOKUP_TIMEOUT_MS, signal: query.signal });
  return mapFoundOnlineLyrics(response);
}
