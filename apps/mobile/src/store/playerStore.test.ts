// The DB layer is stubbed only so this module graph loads under testEnvironment:
// 'node' — none of the behaviour under test reads or writes SQLite.
jest.mock('../database/queries', () => ({
  getSongById: jest.fn().mockResolvedValue(null),
}));
jest.mock('./songsStore', () => ({
  useSongsStore: { getState: () => ({ songs: [], setCurrentSong: jest.fn() }) },
}));
jest.mock('./settingsStore', () => ({
  useSettingsStore: { getState: () => ({ updatePlaylistHistory: jest.fn() }) },
}));
jest.mock('../services/NativeAudioPlayer', () => ({
  NativeAudioPlayer: {
    isAvailable: () => false,
    prepareNext: jest.fn(),
    seekToNextIfReady: jest.fn().mockResolvedValue(false),
  },
}));

import {
  usePlayerStore,
  playerControls,
  beginAudioLoad,
  endAudioLoad,
  setNativeOwnsPlaybackState,
  setPlaylistSelectionRouter,
  liveMiniPlayerHides,
} from './playerStore';
import { isStalePlayingEcho, clearPlaybackIntent } from '../playback/playbackIntent';
import { NativeAudioPlayer } from '../services/NativeAudioPlayer';
import type { Song } from '../types/song';

describe('requestPlayback', () => {
  let calls: string[];
  let originalPlay: typeof playerControls.play;
  let originalPause: typeof playerControls.pause;

  beforeEach(() => {
    calls = [];
    // playerControls is a mutable module ref that PlayerContext writes at mount,
    // so a test can stand in for the native player without a mocking framework.
    originalPlay = playerControls.play;
    originalPause = playerControls.pause;
    playerControls.play = () => calls.push('play');
    playerControls.pause = () => calls.push('pause');
    usePlayerStore.setState({ isPlaying: false });
    clearPlaybackIntent();
  });

  afterEach(() => {
    playerControls.play = originalPlay;
    playerControls.pause = originalPause;
    clearPlaybackIntent();
    setNativeOwnsPlaybackState(false);
  });

  it('updates the store and issues the matching command', () => {
    usePlayerStore.getState().requestPlayback(true);
    expect(usePlayerStore.getState().isPlaying).toBe(true);
    expect(calls).toEqual(['play']);

    usePlayerStore.getState().requestPlayback(false);
    expect(usePlayerStore.getState().isPlaying).toBe(false);
    expect(calls).toEqual(['play', 'pause']);
  });

  // This is what stops the flicker: the intent must be armed by the same call that
  // flips the store, so a status echo arriving in between is recognised as stale.
  it('arms the echo guard so a contradicting status is rejected', () => {
    usePlayerStore.getState().requestPlayback(false);
    expect(isStalePlayingEcho(true)).toBe(true);
  });

  // On Android, Media3 echoes playWhenReady back immediately. Setting isPlaying
  // here too would recreate the very race the echo guard exists to paper over.
  describe('when the native player owns playback state', () => {
    beforeEach(() => setNativeOwnsPlaybackState(true));

    it('issues the command without touching the store', () => {
      usePlayerStore.getState().requestPlayback(true);
      expect(calls).toEqual(['play']);
      expect(usePlayerStore.getState().isPlaying).toBe(false); // awaits native echo
    });

    it('does not arm the echo guard', () => {
      usePlayerStore.getState().requestPlayback(false);
      // Nothing optimistic was set, so a contradicting status is not "stale" —
      // it is simply the truth, and must be adopted.
      expect(isStalePlayingEcho(true)).toBe(false);
    });
  });

  it('still issues the command when the store is already in the target state', () => {
    usePlayerStore.setState({ isPlaying: true });
    usePlayerStore.getState().requestPlayback(true);
    // A no-op in the store must not become a no-op at the player — the player may
    // genuinely be paused while the store thinks otherwise.
    expect(calls).toEqual(['play']);
  });
});

