import { filterLibraryCollections, indexLibraryCollections } from './libraryCollections';
import type { Song } from '../types/song';

const song = (id: string, artist?: string, album?: string): Song => ({
  id,
  title: `Song ${id}`,
  artist,
  album,
  duration: 100,
  dateCreated: '2026-01-01T00:00:00.000Z',
  dateModified: '2026-01-01T00:00:00.000Z',
  playCount: 0,
  gradientId: 'dynamic',
  lyrics: [],
  coverImageUri: '',
  isLiked: false,
  isHidden: false,
  playlistOnly: false,
});

describe('large Library collection index', () => {
  it('indexes artist and album groups once and filters normalized names immediately', () => {
    const index = indexLibraryCollections([
      song('1', '  Artist One ', 'Album A'),
      song('2', 'Artist One', 'Album B'),
      song('3', 'Artist Two', 'Album A'),
      song('4', '', undefined),
    ]);

    expect(index.artists.map(group => [group.name, group.songs.length])).toEqual([['Artist One', 2], ['Artist Two', 1]]);
    expect(index.albums.map(group => [group.name, group.songs.length])).toEqual([['Album A', 2], ['Album B', 1]]);
    expect(filterLibraryCollections(index.artists, '  artist two ').map(group => group.name)).toEqual(['Artist Two']);
    expect(filterLibraryCollections(index.albums, 'missing')).toEqual([]);
  });
});
