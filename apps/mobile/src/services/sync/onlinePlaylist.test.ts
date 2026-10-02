const mockGetOnline = jest.fn();
const mockUpsert = jest.fn();
const mockRecord = jest.fn();
const mockToggleLike = jest.fn();
const mockFetchPlaylists = jest.fn(async () => undefined);
const mockBump = jest.fn();
let likedRefs = new Set<string>();

jest.mock('../../database/syncQueries', () => ({
  getOnlinePlaylistSongs: (...args: unknown[]) => mockGetOnline(...args),
  upsertOnlinePlaylistSong: (...args: unknown[]) => mockUpsert(...args),
}));
jest.mock('./LibrarySync', () => ({ record: (...args: unknown[]) => mockRecord(...args) }));
jest.mock('./onlineLike', () => ({ toggleOnlineLike: (...args: unknown[]) => mockToggleLike(...args) }));
jest.mock('../../store/onlineLibraryStore', () => ({
  useOnlineLibraryStore: { getState: () => ({ likedRefs, bumpPlaylists: mockBump }) },
}));
jest.mock('../../store/playlistStore', () => ({
  usePlaylistStore: { getState: () => ({ defaultPlaylistId: 'liked', fetchPlaylists: mockFetchPlaylists }) },
}));

import type { SongRef, SongSnapshot } from '@shared/songRef';
import { addOnlineSongToPlaylist } from './onlinePlaylist';

const song: SongSnapshot = { ref: 'saavn:abc' as SongRef, title: 'Kesariya', artist: 'Arijit Singh', artwork: 'https://img.example/a.jpg', duration: 268 };

beforeEach(() => {
  jest.clearAllMocks();
  likedRefs = new Set();
  mockGetOnline.mockResolvedValue([]);
  mockUpsert.mockResolvedValue(undefined);
});

describe('addOnlineSongToPlaylist', () => {
  it('stores the song, records the change for sync and refreshes the lists', async () => {
    expect(await addOnlineSongToPlaylist('road', song)).toBe('added');
    expect(mockUpsert).toHaveBeenCalledWith('road', expect.objectContaining({ ref: 'saavn:abc', title: 'Kesariya' }));
    expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({ op: 'playlist_add', playlistId: 'road', ref: 'saavn:abc' }));
    expect(mockBump).toHaveBeenCalled();
    expect(mockFetchPlaylists).toHaveBeenCalled();
  });

  it('says so, and changes nothing, when the song is already in the playlist', async () => {
    mockGetOnline.mockResolvedValue([{ ref: 'saavn:abc', title: 'Kesariya', duration: 1, at: 1 }]);
    expect(await addOnlineSongToPlaylist('road', song)).toBe('exists');
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it('likes the song for Liked songs, and never un-likes one that is liked', async () => {
    mockToggleLike.mockResolvedValue('liked');
    expect(await addOnlineSongToPlaylist('liked', song)).toBe('added');
    expect(mockToggleLike).toHaveBeenCalledWith(song);
    likedRefs = new Set(['saavn:abc']);
    mockToggleLike.mockClear();
    expect(await addOnlineSongToPlaylist('liked', song)).toBe('exists');
    expect(mockToggleLike).not.toHaveBeenCalled();
  });

  it('reports a failure instead of throwing', async () => {
    mockUpsert.mockRejectedValue(new Error('disk full'));
    expect(await addOnlineSongToPlaylist('road', song)).toBe('error');
    expect(mockRecord).not.toHaveBeenCalled();
  });
});
