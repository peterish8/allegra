/**
 * Pure shaping for the Library screen: the artist orbit, the A–Z rail and the
 * cover deck's card positions. Kept free of React so it can be tested.
 */
import { leadArtist } from '@shared/songRef';
import type { Song } from '../../types/song';

/** "A, B & C" / "A feat. B" → "A": the artist whose song it is. Shared with Allegra (packages/shared/songRef.ts). */
export { leadArtist };

export interface ArtistGroup {
  name: string;
  count: number;
  /** The newest song with a cover, for the bubble. */
  cover?: string;
  /** Most recent song first. */
  songs: Song[];
}

/** Artists by how many of their songs are saved (ties: most recent first). */
export const groupArtists = (songs: Song[], limit = 14): ArtistGroup[] => {
  const byName = new Map<string, ArtistGroup>();
  for (const song of songs) {
    const name = leadArtist(song.artist);
    if (!name) continue;
    const key = name.toLowerCase();
    const group = byName.get(key) ?? { name, count: 0, songs: [] };
    group.count += 1;
    group.songs.push(song);
    byName.set(key, group);
  }
  const newest = (s: Song) => Date.parse(s.dateCreated) || 0;
  return [...byName.values()]
    .map(g => {
      const sorted = [...g.songs].sort((a, b) => newest(b) - newest(a));
      return { ...g, songs: sorted, cover: sorted.find(s => s.coverImageUri)?.coverImageUri };
    })
    .sort((a, b) => b.count - a.count || newest(b.songs[0]) - newest(a.songs[0]))
    .slice(0, limit);
};

/** The rail letter a title or name files under: A–Z, else "#". */
export const letterOf = (text: string | undefined | null): string => {
  const first = (text ?? '').trim().replace(/^(the|a|an)\s+/i, '').charAt(0).toUpperCase();
  return first >= 'A' && first <= 'Z' ? first : '#';
};

/** For a list sorted by `keyOf`, the first index of each letter, in list order. */
export const letterIndex = <T,>(items: T[], keyOf: (item: T) => string | undefined | null): { letter: string; index: number }[] => {
  const seen = new Set<string>();
  const out: { letter: string; index: number }[] = [];
  items.forEach((item, index) => {
    const letter = letterOf(keyOf(item));
    if (!seen.has(letter)) {
      seen.add(letter);
      out.push({ letter, index });
    }
  });
  return out;
};

/** Which rail entry a touch at `y` (0 = top of the rail) lands on. */
export const railPick = (y: number, railHeight: number, count: number): number => {
  if (count <= 0 || railHeight <= 0) return 0;
  return Math.max(0, Math.min(count - 1, Math.floor((y / railHeight) * count)));
};


/**
 * The deck's songs: what was played last, then what arrived last, at most `max`, each once. One pass over each list,
 * with a Set for "already picked".
 */
export const pickDeck = (songs: readonly Song[], max: number): Song[] => {
  const time = (iso: string | undefined) => (iso ? Date.parse(iso) || 0 : 0);
  const played = songs.filter(s => s.lastPlayed).sort((a, b) => time(b.lastPlayed) - time(a.lastPlayed));
  const newest = [...songs].sort((a, b) => time(b.dateCreated) - time(a.dateCreated));
  const picked = new Set<string>();
  const out: Song[] = [];
  for (const list of [played, newest]) {
    for (const s of list) {
      if (out.length >= max) return out;
      if (picked.has(s.id)) continue;
      picked.add(s.id);
      out.push(s);
    }
  }
  return out;
};

/**
 * The deck as it was, kept: songs already in it stay where they were (playing one stamps it as played, which would
 * otherwise jump it to the front and move every card along), songs that joined go after them, songs that left drop
 * out. Each song is the fresh object from `next` (a new cover or title shows), in O(n).
 */
export const keepDeckOrder = (previousIds: readonly string[], next: readonly Song[]): Song[] => {
  const byId = new Map(next.map(s => [s.id, s] as const));
  const kept: Song[] = [];
  const seen = new Set<string>();
  for (const id of previousIds) {
    const song = byId.get(id);
    if (song && !seen.has(id)) {
      kept.push(song);
      seen.add(id);
    }
  }
  for (const s of next) if (!seen.has(s.id)) kept.push(s);
  return kept;
};
