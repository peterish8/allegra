import type { AlbumSummary } from '@shared/types';

export interface SongAlbumSeed { id?: string; songRef?: string; album?: string; artist?: string }
interface AlbumLookup {
  song: (ref: string) => Promise<{ albumId?: string; album?: string; artist?: string }>;
  search: (query: string) => Promise<AlbumSummary[]>;
}
const key = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' ');

/** Prefer the recording's actual release id; a title match must also identify its credited artist. */
export async function resolveSongAlbum(seed: SongAlbumSeed, lookup: AlbumLookup): Promise<string | null> {
  if (seed.id) return seed.id;
  const song = seed.songRef ? await lookup.song(seed.songRef) : seed;
  if ('albumId' in song && song.albumId) return song.albumId;
  const album = song.album || seed.album;
  const artist = song.artist || seed.artist;
  if (!album || !artist) return null;
  const rows = await lookup.search(`${album} ${artist}`);
  const matches = rows.filter(row => key(row.name) === key(album) && key(row.artist) === key(artist));
  return matches.length === 1 ? matches[0].id : null;
}