describe('audio load ownership', () => {
  afterEach(() => {
    endAudioLoad('song-a');
    endAudioLoad('song-b');
  });

  // MiniPlayer and NowPlayingScreen both watch loadedAudioId; without this claim
  // they both call player.replace() for the same track.
  it('grants the claim once and refuses a concurrent claim for the same track', () => {
    expect(beginAudioLoad('song-a')).toBe(true);
    expect(beginAudioLoad('song-a')).toBe(false);
  });

  it('releases the claim so the same track can be reloaded later', () => {
    expect(beginAudioLoad('song-a')).toBe(true);
    endAudioLoad('song-a');
    expect(beginAudioLoad('song-a')).toBe(true);
  });

  it('lets a newer track take over from an in-flight load', () => {
    expect(beginAudioLoad('song-a')).toBe(true);
    // user skips before song-a finishes loading
    expect(beginAudioLoad('song-b')).toBe(true);
    // a late release from the abandoned load must not free the new claim
    endAudioLoad('song-a');
    expect(beginAudioLoad('song-b')).toBe(false);
  });
});

describe('Connect song selection routing', () => {
  afterEach(() => setPlaylistSelectionRouter(null));

  it('routes a user song pick before the local player starts', () => {
    const selected = { id: 'remote-song', title: 'Remote', artist: 'Artist', audioUri: 'https://example.test/song' } as Song;
    const route = jest.fn(() => true);
    const stop = setPlaylistSelectionRouter(route);

    usePlayerStore.getState().setPlaylistQueue('search', [selected], 0, true);

    expect(route).toHaveBeenCalledWith({ playlistId: 'search', songs: [selected], startIndex: 0 });
    expect(usePlayerStore.getState().currentSongId).not.toBe('remote-song');
    stop();
  });

  it('keeps Connect-owned loads and paused restores out of the router', () => {
    const selected = { id: 'local-song', title: 'Local', artist: 'Artist', audioUri: 'file:///song' } as Song;
    const route = jest.fn(() => true);
    setPlaylistSelectionRouter(route);

    usePlayerStore.getState().setPlaylistQueue('connect', [selected], 0, false);
    usePlayerStore.getState().setPlaylistQueue('search', [selected], 0, false);
    expect(route).not.toHaveBeenCalled();
  });
});

describe('adoptPreparedTrack', () => {
  const song = (id: string): Song =>
    ({ id, title: id, artist: 'a', audioUri: `file:///${id}.mp3` }) as Song;

  it('moves the queue cursor without clearing loadedAudioId', () => {
    const a = song('a');
    const b = song('b');
    usePlayerStore.setState({
      playlistQueue: [a, b],
      currentQueueIndex: 0,
      currentSong: a,
      currentSongId: 'a',
      loadedAudioId: 'a',
      currentPlaylistId: 'library',
    });

    usePlayerStore.getState().adoptPreparedTrack('b');

    const s = usePlayerStore.getState();
    expect(s.currentSongId).toBe('b');
    expect(s.currentQueueIndex).toBe(1);
    expect(s.loadedAudioId).toBe('b');
  });
});

