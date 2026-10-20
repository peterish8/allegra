jest.mock('../../playback/positionBus', () => ({ positionSV: { value: 0 } }));
jest.mock('../NativeAudioPlayer', () => ({ NativeAudioPlayer: { isAvailable: () => false, hasQueue: () => false } }));
jest.mock('../../database/queries', () => ({ getSongById: jest.fn().mockResolvedValue(null) }));
jest.mock('../../store/songsStore', () => ({ useSongsStore: { getState: () => ({ songs: [], setCurrentSong: jest.fn() }) } }));
jest.mock('../../store/settingsStore', () => ({ useSettingsStore: { getState: () => ({ updatePlaylistHistory: jest.fn() }) } }));

import { lyricaService } from '../LyricaService';
import { usePlayerStore } from '../../store/playerStore';
import { Song } from '../../types/song';
import { upgradeToSynced } from './syncedUpgrade';

const plainLines = [{ timestamp: 0, text: 'Uyire uyire', lineOrder: 0 }];
const song = (id: string, extra: Partial<Song> = {}): Song =>
  ({ id, title: 'Mozhiye', artist: 'Sai Abhyankkar', audioUri: `https://a/${id}`, lyrics: plainLines, lyricSource: 'JioSaavn', duration: 232, ...extra }) as Song;
const target = { id: 'stream:saavn:a', title: 'Mozhiye', artist: 'Sai Abhyankkar', duration: 232, ref: 'saavn:a' };

afterEach(() => jest.restoreAllMocks());

it('swaps plain lyrics for synced ones on the playing song and its queue row', async () => {
  const fetch = jest.spyOn(lyricaService, 'fetchLyrics').mockResolvedValue({ lyrics: '[00:01.00] Uyire uyire\n[00:04.00] Thaene mozhiye', source: 'LrcLib' });
  const playing = song(target.id);
  usePlayerStore.setState({ currentSong: playing, currentSongId: playing.id, playlistQueue: [playing], currentQueueIndex: 0 });

  await expect(upgradeToSynced(target, 'JioSaavn')).resolves.toBe(true);
  expect(fetch).toHaveBeenCalledWith('Mozhiye', 'Sai Abhyankkar', true, 232, { ref: 'saavn:a' });
  const state = usePlayerStore.getState();
  expect(state.currentSong?.lyricSource).toBe('LrcLib');
  expect(state.currentSong?.lyrics.map(l => l.timestamp)).toEqual([1, 4]);
  expect(state.playlistQueue?.[0].lyricSource).toBe('LrcLib');
});

it('keeps lyrics the listener picked while the search ran', async () => {
  jest.spyOn(lyricaService, 'fetchLyrics').mockResolvedValue({ lyrics: '[00:01.00] Uyire', source: 'LrcLib' });
  const picked = song(target.id, { lyricSource: 'Allegra · English' });
  usePlayerStore.setState({ currentSong: picked, currentSongId: picked.id, playlistQueue: null });

  await expect(upgradeToSynced(target, 'JioSaavn')).resolves.toBe(false);
  expect(usePlayerStore.getState().currentSong?.lyricSource).toBe('Allegra · English');
});

it('leaves plain lyrics alone when nothing synced turns up or the search fails', async () => {
  const playing = song(target.id);
  usePlayerStore.setState({ currentSong: playing, currentSongId: playing.id, playlistQueue: null });
  jest.spyOn(lyricaService, 'fetchLyrics').mockResolvedValueOnce({ lyrics: 'plain only', source: 'Lyrica' }).mockRejectedValueOnce(new Error('timed out'));

  await expect(upgradeToSynced(target, 'JioSaavn')).resolves.toBe(false);
  await expect(upgradeToSynced(target, 'JioSaavn')).resolves.toBe(false);
  expect(usePlayerStore.getState().currentSong?.lyrics).toBe(plainLines);
});
