import type { UnifiedSong } from '../../types/song';
const mockPlaylist = jest.fn();
const mockSong = jest.fn();
jest.mock('./shareService', () => ({
  fetchSharedPlaylist: (...a: unknown[]) => mockPlaylist(...a),
  fetchSharedSong: (...a: unknown[]) => mockSong(...a),
}));
import { resolveScanned, resultCover, resultSubtitle, resultTitle } from './scanResolve';

const song = { id: 'abc', title: 'Cardigan', artist: 'Taylor Swift', highResArt: 'https://img/a.jpg', thumbnail: '' } as unknown as UnifiedSong;
const playlist = { code: 'ABCD2345', name: 'Road trip', ownerName: 'Mira', coverUrl: null, songs: [song, song] };
beforeEach(() => jest.clearAllMocks());

test('a playlist code resolves to the playlist', async () => {
  mockPlaylist.mockResolvedValue(playlist);
  const out = await resolveScanned({ kind: 'playlist', code: 'ABCD2345' });
  expect(out).toEqual({ ok: true, result: { kind: 'playlist', playlist, code: 'ABCD2345' } });
});
test('a song code resolves through its Saavn id', async () => {
  mockSong.mockResolvedValue(song);
  const out = await resolveScanned({ kind: 'song', source: 'saavn', id: 'abc' });
  expect(mockSong).toHaveBeenCalledWith('saavn:abc');
  expect(out.ok && out.result.kind).toBe('song');
});
test('a code nothing answers to is gone', async () => {
  mockPlaylist.mockResolvedValue(null);
  expect(await resolveScanned({ kind: 'playlist', code: 'ABCD2345' })).toEqual({ ok: false, failure: 'gone' });
});
test('a lookup that throws is unreachable, not a crash', async () => {
  mockSong.mockRejectedValue(new Error('offline'));
  expect(await resolveScanned({ kind: 'song', source: 'saavn', id: 'abc' })).toEqual({ ok: false, failure: 'unreachable' });
});
test('the card words come from the result', () => {
  const result = { kind: 'playlist' as const, playlist, code: 'ABCD2345' };
  expect(resultTitle(result)).toBe('Road trip');
  expect(resultSubtitle(result)).toBe('By Mira · 2 songs');
  expect(resultCover(result)).toBe('https://img/a.jpg');
  expect(resultSubtitle({ kind: 'song', song })).toBe('Taylor Swift');
});
