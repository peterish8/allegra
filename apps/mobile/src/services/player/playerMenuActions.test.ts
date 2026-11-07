jest.mock('../../playback/positionBus', () => ({ positionSV: { value: 0 } }));
jest.mock('react-native', () => ({ Share: { share: jest.fn(async () => ({})) } }));
jest.mock('../../database/queries', () => ({ getSongById: jest.fn().mockResolvedValue(null) }));
jest.mock('../../store/songsStore', () => ({ useSongsStore: { getState: () => ({ songs: [], setCurrentSong: jest.fn() }) } }));
jest.mock('../../store/settingsStore', () => ({ useSettingsStore: { getState: () => ({ updatePlaylistHistory: jest.fn() }) } }));
jest.mock('../NativeAudioPlayer', () => ({
  NativeAudioPlayer: {
    isAvailable: () => true,
    hasQueue: () => false,
    setRingtone: jest.fn(async () => 'permission'),
  },
}));
jest.mock('../stream/StreamService', () => ({ StreamService: { catalogFor: () => undefined } }));
jest.mock('../stream/recommend', () => ({ defaultDeps: {}, findSeedVideoId: jest.fn(async () => 'yt123') }));

import { Share } from 'react-native';
import { usePlayerStore } from '../../store/playerStore';
import { Song } from '../../types/song';
import { canSetRingtone, setAsRingtone, shareSong, shuffleUpcoming } from './playerMenuActions';

const song = (id: string, extra: Partial<Song> = {}): Song =>
  ({ id, title: `Song ${id}`, artist: 'Artist', audioUri: `file:///${id}.mp3`, lyrics: [], duration: 200, ...extra }) as Song;

describe('player menu actions', () => {
  it('shuffles only what plays next and restages the next song', () => {
    const queue = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(id => song(id));
    usePlayerStore.setState({ playlistQueue: queue, currentQueueIndex: 2, currentSong: queue[2], currentSongId: 'c' });

    expect(shuffleUpcoming()).toBe(5);
    const after = usePlayerStore.getState().playlistQueue!.map(s => s.id);
    expect(after.slice(0, 3)).toEqual(['a', 'b', 'c']);
    expect([...after.slice(3)].sort()).toEqual(['d', 'e', 'f', 'g', 'h']);
    expect(usePlayerStore.getState().currentQueueIndex).toBe(2);
  });

  it('does nothing without at least two songs to reorder', () => {
    usePlayerStore.setState({ playlistQueue: [song('a'), song('b')], currentQueueIndex: 0, currentSongId: 'a' });
    expect(shuffleUpcoming()).toBe(0);
  });

  // 1.44.0: our own link, which opens LuvLyrics where it is installed and the website elsewhere.
  it('shares the song’s LuvLyrics link: its catalog id when it has one, else its name', async () => {
    await shareSong(song('stream:saavn:B4-hLCKJ', { title: 'cardigan', artist: 'Taylor Swift' }));
    expect(Share.share).toHaveBeenLastCalledWith({ message: 'cardigan — Taylor Swift\nhttps://allegravibe.vercel.app/song/saavn/B4-hLCKJ?t=cardigan&a=Taylor%20Swift' });
    await shareSong(song('x', { title: 'cardigan', artist: 'Taylor Swift', originId: 'saavn:abc' }));
    expect(Share.share).toHaveBeenLastCalledWith({ message: 'cardigan — Taylor Swift\nhttps://allegravibe.vercel.app/song/saavn/abc?t=cardigan&a=Taylor%20Swift' });
    await shareSong(song('x', { title: 'cardigan', artist: 'Taylor Swift' }));
    expect(Share.share).toHaveBeenLastCalledWith({ message: 'cardigan — Taylor Swift\nhttps://allegravibe.vercel.app/song/find?t=cardigan&a=Taylor%20Swift' });
  });

  it('offers ringtones only for songs saved on the phone', async () => {
    expect(canSetRingtone(song('local'))).toBe(true);
    expect(canSetRingtone(song('stream:Saavn:1', { audioUri: 'https://cdn/x.mp4' }))).toBe(false);
    expect(await setAsRingtone(song('local'))).toMatch(/modify system settings/);
  });
});
