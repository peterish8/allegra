import { resolveSongAlbum } from './songAlbum';

const song = jest.fn();
const search = jest.fn();
beforeEach(() => { song.mockReset(); search.mockReset(); });
it('opens the actual recording release without guessing from its song title', async () => {
  song.mockResolvedValue({ albumId: 'original', album: 'Baththa', artist: 'Sai' });
  expect(await resolveSongAlbum({ songRef: 'saavn:track' }, { song, search })).toBe('original');
  expect(search).not.toHaveBeenCalled();
});
it('uses a known album id without a second request', async () => {
  expect(await resolveSongAlbum({ id: 'release' }, { song, search })).toBe('release');
  expect(song).not.toHaveBeenCalled();
});
it('does not open a different artist’s album with the same title', async () => {
  search.mockResolvedValue([{ id: 'wrong', name: 'Same name', artist: 'Someone else' }]);
  expect(await resolveSongAlbum({ album: 'Same name', artist: 'Requested artist' }, { song, search })).toBeNull();
});
it('uses an unambiguous exact album and artist match for an older download', async () => {
  search.mockResolvedValue([{ id: 'right', name: ' Album ', artist: 'Artist' }]);
  expect(await resolveSongAlbum({ album: 'album', artist: 'artist' }, { song, search })).toBe('right');
});
it('does not mistake missing album metadata for an artist navigation request', async () => {
  expect(await resolveSongAlbum({ artist: 'Artist' }, { song, search })).toBeNull();
  expect(search).not.toHaveBeenCalled();
});
