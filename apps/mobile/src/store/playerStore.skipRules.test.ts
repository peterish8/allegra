// Next and previous on the JavaScript-owned queue (iPhone, and anywhere the Kotlin engine is missing): the edges of
// the queue, every repeat mode, the 3 second rule and what a skip does to play and pause. The Android engine's
// side of the same rules is in playerStore.native.test.ts.
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
jest.mock('../services/NativeAudioPlayer', () => ({
  NativeAudioPlayer: { isAvailable: () => false, hasQueue: () => false },
}));

import { clearPlaybackIntent } from '../playback/playbackIntent';
import type { Song } from '../types/song';
import { usePlaybackModesStore } from './playbackModesStore';
import { playerControls, setNativeOwnsPlaybackState, usePlayerStore } from './playerStore';

const song = (id: string): Song => ({ id, title: id, artist: 'a', audioUri: `file:///${id}.mp3`, lyrics: [], duration: 200 }) as unknown as Song;
const queue = ['a', 'b', 'c', 'd'].map(song);

let calls: string[];
let position = 0;

const at = (index: number, playing = true) =>
  usePlayerStore.setState({
    playlistQueue: queue,
    currentQueueIndex: index,
    currentSong: queue[index],
    currentSongId: queue[index].id,
    loadedAudioId: queue[index].id,
    currentPlaylistId: 'library',
    isPlaying: playing,
  });
const now = () => usePlayerStore.getState();
const current = () => now().currentSongId;

beforeEach(() => {
  calls = [];
  position = 0;
  mockLibrary.length = 0;
  setNativeOwnsPlaybackState(false);
  clearPlaybackIntent();
  playerControls.play = () => { calls.push('play'); };
  playerControls.pause = () => { calls.push('pause'); };
  playerControls.seekTo = async (to: number) => { calls.push(`seek ${to}`); };
  playerControls.getPosition = () => position;
  playerControls.resetPlayhead = () => { calls.push('reset'); };
  usePlaybackModesStore.setState({ repeatMode: 'off', repeatOne: false, shuffle: false });
  usePlayerStore.getState().reset();
  at(0);
});

describe('next', () => {
  it.each(['off', 'all', 'one'] as const)('on the last song goes to the first and plays under repeat %s (the button always wraps)', async repeatMode => {
    usePlaybackModesStore.setState({ repeatMode });
    at(3);
    await now().nextInPlaylist();
    expect(current()).toBe('a');
    expect(now().currentQueueIndex).toBe(0);
    expect(now().isPlaying).toBe(true);
  });

  it('at the natural end of the queue with repeat off rests on the first song, paused', async () => {
    at(3);
    await now().nextInPlaylist(true);
    expect(current()).toBe('a');
    expect(now().isPlaying).toBe(false);
    expect(calls).toContain('pause');
    expect(calls).not.toContain('play');
  });

  it('at the natural end with repeat all starts over and plays', async () => {
    usePlaybackModesStore.setState({ repeatMode: 'all' });
    at(3);
    await now().nextInPlaylist(true);
    expect(current()).toBe('a');
    expect(now().isPlaying).toBe(true);
  });

  it('in the middle of the queue goes one song on, also at the natural end of a song', async () => {
    at(1);
    await now().nextInPlaylist(true);
    expect(current()).toBe('c');
  });

  it('while paused plays the next song (a skip is a request to listen)', async () => {
    at(0, false);
    await now().nextInPlaylist();
    expect(current()).toBe('b');
    expect(now().isPlaying).toBe(true);
  });

  it('puts the playhead back to 0 and hands the load to the mini player in the same tick', () => {
    now().nextInPlaylist().catch(() => undefined);
    expect(calls).toContain('reset');
    expect(now().loadedAudioId).toBeNull();
  });

  it('three quick taps move three songs on, not the same one again', async () => {
    await Promise.all([now().nextInPlaylist(), now().nextInPlaylist(), now().nextInPlaylist()]);
    expect(current()).toBe('d');
  });

  it('with no queue and no library does nothing and does not throw', async () => {
    usePlayerStore.setState({ playlistQueue: null, currentQueueIndex: -1, currentPlaylistId: null });
    await expect(now().nextInPlaylist()).resolves.toBeUndefined();
    expect(current()).toBe('a');
  });

  it('rebuilds a missing queue from the library, so auto-next still works', async () => {
    mockLibrary.push(...queue as unknown as Array<Record<string, unknown>>);
    usePlayerStore.setState({ playlistQueue: null, currentQueueIndex: -1, currentPlaylistId: 'library' });
    await now().nextInPlaylist();
    expect(current()).toBe('b');
  });
});

describe('previous', () => {
  it('within 3 seconds goes back one song and plays', () => {
    at(2);
    position = 2.9;
    now().previousInPlaylist();
    expect(current()).toBe('b');
    expect(now().isPlaying).toBe(true);
  });

  it('after 3 seconds starts the song over and keeps it', async () => {
    at(2);
    position = 3.5;
    now().previousInPlaylist();
    await Promise.resolve();
    expect(current()).toBe('c');
    expect(calls).toContain('seek 0');
    expect(calls).toContain('play');
  });

  // expo-audio's seek pauses: a play sent before the seek landed was undone by it (playback invariant 3).
  it('plays again only after the restart seek has landed', async () => {
    at(2);
    position = 3.5;
    let landed: () => void = () => undefined;
    playerControls.seekTo = () => new Promise<void>(resolve => { calls.push('seek 0'); landed = resolve; });
    now().previousInPlaylist();
    await Promise.resolve();
    expect(calls).toEqual(['reset', 'seek 0']);
    landed();
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual(['reset', 'seek 0', 'play']);
  });

  it('on the first song starts it over under repeat off and one', () => {
    for (const repeatMode of ['off', 'one'] as const) {
      calls.length = 0;
      usePlaybackModesStore.setState({ repeatMode });
      at(0);
      position = 1;
      now().previousInPlaylist();
      expect(current()).toBe('a');
      expect(calls).toContain('seek 0');
    }
  });

  it('on the first song goes to the last under repeat all', () => {
    usePlaybackModesStore.setState({ repeatMode: 'all' });
    at(0);
    position = 1;
    now().previousInPlaylist();
    expect(current()).toBe('d');
    expect(now().currentQueueIndex).toBe(3);
  });

  it('with no queue does nothing and does not throw', () => {
    usePlayerStore.setState({ playlistQueue: null, currentQueueIndex: -1 });
    expect(() => now().previousInPlaylist()).not.toThrow();
    expect(current()).toBe('a');
  });
});

describe('skipping to a row of Up next', () => {
  it('plays the row tapped, and ignores a tap on the song already playing', () => {
    at(1);
    now().skipToQueueIndex(1);
    expect(current()).toBe('b');
    now().skipToQueueIndex(3);
    expect(current()).toBe('d');
    expect(now().currentQueueIndex).toBe(3);
  });

  it('ignores a row that is not there', () => {
    now().skipToQueueIndex(9);
    now().skipToQueueIndex(-1);
    expect(current()).toBe('a');
  });
});
