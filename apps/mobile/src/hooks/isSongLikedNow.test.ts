// isSongLikedNow reads the same three sources as the heart (useSongLikeState): a liked row, the library copy of a
// streamed song, and the account's online likes. The stores are replaced with their state only.
const mockLiked = new Set<string>();
// A new array per test: libraryLookup caches its map by the songs array.
let mockSongs: Array<{ id: string; title: string; artist: string; audioUri: string }> = [];
const mockOnline = new Set<string>();

jest.mock('../store/playlistStore', () => ({
  usePlaylistStore: { getState: () => ({ likedSongIds: mockLiked }) },
}));
jest.mock('../store/songsStore', () => ({
  useSongsStore: { getState: () => ({ songs: mockSongs }) },
}));
jest.mock('../store/onlineLibraryStore', () => ({
  useOnlineLibraryStore: { getState: () => ({ likedRefs: mockOnline }) },
}));

import { isSongLikedNow } from './useIsSongLiked';

const stream = { id: 'stream:saavn:abc123', title: 'Tum Hi Ho', artist: 'Arijit Singh' };

beforeEach(() => {
  mockLiked.clear();
  mockSongs = [];
  mockOnline.clear();
});

describe('isSongLikedNow', () => {
  it('is false for a streamed song nobody liked', () => {
    expect(isSongLikedNow(stream)).toBe(false);
  });

  it('counts a liked row with the same id', () => {
    mockLiked.add('song-1');
    expect(isSongLikedNow({ id: 'song-1', title: 'Halo', artist: 'Beyonce' })).toBe(true);
  });

  it('counts the liked library copy of a streamed song', () => {
    mockSongs.push({ id: 'download-9', title: 'Tum Hi Ho', artist: 'Arijit Singh', audioUri: 'file:///9.mp3' });
    mockLiked.add('download-9');
    expect(isSongLikedNow(stream)).toBe(true);
  });

  it('counts an online like of a streamed song', () => {
    mockOnline.add('saavn:abc123');
    expect(isSongLikedNow(stream)).toBe(true);
  });

  it('does not look for a library copy of a song that is not streamed', () => {
    mockSongs.push({ id: 'download-9', title: 'Halo', artist: 'Beyonce', audioUri: 'file:///9.mp3' });
    mockLiked.add('download-9');
    expect(isSongLikedNow({ id: 'song-2', title: 'Halo', artist: 'Beyonce' })).toBe(false);
  });
});
