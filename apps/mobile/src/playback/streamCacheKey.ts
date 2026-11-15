import { sha256Hex } from '@shared/sha256';

/**
 * The song cache's key for a song, exactly as Kotlin's `StreamCacheKey.of` makes it: the id plus a hash of host and
 * raw path, so a refreshed signed link keeps its cached bytes. Used only to keep the playing song when the listener
 * clears the cache. Null for anything but https.
 */
export function streamCacheKeyFor(id: string, uri: string): string | null {
  if (!id.trim()) return null;
  let parsed: URL;
  try { parsed = new URL(uri); } catch { return null; }
  if (parsed.protocol !== 'https:' || !parsed.hostname) return null;
  return `v1|${id}|${sha256Hex(parsed.hostname.toLowerCase() + parsed.pathname).slice(0, 16)}`;
}
