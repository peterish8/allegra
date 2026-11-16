const mockGetOnline = jest.fn();
const mockUpsert = jest.fn();
const mockRemoveOnline = jest.fn();
const mockRecord = jest.fn();
const mockToggleLike = jest.fn();
const mockFetchPlaylists = jest.fn(async () => undefined);
const mockBump = jest.fn();
const mockReconcileQueue = jest.fn();
let likedRefs = new Set<string>();

jest.mock('../../database/syncQueries', () => ({
  getOnlinePlaylistSongs: (...args: unknown[]) => mockGetOnline(...args),
  upsertOnlinePlaylistSong: (...args: unknown[]) => mockUpsert(...args),
  removeOnlinePlaylistSong: (...args: unknown[]) => mockRemoveOnline(...args),
}));
jest.mock('./LibrarySync', () => ({ record: (...args: unknown[]) => mockRecord(...args) }));
jest.mock('./onlineLike', () => ({ toggleOnlineLike: (...args: unknown[]) => mockToggleLike(...args) }));
jest.mock('../../store/onlineLibraryStore', () => ({
  useOnlineLibraryStore: { getState: () => ({ likedRefs, bumpPlaylists: mockBump }) },
}));
jest.mock('../../store/playlistStore', () => ({
  usePlaylistStore: { getState: () => ({ defaultPlaylistId: 'liked', fetchPlaylists: mockFetchPlaylists }) },
  reconcileRemovedPlaylistSong: (...args: unknown[]) => mockReconcileQueue(...args),
}));

import type { SongRef, SongSnapshot } from '@shared/songRef';
import { addOnlineSongToPlaylist, removeOnlineSongFromPlaylist } from './onlinePlaylist';

const song: SongSnapshot = { ref: 'saavn:abc' as SongRef, title: 'Kesariya', artist: 'Arijit Singh', artwork: 'https://img.example/a.jpg', duration: 268 };

beforeEach(() => {
  jest.clearAllMocks();
  likedRefs = new Set();
  mockGetOnline.mockResolvedValue([]);
  mockUpsert.mockResolvedValue(undefined);
  mockRemoveOnline.mockResolvedValue(undefined);
});

describe('removeOnlineSongFromPlaylist', () => {
  it('removes the online row, records sync, and refreshes playlist counts and covers', async () => {
    mockGetOnline.mockResolvedValue([{ ref: 'saavn:abc', title: 'Kesariya', duration: 268, at: 1 }]);
    await expect(removeOnlineSongFromPlaylist('road', song.ref)).resolves.toBe(true);

    expect(mockRemoveOnline).toHaveBeenCalledWith('road', song.ref);
    expect(mockReconcileQueue).toHaveBeenCalledWith('road', 'stream:saavn:abc');
    expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({ op: 'playlist_remove', playlistId: 'road', ref: song.ref }));
    expect(mockBump).toHaveBeenCalled();
    expect(mockFetchPlaylists).toHaveBeenCalled();
  });

  it('does nothing when the online row has already been removed', async () => {
    mockGetOnline.mockResolvedValue([]);
    await expect(removeOnlineSongFromPlaylist('road', song.ref)).resolves.toBe(false);
    expect(mockRemoveOnline).not.toHaveBeenCalled();
    expect(mockReconcileQueue).toHaveBeenCalledWith('road', 'stream:saavn:abc');
    expect(mockRecord).not.toHaveBeenCalled();
    expect(mockFetchPlaylists).toHaveBeenCalled();
  });

  it('leaves the active queue intact when the online row cannot be removed', async () => {
    mockGetOnline.mockResolvedValue([{ ref: 'saavn:abc', title: 'Kesariya', duration: 268, at: 1 }]);
    mockRemoveOnline.mockRejectedValue(new Error('disk unavailable'));

    await expect(removeOnlineSongFromPlaylist('road', song.ref)).rejects.toThrow('disk unavailable');

    expect(mockReconcileQueue).not.toHaveBeenCalled();
    expect(mockRecord).not.toHaveBeenCalled();
    expect(mockFetchPlaylists).not.toHaveBeenCalled();
  });
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
