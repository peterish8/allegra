/**
 * The cover a song carries to another device (Connect, library sync): an https URL that any of
 * the listener's devices can load, or ''. A device's own cover file (a download's cover.jpg, a
 * cover the listener picked) means nothing anywhere else, and Android refuses cleartext image
 * requests, so neither may travel. A receiver reads '' as "look the cover up", not "no cover".
 *
 * Imported by the phone through Metro, so this file imports nothing (see tests/infra). String
 * checks, not `new URL()`: React Native's URL is partial, and its setters throw.
 */

/** The longest cover link a song snapshot may carry (`assertSongSnapshot` in convex/schema.ts). */
export const ARTWORK_MAX_LENGTH = 2048;

/** Catalog image hosts that serve https as well, so an http link to one is upgraded, not dropped. */
const UPGRADABLE_HOST = /^(?:[a-z0-9-]+\.)*(?:saavncdn\.com|gaanacdn\.com|ytimg\.com|googleusercontent\.com|mzstatic\.com)$/;

function shareable(candidate: string | null | undefined): string {
  const value = candidate?.trim() ?? '';
  if (!value || /\s/.test(value) || value.length > ARTWORK_MAX_LENGTH) return '';
  const head = value.match(/^(https?):\/\/([^/?#]*)/i);
  if (!head) return '';
  const scheme = head[1]?.toLowerCase();
  const authority = head[2] ?? '';
  // A link with credentials in it is not one to hand to every device.
  if (!authority || authority.includes('@')) return '';
  const host = authority.replace(/:\d+$/, '').toLowerCase();
  if (!host) return '';
  if (scheme === 'https') return value;
  return UPGRADABLE_HOST.test(host) ? `https${value.slice(4)}` : '';
}

/** The first candidate every device can load (upgraded to https where its host allows), else ''. */
export function shareableArtwork(...candidates: readonly (string | null | undefined)[]): string {
  for (const candidate of candidates) {
    const url = shareable(candidate);
    if (url) return url;
  }
  return '';
}