describe('skipping to the next song', () => {
  const song = (id: string): Song =>
    ({ id, title: id, artist: 'a', audioUri: `file:///${id}.mp3` }) as Song;
  const seekToNext = NativeAudioPlayer.seekToNextIfReady as jest.Mock;
  const queue = ['a', 'b', 'c', 'd'].map(song);

  beforeEach(() => {
    seekToNext.mockReset().mockResolvedValue(false);
    usePlayerStore.setState({
      playlistQueue: queue,
      currentQueueIndex: 0,
      currentSong: queue[0],
      currentSongId: 'a',
      loadedAudioId: 'a',
      currentPlaylistId: 'library',
      isPlaying: true,
    });
  });

  // The screen used to wait for the native player's answer before it changed anything.
  it('changes the song on screen in the same tick, before the native player answers', () => {
    seekToNext.mockReturnValue(new Promise(() => undefined));
    void usePlayerStore.getState().nextInPlaylist();
    const s = usePlayerStore.getState();
    expect(s.currentSongId).toBe('b');
    expect(s.currentQueueIndex).toBe(1);
    // Claimed, so the mini player does not start a load of its own while the staged item is tried.
    expect(s.loadedAudioId).toBe('b');
  });

  it('moves two songs on for two quick taps, not the same one twice', async () => {
    seekToNext.mockResolvedValue(true);
    const first = usePlayerStore.getState().nextInPlaylist();
    const second = usePlayerStore.getState().nextInPlaylist();
    await Promise.all([first, second]);
    expect(usePlayerStore.getState().currentSongId).toBe('c');
    expect(seekToNext.mock.calls.map(call => call[0])).toEqual(['b', 'c']);
  });

  it('never puts an older song back when its native answer arrives late', async () => {
    let answerFirst: (used: boolean) => void = () => undefined;
    seekToNext.mockReturnValueOnce(new Promise<boolean>(resolve => { answerFirst = resolve; })).mockResolvedValue(true);
    const first = usePlayerStore.getState().nextInPlaylist();
    await usePlayerStore.getState().nextInPlaylist();
    answerFirst(true);
    await first;
    expect(usePlayerStore.getState().currentSongId).toBe('c');
    expect(usePlayerStore.getState().currentSong?.id).toBe('c');
  });

  it('hands the load back to the mini player when nothing was staged', async () => {
    await usePlayerStore.getState().nextInPlaylist();
    const s = usePlayerStore.getState();
    expect(s.currentSongId).toBe('b');
    expect(s.loadedAudioId).toBeNull();
  });
});

describe('stale mini player hides', () => {
  const sources = (...names: string[]) => new Set(names);

  it('keeps the flag the screen in front is entitled to', () => {
    expect([...liveMiniPlayerHides(sources('NowPlaying'), 'NowPlaying')]).toEqual(['NowPlaying']);
    expect([...liveMiniPlayerHides(sources('Editor'), 'EditLyrics')]).toEqual(['Editor']);
  });

  // The Downloader is a tab and tabs stay mounted: it once hid the pill for good after the first visit.
  it('drops a flag left behind by a screen that is no longer in front', () => {
    expect(liveMiniPlayerHides(sources('Downloader'), 'LibraryHome').size).toBe(0);
    expect(liveMiniPlayerHides(sources('manual', 'Downloader', 'NowPlaying'), 'Stream').size).toBe(0);
    expect([...liveMiniPlayerHides(sources('NowPlaying', 'Downloader'), 'NowPlaying')]).toEqual(['NowPlaying']);
  });

  it('leaves everything alone while the route is not known yet', () => {
    expect(liveMiniPlayerHides(sources('NowPlaying', 'manual'), undefined).size).toBe(2);
  });

  it('brings the pill back through the store when the leak is found', () => {
    usePlayerStore.setState({ miniPlayerHiddenSources: new Set(['Downloader']), hideMiniPlayer: true });
    usePlayerStore.getState().reconcileMiniPlayerHides('Library');
    expect(usePlayerStore.getState().hideMiniPlayer).toBe(false);
    expect(usePlayerStore.getState().miniPlayerHiddenSources.size).toBe(0);
  });
});

describe('mini player visibility', () => {
  beforeEach(() => usePlayerStore.setState({ miniPlayerHiddenSources: new Set(), hideMiniPlayer: false }));

  it('comes back when the player that hid it closes', () => {
    const s = usePlayerStore.getState();
    s.setMiniPlayerHiddenSource('NowPlaying', true);
    expect(usePlayerStore.getState().hideMiniPlayer).toBe(true);
    s.setMiniPlayerHiddenSource('NowPlaying', false);
    expect(usePlayerStore.getState().hideMiniPlayer).toBe(false);
  });

  it('stays hidden while another screen still hides it', () => {
    const s = usePlayerStore.getState();
    s.setMiniPlayerHiddenSource('NowPlaying', true);
    s.setMiniPlayerHidden(true); // e.g. the YouTube browser
    s.setMiniPlayerHiddenSource('NowPlaying', false);
    expect(usePlayerStore.getState().hideMiniPlayer).toBe(true);
    s.setMiniPlayerHidden(false);
    expect(usePlayerStore.getState().hideMiniPlayer).toBe(false);
  });
});
