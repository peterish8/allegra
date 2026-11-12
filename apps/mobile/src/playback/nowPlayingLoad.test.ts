// Opening the player must never change play or pause. Real store, real load guard; only the database and the
// native module are stood in for, so the module graph loads under testEnvironment: 'node'.
jest.mock('../database/queries', () => ({
  getSongById: jest.fn().mockResolvedValue(null),
}));
jest.mock('../store/songsStore', () => ({
  useSongsStore: { getState: () => ({ songs: [], setCurrentSong: jest.fn() }) },
}));
jest.mock('../store/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ updatePlaylistHistory: jest.fn() }) },
}));
jest.mock('../services/NativeAudioPlayer', () => ({
  NativeAudioPlayer: { isAvailable: () => false, hasQueue: () => false },
}));

import { beginAudioLoad, endAudioLoad, playerControls, resumeNextLoadAt, setNativeOwnsPlaybackState, usePlayerStore } from '../store/playerStore';
import type { Song } from '../types/song';
import { loadForNowPlaying } from './nowPlayingLoad';

const song = (id: string): Song => ({ id, title: id, artist: 'a', audioUri: `file:///${id}.mp3`, lyrics: [] }) as unknown as Song;
const a = song('a');
const b = song('b');

let commands: string[];
let replaced: string[];
const player = { replace: jest.fn(async (_uri: string, s?: Song) => { replaced.push(s?.id ?? '?'); }) };
const fetchNothing = jest.fn(async () => null);

const open = (songId: string, over: Partial<Parameters<typeof loadForNowPlaying>[0]> = {}) =>
  loadForNowPlaying({
    songId,
    currentSong: usePlayerStore.getState().currentSong,
    loadedAudioId: usePlayerStore.getState().loadedAudioId,
    player,
    fetchSong: fetchNothing,
    ...over,
  });

beforeEach(() => {
  commands = [];
  replaced = [];
  player.replace.mockClear();
  fetchNothing.mockClear();
  playerControls.play = () => { commands.push('play'); };
  playerControls.pause = () => { commands.push('pause'); };
  playerControls.seekTo = async (at: number) => { commands.push(`seek ${at}`); };
  setNativeOwnsPlaybackState(true);
  // Clears the module's "waits for a tap" intent from the test before.
  usePlayerStore.getState().reset();
  usePlayerStore.setState({
    currentSong: a,
    currentSongId: 'a',
    loadedAudioId: 'a',
    playlistQueue: [a, b],
    currentQueueIndex: 0,
    currentPlaylistId: 'library',
    isPlaying: false,
    playbackError: null,
  });
});

afterEach(() => {
  setNativeOwnsPlaybackState(false);
  endAudioLoad('a');
  endAudioLoad('b');
});

describe('opening Now Playing on a song that is already loaded', () => {
  it('leaves a paused song paused: no play, no pause, no load', async () => {
    const result = await open('a');
    expect(result.kind).toBe('ready');
    expect(commands).toEqual([]);
    expect(player.replace).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().isPlaying).toBe(false);
  });

  it('leaves a playing song playing', async () => {
    usePlayerStore.setState({ isPlaying: true });
    await open('a');
    expect(commands).toEqual([]);
    expect(usePlayerStore.getState().isPlaying).toBe(true);
  });

  it('does it again when the effect re-runs (lyrics landed, the song object changed)', async () => {
    await open('a');
    await open('a', { currentSong: { ...a, lyrics: [{ timestamp: 0, text: 'hi', lineOrder: 0 }] } as Song });
    await open('a');
    expect(commands).toEqual([]);
  });

  it('does not touch a song that was handed over paused by Connect either', async () => {
    usePlayerStore.setState({ currentSong: b, currentSongId: 'b', loadedAudioId: 'b' });
    usePlayerStore.getState().setPlaylistQueue('connect', [b], 0, false);
    usePlayerStore.setState({ loadedAudioId: 'b' });
    commands.length = 0;
    await open('b');
    expect(commands).toEqual([]);
  });
});

