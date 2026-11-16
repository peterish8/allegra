import { fromMobileId, parseSongRef, type SongSnapshot } from '@shared/songRef';
import type { Playlist, Song } from '../types/song';
import { displayPlaylistName } from '../utils/sentenceCase';

/** A stream row becomes the compact, portable record stored by online playlists. */
export function snapshotForStreamSong(song: Pick<Song, 'id' | 'title' | 'artist' | 'album' | 'duration' | 'coverImageUri' | 'coverRemoteUri'>): SongSnapshot | null {
  const ref = fromMobileId(song.id);
  if (!ref || !parseSongRef(ref)) return null;
  const art = song.coverRemoteUri || song.coverImageUri || '';
  return {
    ref,
    title: song.title,
    artist: song.artist ?? '',
    ...(song.album ? { album: song.album } : {}),
    artwork: /^https?:\/\//i.test(art) ? art : '',
    duration: Math.max(0, song.duration || 0),
  };
}

export type PlaylistSort = 'custom' | 'name';

export function sortSavedPlaylists(playlists: readonly Playlist[], sort: PlaylistSort): Playlist[] {
  const items = [...playlists];
  if (sort === 'name') items.sort((a, b) => displayPlaylistName(a.name).localeCompare(displayPlaylistName(b.name)));
  return items;
}

export function filterSavedPlaylists(playlists: readonly Playlist[], query: string): Playlist[] {
  const value = query.trim().toLocaleLowerCase();
  return value ? playlists.filter(playlist => displayPlaylistName(playlist.name).toLocaleLowerCase().includes(value)) : [...playlists];
}
