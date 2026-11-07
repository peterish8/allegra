/**
 * Share links (1.44.0, owner): one https link per song or public playlist that opens LuvLyrics when it is installed
 * (Android App Links: the website serves /.well-known/assetlinks.json and the app's manifest claims these paths) and
 * the website otherwise — always the website when someone pastes it into a browser's address bar.
 *
 *   https://allegravibe.vercel.app/song/saavn/B4-hLCKJ?t=Title&a=Artist
 *   https://allegravibe.vercel.app/song/find?t=Title&a=Artist     (a song with no catalog id: found by name)
 *   https://allegravibe.vercel.app/shared/abcd2345                (a public playlist, the API's share code)
 *
 * The title and artist ride along so a link still finds the song if its catalog id ever stops resolving.
 * No npm imports: the website and the phone both compile this file.
 */
import { parseSongRef, songRef, type SongRef } from './songRef.ts';

export const SHARE_ORIGIN = 'https://allegravibe.vercel.app';
/** Hosts whose links the app opens (the second is the planned custom domain). */
export const SHARE_HOSTS = ['allegravibe.vercel.app', 'allegra.music'] as const;
/** The app's Android package, for the website's "Open in LuvLyrics" link and assetlinks.json. */
export const ANDROID_PACKAGE = 'com.lyricflow.app';

/** The API's share-code alphabet (apps/api/src/lib/randomCode.ts): no 0, 1, i, l or o. */
export const SHARE_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const SHARE_CODE_SHAPE = new RegExp(`^[${SHARE_CODE_ALPHABET}]{6,12}$`);
export const isShareCode = (code: string): boolean => SHARE_CODE_SHAPE.test(code);

export type ShareTarget =
  | { readonly kind: 'song'; readonly ref: SongRef | null; readonly title: string; readonly artist: string }
  | { readonly kind: 'playlist'; readonly code: string };

const query = (title: string, artist: string): string => {
  const parts: string[] = [];
  if (title.trim()) parts.push(`t=${encodeURIComponent(title.trim())}`);
  if (artist.trim()) parts.push(`a=${encodeURIComponent(artist.trim())}`);
  return parts.length ? `?${parts.join('&')}` : '';
};

export function songSharePath(ref: SongRef | null, title: string, artist: string): string {
  const parsed = ref ? parseSongRef(ref) : null;
  const where = parsed ? `${parsed.source}/${encodeURIComponent(parsed.id)}` : 'find';
  return `/song/${where}${query(title, artist)}`;
}

export const songShareUrl = (ref: SongRef | null, title: string, artist: string, origin = SHARE_ORIGIN): string =>
  `${origin}${songSharePath(ref, title, artist)}`;

export const playlistShareUrl = (code: string, origin = SHARE_ORIGIN): string => `${origin}/shared/${encodeURIComponent(code.toLowerCase())}`;

export const shareUrlFor = (target: ShareTarget, origin = SHARE_ORIGIN): string =>
  target.kind === 'song' ? songShareUrl(target.ref, target.title, target.artist, origin) : playlistShareUrl(target.code, origin);

const decode = (value: string | undefined): string | null => {
  if (value === undefined) return null;
  try { return decodeURIComponent(value.replace(/\+/g, ' ')); } catch { return null; }
};

/**
 * A path (with its query) on the share host -> what it shares, or null. `/song/<source>/<id>`, `/song/find` and
 * `/shared/<code>`; anything else is not a share link.
 */
export function parseSharePath(pathAndQuery: string): ShareTarget | null {
  const [pathPart, queryPart = ''] = pathAndQuery.split('#')[0].split('?');
  const segments = pathPart.split('/').filter(Boolean);
  const params = new Map<string, string>();
  for (const pair of queryPart.split('&').filter(Boolean)) {
    const [k, v = ''] = pair.split('=');
    const key = decode(k);
    const value = decode(v);
    if (key && value !== null) params.set(key, value);
  }
  const title = (params.get('t') ?? '').trim().slice(0, 200);
  const artist = (params.get('a') ?? '').trim().slice(0, 200);
  if (segments[0] === 'song') {
    if (segments[1] === 'find' && segments.length === 2) return title ? { kind: 'song', ref: null, title, artist } : null;
    if (segments.length !== 3) return null;
    const id = decode(segments[2]);
    const ref = id ? songRef(segments[1], id) : null;
    return ref ? { kind: 'song', ref, title, artist } : null;
  }
  if (segments[0] === 'shared' && segments.length === 2) {
    const code = decode(segments[1])?.toLowerCase() ?? '';
    return isShareCode(code) ? { kind: 'playlist', code } : null;
  }
  return null;
}

/** A full link -> what it shares, or null when it is not one of ours. */
export function parseShareUrl(url: string): ShareTarget | null {
  const match = /^https?:\/\/([^/?#]+)(\/[^#]*)?/i.exec(url.trim());
  if (!match) return null;
  const host = match[1].toLowerCase().replace(/^www\./, '');
  if (!(SHARE_HOSTS as readonly string[]).includes(host)) return null;
  return parseSharePath(match[2] ?? '/');
}

/**
 * The website's "Open in LuvLyrics" link on Android: Chrome hands the same https link to the app when it is installed
 * (its manifest claims these paths) and otherwise loads `pageUrl` again, so the listener stays on the website.
 */
export const androidIntentUrl = (pageUrl: string): string => {
  const stripped = pageUrl.replace(/^https?:\/\//i, '');
  return `intent://${stripped}#Intent;scheme=https;package=${ANDROID_PACKAGE};S.browser_fallback_url=${encodeURIComponent(pageUrl)};end`;
};