describe('opening Now Playing when there is nothing to load', () => {
  it('with no song at all, finds no audio and starts nothing', async () => {
    usePlayerStore.setState({ currentSong: null, currentSongId: null, loadedAudioId: null });
    const result = await open('a');
    expect(result.kind).toBe('no-audio');
    expect(fetchNothing).toHaveBeenCalledWith('a');
    expect(commands).toEqual([]);
    expect(player.replace).not.toHaveBeenCalled();
  });

  it('for a song with no audio address anywhere, says so and starts nothing', async () => {
    const mute = { ...a, audioUri: '' } as Song;
    usePlayerStore.setState({ currentSong: mute });
    const result = await open('a', { currentSong: mute, loadedAudioId: null, fetchSong: async () => mute });
    expect(result.kind).toBe('no-audio');
    expect(commands).toEqual([]);
  });

  it('for a route whose song is not the one in the player, leaves both alone', async () => {
    usePlayerStore.setState({ currentSong: b, currentSongId: 'b', loadedAudioId: 'b' });
    const result = await open('a');
    expect(result.kind).toBe('other-song');
    expect(commands).toEqual([]);
    expect(player.replace).not.toHaveBeenCalled();
  });

  it('after switching song while paused, the old route neither plays nor pauses the new song', async () => {
    usePlayerStore.setState({ currentSong: b, currentSongId: 'b', loadedAudioId: null, currentQueueIndex: 1 });
    const result = await open('a');
    expect(result.kind).toBe('other-song');
    expect(commands).toEqual([]);
    expect(usePlayerStore.getState().isPlaying).toBe(false);
  });
});

describe('when Now Playing really loads the song', () => {
  it('loads it, keeps the queue, and plays it (a song the listener picked plays)', async () => {
    usePlayerStore.setState({ loadedAudioId: null });
    const result = await open('a');
    expect(result.kind).toBe('ready');
    expect(replaced).toEqual(['a']);
    expect(usePlayerStore.getState().loadedAudioId).toBe('a');
    expect(commands).toEqual(['play']);
  });

  it('waits for a tap when the song is the one restored at launch', async () => {
    usePlayerStore.getState().setInitialSong(a);
    usePlayerStore.setState({ loadedAudioId: null });
    await open('a');
    expect(replaced).toEqual(['a']);
    expect(commands).toEqual(['pause']);
    // Once only: the next load of that song plays.
    usePlayerStore.setState({ loadedAudioId: null });
    commands.length = 0;
    await open('a');
    expect(commands).toEqual(['play']);
  });

  it('waits for a tap when the song was handed over paused', async () => {
    usePlayerStore.getState().setPlaylistQueue('connect', [a], 0, false);
    usePlayerStore.setState({ loadedAudioId: null });
    commands.length = 0;
    await open('a');
    expect(commands).toEqual(['pause']);
  });

  it('carries on from where a recovery reload stopped, then plays', async () => {
    usePlayerStore.setState({ loadedAudioId: null });
    resumeNextLoadAt('a', 41);
    await open('a');
    expect(commands).toEqual(['seek 41', 'play']);
  });

  it('lets the mini player keep a load it already holds (one load, not two)', async () => {
    usePlayerStore.setState({ loadedAudioId: null });
    expect(beginAudioLoad('a')).toBe(true);
    const result = await open('a');
    expect(result.kind).toBe('not-ours');
    expect(player.replace).not.toHaveBeenCalled();
    expect(commands).toEqual([]);
  });

  it('gives up without starting anything when another song took over while it loaded', async () => {
    usePlayerStore.setState({ loadedAudioId: null });
    player.replace.mockImplementationOnce(async () => {
      usePlayerStore.setState({ currentSong: b, currentSongId: 'b' });
    });
    const result = await open('a');
    expect(result.kind).toBe('not-ours');
    expect(usePlayerStore.getState().loadedAudioId).toBeNull();
    expect(commands).toEqual([]);
    // The guard was released, so the song can be loaded again later.
    expect(beginAudioLoad('a')).toBe(true);
  });

  it('releases the load guard when the load fails', async () => {
    usePlayerStore.setState({ loadedAudioId: null });
    player.replace.mockRejectedValueOnce(new Error('no service'));
    await expect(open('a')).rejects.toThrow('no service');
    expect(beginAudioLoad('a')).toBe(true);
  });
});
