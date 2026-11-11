/** The pace and rhythm of Marquee, kept apart from the view so they can be tested. */

/** Points per second: slow enough to read as it goes by. */
export const MARQUEE_SPEED = 30;
/** Rest between loops (the 2–3 seconds the title sits still). */
export const MARQUEE_REST_MS = 2500;
/** A beat before the first loop, so a new title can be read where it starts. */
export const MARQUEE_START_MS = 1400;
/** Space between the end of the title and its next copy. */
export const MARQUEE_GAP = 48;

/**
 * Now Playing (owner, 1.41.0): the title at its full size scrolls slowly right to left and rests 5 seconds between
 * loops; the artist, smaller, rests 3 seconds. Slower than the default so a long title reads as it passes.
 */
export const PLAYER_TITLE_SPEED = 24;
export const PLAYER_TITLE_REST_MS = 5000;
export const PLAYER_ARTIST_REST_MS = 3000;

/** A title swap is a new song even when its text matches the row before it. */
export const swapMarqueeKey = (songId: string | undefined, text: string): string => `${songId ?? ''}:${text}`;

/** Metadata arriving for the same song should settle neutrally, not reuse a stale skip direction. */
export const swapMarqueeDirection = (previousSongId: string | undefined, songId: string | undefined, direction: number): number =>
  previousSongId === songId ? 0 : direction;

/** The mini player's one line, as Spotify shows it: the song, a dot, then the artist. */
export const miniPlayerLine = (title: string, artist?: string | null): string => {
  const name = title.trim() || 'Not playing';
  const by = artist?.trim();
  return by ? `${name} • ${by}` : name;
};

/** How far one loop travels and how long it takes; 0 when the text fits. */
export const marqueeLoop = (textWidth: number, boxWidth: number, gap = MARQUEE_GAP, speed = MARQUEE_SPEED): { distance: number; duration: number } => {
  if (boxWidth <= 0 || textWidth <= boxWidth + 1) return { distance: 0, duration: 0 };
  const distance = Math.ceil(textWidth) + gap;
  return { distance, duration: Math.round((distance / speed) * 1000) };
};
