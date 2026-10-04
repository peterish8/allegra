// Android with the Kotlin queue engine: `playerStore` forwards every queue command and mirrors what the engine
// reports. The JavaScript-owned queue (iPhone) is covered in playerStore.test.ts.
const mockLibrary: Array<Record<string, unknown>> = [];
jest.mock('../database/queries', () => ({
  getSongById: jest.fn().mockResolvedValue(null),
}));
jest.mock('./songsStore', () => ({
  useSongsStore: { getState: () => ({ songs: mockLibrary, setCurrentSong: jest.fn() }) },
}));
jest.mock('./settingsStore', () => ({
  useSettingsStore: { getState: () => ({ updatePlaylistHistory: jest.fn() }) },
}));
let mockBusy = false;
const mockIdleWaiters: Array<() => void> = [];
jest.mock('../services/NativeAudioPlayer', () => ({
  isQueueBusy: () => mockBusy,
  whenQueueIdle: (fn: () => void) => { if (!mockBusy) fn(); else mockIdleWaiters.push(fn); },
  NativeAudioPlayer: {
    isAvailable: () => true,
    hasQueue: () => true,
    setQueue: jest.fn(async () => true),
    replaceQueue: jest.fn(async () => true),
    playNext: jest.fn(async () => true),
    addToQueue: jest.fn(async () => true),
    removeFromQueue: jest.fn(async () => true),
    clearQueue: jest.fn(async () => true),
    skipToNext: jest.fn(async () => true),
    skipToPrevious: jest.fn(async () => true),
    skipToIndex: jest.fn(async () => true),
    setShuffle: jest.fn(async () => true),
    setRepeatMode: jest.fn(async () => true),
    getQueueState: jest.fn(async () => null),
    hasSavedQueue: jest.fn(() => false),
    restoreQueue: jest.fn(async () => null),
    load: jest.fn(async () => undefined),
    setRepeatOne: jest.fn(),
    setPlaybackParameters: jest.fn(),
  },
}));

import { NativeAudioPlayer } from '../services/NativeAudioPlayer';
import { usePlayerStore, playerControls, setNativeOwnsPlaybackState, beginAudioLoad, endAudioLoad } from './playerStore';
import { usePlaybackModesStore } from './playbackModesStore';
import { forgetEngineQueue, noteEngineQueue, onQueueLow } from '../playback/nativeQueue';
import type { Song } from '../types/song';

const native = NativeAudioPlayer as unknown as Record<string, jest.Mock>;
const song = (id: string): Song =>
  ({ id, title: id, artist: 'a', audioUri: `file:///${id}.mp3`, lyrics: [] }) as unknown as Song;
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const ids = (songs: readonly Song[] | null) => (songs ?? []).map(s => s.id);

const queue = ['a', 'b', 'c', 'd'].map(song);
const settle = () => {
  mockBusy = false;
  mockIdleWaiters.splice(0).forEach(fn => fn());
};

beforeEach(() => {
  for (const fn of Object.values(native)) if (typeof fn.mockClear === 'function') fn.mockClear();
  native.getQueueState.mockResolvedValue(null);
  native.hasSavedQueue.mockReturnValue(false);
  native.restoreQueue.mockResolvedValue(null);
  mockBusy = false;
  mockIdleWaiters.length = 0;
  mockLibrary.length = 0;
  setNativeOwnsPlaybackState(true);
  playerControls.getPosition = () => 0;
  playerControls.play = jest.fn();
  playerControls.pause = jest.fn();
  forgetEngineQueue();
  usePlaybackModesStore.setState({ shuffle: false, repeatMode: 'all', repeatOne: false });
  usePlayerStore.setState({
    playlistQueue: queue,
    currentQueueIndex: 0,
    currentSong: queue[0],
    currentSongId: 'a',
    loadedAudioId: 'a',
    currentPlaylistId: 'library',
    isPlaying: true,
  });
  noteEngineQueue({ ids: ids(queue), tag: 'library#1' });
});

afterEach(() => setNativeOwnsPlaybackState(false));

