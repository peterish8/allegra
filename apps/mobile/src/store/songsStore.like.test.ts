const mockLikedSongIds = new Set<string>();
const mockLikedRefs = new Set<string>();
const mockToggleLocalMembership = jest.fn(async (songId: string) => {
  if (mockLikedSongIds.has(songId)) mockLikedSongIds.delete(songId);
  else mockLikedSongIds.add(songId);
});
const mockToggleOnlineLike = jest.fn();

jest.mock('../database/queries', () => ({}));
jest.mock('./dailyStatsStore', () => ({}));
jest.mock('../services/NativeSearch', () => ({ nativeSearch: jest.fn() }));
jest.mock('./songsReconcile', () => ({ reconcileSongs: jest.fn() }));
jest.mock('./playlistStore', () => ({
  usePlaylistStore: { getState: () => ({
    likedSongIds: mockLikedSongIds,
    toggleLiked: (...args: unknown[]) => mockToggleLocalMembership(...args as [string]),
  }) },
}));
jest.mock('./onlineLibraryStore', () => ({ useOnlineLibraryStore: { getState: () => ({ likedRefs: mockLikedRefs }) } }));
jest.mock('../services/sync/onlineLike', () => ({ toggleOnlineLike: (...args: unknown[]) => mockToggleOnlineLike(...args) }));
jest.mock('./playerStore', () => ({ usePlayerStore: { getState: () => ({ currentSong: null }) } }));

import type { Song } from '../types/song';
import { useSongsStore } from './songsStore';

const downloadedSong: Song = {
  id: 'file-song', title: 'Song', artist: 'Artist', duration: 120, originId: 'saavn:canonical-1',
  gradientId: '0', dateCreated: '', dateModified: '', playCount: 0, lyrics: [],
};

beforeEach(() => {
  mockLikedSongIds.clear();
  mockLikedRefs.clear();
  mockToggleLocalMembership.mockClear();
  mockToggleOnlineLike.mockReset();
  useSongsStore.setState({ songs: [downloadedSong] });
  mockToggleOnlineLike.mockImplementation(async () => {
    mockLikedRefs.delete('saavn:canonical-1');
    return 'unliked';
  });
});

test('unliking a downloaded song removes its canonical account like without adding a phone like', async () => {
  mockLikedRefs.add('saavn:canonical-1');

  await expect(useSongsStore.getState().toggleLike(downloadedSong.id)).resolves.toBe('unliked');

  expect(mockToggleOnlineLike).toHaveBeenCalledWith(expect.objectContaining({ ref: 'saavn:canonical-1' }));
  expect(mockToggleLocalMembership).not.toHaveBeenCalled();
  expect(mockLikedSongIds.has(downloadedSong.id)).toBe(false);
});

test('unliking a downloaded song clears both account and phone likes when both are present', async () => {
  mockLikedRefs.add('saavn:canonical-1');
  mockLikedSongIds.add(downloadedSong.id);

  await expect(useSongsStore.getState().toggleLike(downloadedSong.id)).resolves.toBe('unliked');

  expect(mockLikedRefs.has('saavn:canonical-1')).toBe(false);
  expect(mockLikedSongIds.has(downloadedSong.id)).toBe(false);
  expect(mockToggleLocalMembership).toHaveBeenCalledWith(downloadedSong.id);
});

test('keeps the phone like when removing the canonical account like fails', async () => {
  mockLikedRefs.add('saavn:canonical-1');
  mockLikedSongIds.add(downloadedSong.id);
  mockToggleOnlineLike.mockResolvedValue('error');

  await expect(useSongsStore.getState().toggleLike(downloadedSong.id)).resolves.toBe('error');

  expect(mockLikedSongIds.has(downloadedSong.id)).toBe(true);
  expect(mockToggleLocalMembership).not.toHaveBeenCalled();
});
