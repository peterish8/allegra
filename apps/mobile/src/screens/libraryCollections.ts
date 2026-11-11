import type { Song } from '../types/song';

export interface LibraryCollection {
  readonly name: string;
  readonly normalizedName: string;
  readonly songs: readonly Song[];
}

const buildIndex = (songs: readonly Song[], field: 'artist' | 'album'): LibraryCollection[] => {
  const groups = new Map<string, Song[]>();
  for (const song of songs) {
    const name = song[field]?.trim();
    if (!name) continue;
    const group = groups.get(name) ?? [];
    group.push(song);
    groups.set(name, group);
  }
  return Array.from(groups, ([name, items]) => ({
    name,
    normalizedName: name.toLowerCase(),
    songs: items,
  })).sort((a, b) => a.name.localeCompare(b.name));
};

/** Build once when the visible library changes, then search the compact name index per keystroke. */
export const indexLibraryCollections = (songs: readonly Song[]) => ({
  artists: buildIndex(songs, 'artist'),
  albums: buildIndex(songs, 'album'),
});

export const filterLibraryCollections = (groups: readonly LibraryCollection[], query: string): LibraryCollection[] => {
  const normalizedQuery = query.trim().toLowerCase();
  return normalizedQuery ? groups.filter(group => group.normalizedName.includes(normalizedQuery)) : [...groups];
};
