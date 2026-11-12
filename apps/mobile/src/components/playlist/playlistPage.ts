/**
 * The playlist page's pure rules (1.44.0, owner's Spotify screenshots): the cover's colour washing the top of the page,
 * the length line, the share text and the flip-card deck behind the cover. Kept free of React Native so Jest reads them.
 */
import { hexToHsl, hslToHex } from '../allegra/palette';

/** The cover leads at about 62% of the width (Spotify's), never wider than this on a tablet. */
export const COVER_SHARE = 0.62;
export const COVER_MAX = 300;
export const coverSizeFor = (windowWidth: number): number => Math.round(Math.min(windowWidth * COVER_SHARE, COVER_MAX));

/** The "Find in playlist" bar above the cover: drawn 40 tall in a 48 touch row. */
export const FIND_BAR_HEIGHT = 48;

/**
 * Spotify's playlist wash: a calm, muted tone of the cover at the top, sinking into the page's black. The hue is the
 * cover's; saturation and lightness are clamped so a loud cover never glares behind white text and a dark one still
 * shows its colour. Returns [top, middle, bottom].
 */
export const playlistWash = (hex: string): [string, string, string] => {
  const { hue, sat } = hexToHsl(hex);
  const s = Math.min(0.28, Math.max(0.08, sat * 0.4));
  return [hslToHex(hue, s, 0.32), hslToHex(hue, s * 0.8, 0.16), 'rgba(11, 13, 16, 0)'];
};
export const PLAYLIST_WASH_STOPS = [0, 0.55, 1] as const;

/** "1 hr 16 min" / "42 min" / "" for a playlist with no known lengths. Seconds in, always. */
export const playlistLength = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 60) return '';
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours} hr ${mins} min` : `${mins} min`;
};

/** What Share sends: the name, then up to `max` songs one per line, then where it came from. */
export const playlistShareText = (name: string, songs: readonly { title: string; artist?: string | null }[], max = 30): string => {
  const lines = songs.slice(0, max).map((s, i) => `${i + 1}. ${s.title}${s.artist ? ` — ${s.artist}` : ''}`);
  const more = songs.length > max ? [`…and ${songs.length - max} more`] : [];
  return [name, '', ...lines, ...more, '', 'via LuvLyrics'].join('\n');
};

/** The flip: 0 = the cover, 1 = the deck. Each face shows only on its own half of the turn. */
export const FLIP_MS = 420;
export const frontOpacity = (flip: number): number => (flip < 0.5 ? 1 : 0);
export const backOpacity = (flip: number): number => (flip >= 0.5 ? 1 : 0);

/**
 * Which card the deck opens on: the playing song while this playlist plays, else the first. An id the list no longer
 * holds (a search narrowed it) also opens on the first.
 */
export const deckStartIndex = (ids: readonly string[], playingId: string | null | undefined, playingHere: boolean): number => {
  if (!playingHere || !playingId) return 0;
  const at = ids.indexOf(playingId);
  return at < 0 ? 0 : at;
};

/** The card a swipe came to rest on, from the scroll offset (cards are `cardWidth` apart). */
export const settledCard = (offsetX: number, cardWidth: number, count: number): number => {
  if (count <= 0 || cardWidth <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(offsetX / cardWidth)));
};

/**
 * Whether resting on a card changes the song: only when it is not already the one playing. Swiping back to the
 * playing song, or a deck that opened on it, never restarts it.
 */
export const swipeChangesSong = (cardId: string | undefined, playingId: string | null | undefined, playingHere: boolean): boolean =>
  !!cardId && !(playingHere && cardId === playingId);

/**
 * The find bar hides above the cover: the list rests scrolled past it (offset = the bar's height) and a pull down
 * scrolls it into view under the finger, the way iOS lists reveal their search. The pull is the list's own scroll,
 * so it is finger-tracked, interruptible and flings like any scroll.
 */
export type FindSettle = 'reveal' | 'hide' | 'rest';

/**
 * What to do when the list stops (or the finger lifts) at `offset`. `velocity` is the scroll velocity in px/ms:
 * negative while the content moves down (a pull). Inside the bar's height the nearer end wins, a fling decides.
 */
export const settleFind = (offset: number, velocity: number, slot: number = FIND_BAR_HEIGHT): FindSettle => {
  if (!Number.isFinite(offset) || offset >= slot) return 'rest';
  if (offset <= 0) return 'reveal';
  if (velocity <= -FIND_FLING) return 'reveal';
  if (velocity >= FIND_FLING) return 'hide';
  return offset < slot / 2 ? 'reveal' : 'hide';
};
const FIND_FLING = 0.3;

/**
 * Empty space under a short playlist so the page can still rest scrolled past the bar: the content must be at least
 * `slot` taller than the viewport. `content` is the height without this filler.
 */
export const findFiller = (viewport: number, content: number, slot: number = FIND_BAR_HEIGHT): number =>
  Number.isFinite(viewport) && Number.isFinite(content) && viewport > 0 ? Math.max(0, Math.ceil(viewport + slot - content)) : 0;
