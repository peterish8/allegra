/**
 * The rows of the Up next panel as the native list (`NativeQueueList`, android/.../views/NativeQueueListView.kt)
 * wants them: plain data, one entry per shown row. Kept free of React Native imports so it is unit-testable.
 *
 * `i` is the row's place in the whole queue (the list may be filtered), which is what the panel's `pick` and the
 * queue's `moveItem` use. A song with no cover (or one that fails to load) gets the generated cover, so its colours
 * and monogram are decided here, from the same seed `Artwork` uses, and the native cover draws the same picture.
 */
import { duotoneFor, hashString, monogramOf } from '../allegra/artworkSeed';

export interface QueueSongLike {
  id: string;
  title: string;
  artist?: string;
  duration?: number;
  coverImageUri?: string | null;
}

export const queueClock = (s?: number): string => {
  if (!s || !Number.isFinite(s) || s <= 0) return '';
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r < 10 ? '0' : ''}${r}`;
};

export interface NativeQueueRow {
  i: number;
  id: string;
  title: string;
  sub: string;
  cover: string | null;
  base: string;
  mid: string;
  spark: string;
  glyph: string;
  variant: number;
}

export const buildQueueRows = (songs: readonly QueueSongLike[], shown: readonly number[]): NativeQueueRow[] => {
  const rows: NativeQueueRow[] = [];
  for (const i of shown) {
    const song = songs[i];
    if (!song) continue;
    const label = song.title || 'Untitled';
    const seed = `${label}|${song.artist ?? ''}`;
    const [base, mid, spark] = duotoneFor(seed);
    rows.push({
      i,
      id: song.id,
      title: song.title,
      sub: [song.artist || 'Unknown artist', queueClock(song.duration)].filter(Boolean).join(' · '),
      cover: song.coverImageUri || null,
      base,
      mid,
      spark,
      glyph: monogramOf(label),
      variant: hashString(`${seed}#v`) % 3,
    });
  }
  return rows;
};

export const queueRowsJson = (songs: readonly QueueSongLike[], shown: readonly number[]): string =>
  JSON.stringify(buildQueueRows(songs, shown));
