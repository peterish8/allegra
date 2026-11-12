jest.mock('../../utils/navigationService', () => ({ navigationRef: { navigate: jest.fn() }, openMainTab: jest.fn() }));
jest.mock('../stream/officialSearch', () => ({ searchOfficial: jest.fn() }));
jest.mock('../stream/StreamService', () => ({ StreamService: { play: jest.fn() } }));
jest.mock('../../store/playerStore', () => ({ usePlayerStore: { getState: () => ({ currentSongId: null }) } }));
jest.mock('./shareService', () => ({ fetchSharedPlaylist: jest.fn(), fetchSharedSong: jest.fn() }));

import type { ShareTarget } from '@shared/shareLinks';
import { searchOfficial } from '../stream/officialSearch';
import { checkShareTarget } from './openShare';
import { fetchSharedPlaylist, fetchSharedSong } from './shareService';

const playlist: ShareTarget = { kind: 'playlist', code: 'k7mq2xaz' };
const song = (over: Partial<Extract<ShareTarget, { kind: 'song' }>> = {}): ShareTarget => ({ kind: 'song', ref: null, title: '', artist: '', ...over } as ShareTarget);

describe('checkShareTarget (the scanner asks before it leaves)', () => {
  beforeEach(() => jest.resetAllMocks());

  it('is ok for a playlist the server knows, gone for one it does not, unreachable when the network fails', async () => {
    (fetchSharedPlaylist as jest.Mock).mockResolvedValueOnce({ name: 'x' });
    expect(await checkShareTarget(playlist)).toBe('ok');
    (fetchSharedPlaylist as jest.Mock).mockResolvedValueOnce(null);
    expect(await checkShareTarget(playlist)).toBe('gone');
    (fetchSharedPlaylist as jest.Mock).mockRejectedValueOnce(new Error('offline'));
    expect(await checkShareTarget(playlist)).toBe('unreachable');
  });

  it('finds a song by its id, else by title and artist, else says it is gone', async () => {
    (fetchSharedSong as jest.Mock).mockResolvedValueOnce({ id: 's' });
    expect(await checkShareTarget(song({ ref: { source: 'saavn', id: 'abc' } } as never))).toBe('ok');
    (fetchSharedSong as jest.Mock).mockResolvedValueOnce(null);
    (searchOfficial as jest.Mock).mockResolvedValueOnce([{ id: 'x' }]);
    expect(await checkShareTarget(song({ ref: { source: 'saavn', id: 'abc' }, title: 'T', artist: 'A' } as never))).toBe('ok');
    (searchOfficial as jest.Mock).mockResolvedValueOnce([]);
    expect(await checkShareTarget(song({ title: 'T', artist: 'A' }))).toBe('gone');
    expect(await checkShareTarget(song())).toBe('gone');
  });
});