describe('starting a queue', () => {
  it('hands the engine the whole queue and starts the tapped song', async () => {
    usePlayerStore.getState().setPlaylistQueue('library', queue, 2, true);
    await flush();
    const [items, start, position, play, tag] = native.setQueue.mock.calls[0];
    expect(items.map((i: { id: string }) => i.id)).toEqual(['a', 'b', 'c', 'd']);
    expect([start, position, play]).toEqual([2, 0, true]);
    expect(tag).toMatch(/^library#\d+$/);
    expect(usePlayerStore.getState().currentSongId).toBe('c');
  });

  it('holds the load guard until the engine has the queue, and only then calls the song loaded', async () => {
    let answer: (ok: boolean) => void = () => undefined;
    native.setQueue.mockReturnValueOnce(new Promise<boolean>(r => { answer = r; }));
    usePlayerStore.getState().setPlaylistQueue('library', queue, 2, true);

    // While it is in flight nothing else may load the song (a load would replace the queue with one song).
    expect(usePlayerStore.getState().loadedAudioId).not.toBe('c');
    expect(beginAudioLoad('c')).toBe(false);

    answer(true);
    await flush();
    expect(usePlayerStore.getState().loadedAudioId).toBe('c');
    expect(beginAudioLoad('c')).toBe(true);
    endAudioLoad('c');
  });

  it('plays the one song the old way when the engine does not take the queue, so a tap is never dead', async () => {
    native.setQueue.mockResolvedValueOnce(false);
    usePlayerStore.getState().setPlaylistQueue('library', queue, 1, true);
    await flush();
    expect(native.load).toHaveBeenCalledWith('file:///b.mp3', expect.objectContaining({ mediaId: 'b' }));
    expect(usePlayerStore.getState().loadedAudioId).toBe('b');
  });

  it('does not mark a song loaded if another one was picked meanwhile', async () => {
    let answer: (ok: boolean) => void = () => undefined;
    native.setQueue.mockReturnValueOnce(new Promise<boolean>(r => { answer = r; }));
    usePlayerStore.getState().setPlaylistQueue('library', queue, 1, true);
    usePlayerStore.setState({ currentSongId: 'd', currentSong: queue[3] });
    answer(true);
    await flush();
    expect(usePlayerStore.getState().loadedAudioId).not.toBe('b');
  });
});

describe('next and previous', () => {
  it('next moves the screen at once, asks the engine, and never touches the play state itself', async () => {
    usePlayerStore.setState({ isPlaying: false });
    await usePlayerStore.getState().nextInPlaylist();
    const s = usePlayerStore.getState();
    expect(s.currentSongId).toBe('b');
    expect(s.currentQueueIndex).toBe(1);
    expect(s.loadedAudioId).toBe('b');
    expect(s.isPlaying).toBe(false);
    expect(native.skipToNext).toHaveBeenCalledTimes(1);
  });

  it('next wraps to the first song at the end', async () => {
    usePlayerStore.setState({ currentQueueIndex: 3, currentSong: queue[3], currentSongId: 'd', loadedAudioId: 'd' });
    await usePlayerStore.getState().nextInPlaylist();
    expect(usePlayerStore.getState().currentSongId).toBe('a');
  });

  it('two quick taps move two songs on', async () => {
    await Promise.all([usePlayerStore.getState().nextInPlaylist(), usePlayerStore.getState().nextInPlaylist()]);
    expect(usePlayerStore.getState().currentSongId).toBe('c');
    expect(native.skipToNext).toHaveBeenCalledTimes(2);
  });

  it('previous starts the song over past 3 seconds, without changing the song on screen', () => {
    usePlayerStore.setState({ currentQueueIndex: 2, currentSong: queue[2], currentSongId: 'c', loadedAudioId: 'c' });
    playerControls.getPosition = () => 3.5;
    usePlayerStore.getState().previousInPlaylist();
    expect(usePlayerStore.getState().currentSongId).toBe('c');
    expect(native.skipToPrevious).toHaveBeenCalledTimes(1);
  });

  it('previous goes back one in the first 3 seconds', () => {
    usePlayerStore.setState({ currentQueueIndex: 2, currentSong: queue[2], currentSongId: 'c', loadedAudioId: 'c' });
    playerControls.getPosition = () => 1;
    usePlayerStore.getState().previousInPlaylist();
    expect(usePlayerStore.getState().currentSongId).toBe('b');
    expect(native.skipToPrevious).toHaveBeenCalledTimes(1);
  });

  it('previous on the first song starts it over under repeat off, and wraps under repeat all', () => {
    usePlaybackModesStore.setState({ repeatMode: 'off' });
    usePlayerStore.getState().previousInPlaylist();
    expect(usePlayerStore.getState().currentSongId).toBe('a');

    usePlaybackModesStore.setState({ repeatMode: 'all' });
    usePlayerStore.getState().previousInPlaylist();
    expect(usePlayerStore.getState().currentSongId).toBe('d');
  });

  it('a tap on a row of Up next skips there', () => {
    usePlayerStore.getState().skipToQueueIndex(2);
    expect(usePlayerStore.getState().currentSongId).toBe('c');
    expect(native.skipToIndex).toHaveBeenCalledWith(2);
  });
});

describe('following the engine', () => {
  it('shows the queue and the place the engine reports', () => {
    usePlayerStore.getState().adoptNativeQueue({ ids: ['d', 'c', 'b', 'a'], index: 1, shuffle: true, repeat: 'one', tag: 'stream#4', positionSec: 0 });
    const s = usePlayerStore.getState();
    expect(ids(s.playlistQueue)).toEqual(['d', 'c', 'b', 'a']);
    expect(s.currentQueueIndex).toBe(1);
    expect(s.currentSongId).toBe('c');
    expect(s.loadedAudioId).toBe('c');
    expect(s.currentPlaylistId).toBe('stream');
    expect(usePlaybackModesStore.getState()).toMatchObject({ shuffle: true, repeatMode: 'one', repeatOne: true });
  });

  it('keeps the very same queue array when nothing changed, so it can never feed back', () => {
    const before = usePlayerStore.getState().playlistQueue;
    usePlayerStore.getState().adoptNativeQueue({ ids: ids(queue), index: 0, shuffle: false, repeat: 'all', tag: 'library#1', positionSec: 0 });
    expect(usePlayerStore.getState().playlistQueue).toBe(before);
    expect(native.getQueueState).not.toHaveBeenCalled();
  });

  it('keeps the richer song it already has for the playing item', () => {
    const rich = { ...queue[0], lyrics: [{ timestamp: 0, text: 'hi', lineOrder: 0 }] } as Song;
    usePlayerStore.setState({ currentSong: rich, playlistQueue: [rich, ...queue.slice(1)] });
    usePlayerStore.getState().adoptNativeQueue({ ids: ['a', 'b', 'c', 'd', 'e'], index: 0, shuffle: false, repeat: 'all', tag: 'library#1', positionSec: 0 });
    expect(usePlayerStore.getState().currentSong).toBe(rich);
  });

  it('sets a report aside while its own command is being applied, and reads the settled queue afterwards', async () => {
    mockBusy = true;
    usePlayerStore.getState().adoptNativeQueue({ ids: ['c', 'd'], index: 0, shuffle: false, repeat: 'all', tag: 'library#1', positionSec: 0 });
    expect(usePlayerStore.getState().currentSongId).toBe('a');

    native.getQueueState.mockResolvedValue({ ids: ['b', 'c'], index: 0, shuffle: false, repeat: 'all', tag: 'library#1', positionSec: 0 });
    settle();
    await flush();
    expect(native.getQueueState).toHaveBeenCalledWith(false);
    expect(usePlayerStore.getState().currentSongId).toBe('b');
  });

  it('adopts a song change from the engine without loading it again', () => {
    usePlayerStore.getState().adoptPreparedTrack('c', 2);
    const s = usePlayerStore.getState();
    expect(s.currentSongId).toBe('c');
    expect(s.currentQueueIndex).toBe(2);
    expect(s.loadedAudioId).toBe('c');
    expect(native.load).not.toHaveBeenCalled();
  });

  it('ignores a song change it already shows', () => {
    const before = usePlayerStore.getState();
    usePlayerStore.getState().adoptPreparedTrack('a', 0);
    expect(usePlayerStore.getState()).toBe(before);
  });

  it('reads the queue instead of guessing when a song change names a song it does not have', async () => {
    native.getQueueState.mockResolvedValue({ ids: ['x', 'y'], index: 1, shuffle: false, repeat: 'all', tag: 'stream#2', positionSec: 0, items: [
      { id: 'x', uri: 'https://cdn/x.m4a', title: 'X', artist: '', album: '', artworkUri: '' },
      { id: 'y', uri: 'https://cdn/y.m4a', title: 'Y', artist: '', album: '', artworkUri: '' },
    ] });
    usePlayerStore.getState().adoptPreparedTrack('y', 1);
    await flush();
    expect(usePlayerStore.getState().currentSongId).toBe('y');
  });

  it('asks for the details once when it is told of songs it has never seen', async () => {
    native.getQueueState.mockResolvedValue({ ids: ['x', 'y'], index: 0, shuffle: false, repeat: 'all', tag: 'stream#2', positionSec: 0, items: [
      { id: 'x', uri: 'https://cdn/x.m4a', title: 'X', artist: 'AX', album: '', artworkUri: '' },
      { id: 'y', uri: 'https://cdn/y.m4a', title: 'Y', artist: '', album: '', artworkUri: '' },
    ] });
    usePlayerStore.getState().adoptNativeQueue({ ids: ['x', 'y'], index: 0, shuffle: false, repeat: 'all', tag: 'stream#2', positionSec: 0 });
    await flush();
    expect(native.getQueueState).toHaveBeenCalledWith(true);
    const s = usePlayerStore.getState();
    expect(ids(s.playlistQueue)).toEqual(['x', 'y']);
    expect(s.currentSong).toMatchObject({ id: 'x', title: 'X', artist: 'AX', audioUri: 'https://cdn/x.m4a' });
  });

  it('empties the mirror, not the playing song, when the engine has no queue', () => {
    usePlayerStore.getState().adoptNativeQueue({ ids: [], index: -1, shuffle: false, repeat: 'all', tag: null, positionSec: 0 });
    const s = usePlayerStore.getState();
    expect(s.playlistQueue).toBeNull();
    expect(s.currentSongId).toBe('a');
  });
});

describe('editing the queue', () => {
  it('reorders through the engine without a reload', async () => {
    usePlayerStore.getState().updateQueue([queue[0], queue[2], queue[1], queue[3]]);
    await flush();
    expect(native.replaceQueue).toHaveBeenCalledTimes(1);
    expect(ids(usePlayerStore.getState().playlistQueue)).toEqual(['a', 'c', 'b', 'd']);
    expect(native.setQueue).not.toHaveBeenCalled();
  });

  it('leaves the engine alone when only a song\'s details changed (lyrics landed)', async () => {
    usePlayerStore.getState().updateQueue(queue.map(s => ({ ...s, lyricSource: 'LRCLIB' })));
    await flush();
    expect(native.replaceQueue).not.toHaveBeenCalled();
  });

  it('removing a song that is not playing drops it from the screen and from the engine', async () => {
    usePlayerStore.getState().removeFromQueue('c');
    expect(ids(usePlayerStore.getState().playlistQueue)).toEqual(['a', 'b', 'd']);
    await flush();
    expect(native.removeFromQueue).toHaveBeenCalledWith('c', 'library#1');
  });

  it('removing the playing song leaves it to the engine to move on', async () => {
    usePlayerStore.getState().removeFromQueue('a');
    expect(usePlayerStore.getState().currentSongId).toBe('a');
    await flush();
    expect(native.removeFromQueue).toHaveBeenCalledWith('a', 'library#1');
  });

  it('clearing the upcoming songs keeps the playing one in the engine', async () => {
    usePlayerStore.getState().clearPlaylistQueue();
    await flush();
    expect(native.replaceQueue).toHaveBeenCalledWith([], 'library#1', null);
  });

  it('shuffle and repeat are the engine\'s', () => {
    usePlaybackModesStore.getState().setShuffle(true);
    usePlaybackModesStore.getState().setRepeatMode('one');
    expect(native.setShuffle).toHaveBeenCalledWith(true);
    expect(native.setRepeatMode).toHaveBeenCalledWith('one');
    expect(usePlaybackModesStore.getState()).toMatchObject({ shuffle: true, repeatMode: 'one', repeatOne: true });
  });
});

describe('reading the engine', () => {
  it('does not drop a read asked for while another is in flight (it may have started before the change)', async () => {
    let firstAnswer: (state: unknown) => void = () => undefined;
    native.getQueueState
      .mockReturnValueOnce(new Promise(resolve => { firstAnswer = resolve; }))
      .mockResolvedValue({ ids: ['b', 'c'], index: 0, shuffle: false, repeat: 'all', tag: 'library#1', positionSec: 0 });
    const first = usePlayerStore.getState().reconcileNativeQueue();
    const second = usePlayerStore.getState().reconcileNativeQueue();
    firstAnswer({ ids: ids(queue), index: 0, shuffle: false, repeat: 'all', tag: 'library#1', positionSec: 0 });
    await Promise.all([first, second]);
    await flush();
    expect(native.getQueueState).toHaveBeenCalledTimes(2);
    expect(usePlayerStore.getState().currentSongId).toBe('b');
  });
});

describe('a saved queue', () => {
  const restored = {
    ids: ['x', 'y', 'z'], index: 1, shuffle: true, repeat: 'off', tag: 'stream#3', positionSec: 42,
    items: ['x', 'y', 'z'].map(id => ({ id, uri: `https://cdn/${id}.m4a`, title: id.toUpperCase(), artist: 'Art', album: '', artworkUri: '' })),
  };

  it('comes back as usable songs, paused where it was, without sending the engine a load', async () => {
    native.hasSavedQueue.mockReturnValue(true);
    native.restoreQueue.mockResolvedValue(restored);
    usePlayerStore.setState({ playlistQueue: null, currentSong: null, currentSongId: null, loadedAudioId: null, currentQueueIndex: -1 });

    expect(await usePlayerStore.getState().restoreNativeQueue()).toBe(true);
    const s = usePlayerStore.getState();
    expect(ids(s.playlistQueue)).toEqual(['x', 'y', 'z']);
    expect(s.currentSong).toMatchObject({ id: 'y', title: 'Y', artist: 'Art', audioUri: 'https://cdn/y.m4a' });
    // Adopted before any screen can ask for a load: nothing is left to load.
    expect(s.loadedAudioId).toBe('y');
    expect(s.currentPlaylistId).toBe('stream');
    expect(usePlaybackModesStore.getState()).toMatchObject({ shuffle: true, repeatMode: 'off' });
    expect(native.load).not.toHaveBeenCalled();
    expect(native.setQueue).not.toHaveBeenCalled();
  });

  it('reports false when there is nothing saved', async () => {
    expect(await usePlayerStore.getState().restoreNativeQueue()).toBe(false);
    expect(native.restoreQueue).not.toHaveBeenCalled();
  });

  it('uses the library\'s own song, with its lyrics, for an id the library knows', async () => {
    const own = { ...song('y'), title: 'Library Y', lyrics: [{ timestamp: 0, text: 'x', lineOrder: 0 }] };
    mockLibrary.push(own as unknown as Record<string, unknown>);
    native.hasSavedQueue.mockReturnValue(true);
    native.restoreQueue.mockResolvedValue(restored);
    usePlayerStore.setState({ playlistQueue: null, currentSong: null, currentSongId: null, loadedAudioId: null, currentQueueIndex: -1 });
    await usePlayerStore.getState().restoreNativeQueue();
    expect(usePlayerStore.getState().currentSong).toBe(own);
  });
});

describe('running low', () => {
  it('asks again when the app comes back and the queue is short', async () => {
    const heard = jest.fn();
    const stop = onQueueLow(heard);
    native.getQueueState.mockResolvedValue({ ids: ids(queue), index: 2, shuffle: false, repeat: 'all', tag: 'stream#5', positionSec: 0 });
    await usePlayerStore.getState().reconcileNativeQueue();
    expect(heard).toHaveBeenCalledWith(expect.objectContaining({ size: 4, mediaId: 'c' }));
    stop();
  });
});

describe('losing the engine', () => {
  it('clears the engine too when the song is gone', () => {
    usePlayerStore.getState().reset();
    expect(native.clearQueue).toHaveBeenCalledTimes(1);
  });
});
