const mockRemoveDatabaseMembership = jest.fn(async (..._args: unknown[]) => undefined);
const mockRemoveFromQueue = jest.fn();
let mockCurrentPlaylistId: string | null = null;

jest.mock('../database/playlistQueries', () => ({ removeSongFromPlaylist: (...args: unknown[]) => mockRemoveDatabaseMembership(...args) }));
jest.mock('../database/queries', () => ({}));
jest.mock('./playerStore', () => ({ usePlayerStore: { getState: () => ({ currentPlaylistId: mockCurrentPlaylistId, removeFromQueue: mockRemoveFromQueue }) } }));
jest.mock('../services/sync/recordLocal', () => ({ recordMembership: jest.fn(), recordPlaylistChange: jest.fn(), recordPlaylistDelete: jest.fn() }));

import { usePlaylistStore } from './playlistStore';

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentPlaylistId = 'active-list';
  usePlaylistStore.setState({
    playlists: [{ id: 'active-list', name: 'Mix', isDefault: false, sortOrder: 0, dateCreated: '', dateModified: '', songCount: 2 }],
    likedSongIds: new Set(), defaultPlaylistId: 'liked',
  });
});

test('removing a song from the active playlist removes it from the playback queue', async () => {
  await usePlaylistStore.getState().removeSongFromPlaylist('active-list', 'song-1');

  expect(mockRemoveFromQueue).toHaveBeenCalledWith('song-1');
  expect(usePlaylistStore.getState().playlists[0]?.songCount).toBe(1);
});

test('removing a song from another playlist leaves the active playback queue alone', async () => {
  mockCurrentPlaylistId = 'different-list';

  await usePlaylistStore.getState().removeSongFromPlaylist('active-list', 'song-1');

  expect(mockRemoveFromQueue).not.toHaveBeenCalled();
});
