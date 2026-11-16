import type { Playlist, Song } from '../types/song';
import { filterSavedPlaylists, snapshotForStreamSong, sortSavedPlaylists } from './savedIn';

const playlist = (id: string, name: string, sortOrder: number): Playlist => ({
  id, name, isDefault: id === 'liked', sortOrder, dateCreated: '', dateModified: '',
});

describe('saved-in playlist helpers', () => {
  it('keeps playlist order unless name sorting is selected and searches display names', () => {
    const playlists = [playlist('z', 'Road Trip', 0), playlist('a', 'Jazz', 1)];
    expect(sortSavedPlaylists(playlists, 'custom').map(item => item.id)).toEqual(['z', 'a']);
    expect(sortSavedPlaylists(playlists, 'name').map(item => item.id)).toEqual(['a', 'z']);
    expect(filterSavedPlaylists(playlists, '  jazz ').map(item => item.id)).toEqual(['a']);
  });

  it('stores stream identity and remote artwork without turning a stream into a download', () => {
    const song: Song = {
      id: 'stream:saavn:track-1', title: 'Blue Hour', artist: 'Ari', album: 'Night', duration: 123,
      gradientId: 'dynamic', dateCreated: '', dateModified: '', playCount: 0, lyrics: [],
      coverImageUri: 'file:///private/cover.jpg', coverRemoteUri: 'https://img.example/cover.jpg',
    };
    expect(snapshotForStreamSong(song)).toEqual({
      ref: 'saavn:track-1', title: 'Blue Hour', artist: 'Ari', album: 'Night',
      artwork: 'https://img.example/cover.jpg', duration: 123,
    });
    expect(snapshotForStreamSong({ ...song, id: 'local-1' })).toBeNull();
  });
});
