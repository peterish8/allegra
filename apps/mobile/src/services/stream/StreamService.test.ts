// Module graph stubs only, mirroring playerStore.test.ts — nothing here reads SQLite.
jest.mock('../../database/queries', () => ({
  getSongById: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../store/songsStore', () => ({
  useSongsStore: { getState: () => ({ songs: [], setCurrentSong: jest.fn() }) },
}));
jest.mock('../../store/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ updatePlaylistHistory: jest.fn() }) },
}));
jest.mock('../NativeAudioPlayer', () => ({
  NativeAudioPlayer: {
    isAvailable: () => false,
    hasQueue: () => false,
  },
}));
const mockRecordPlay = jest.fn();
jest.mock('../../store/streamHistoryStore', () => ({
  useStreamHistoryStore: { getState: () => ({ recordPlay: mockRecordPlay, plays: [] }) },
}));
const mockAddToQueue = jest.fn();
jest.mock('../../store/downloadQueueStore', () => ({
  useDownloadQueueStore: { getState: () => ({ addToQueue: mockAddToQueue }) },
}));
const mockGetRecommendations = jest.fn();
jest.mock('./recommend', () => ({
  recommendFor: (seed: { id: string }) => mockGetRecommendations(seed.id),
}));
const mockFetchLyrics = jest.fn();
jest.mock('../LyricaService', () => ({
  lyricaService: {
    fetchLyrics: (...args: unknown[]) => mockFetchLyrics(...args),
    warm: () => {},
    parseLrc: (lrc: string) => lrc.split('\n').map((text, i) => ({ timestamp: i, text, lineOrder: i })),
  },
}));

import { usePlayerStore, playerControls } from '../../store/playerStore';
import { StreamService } from './StreamService';
import { STREAM_QUEUE_ID } from './streamSong';
import { UnifiedSong } from '../../types/song';

const track = (id: string): UnifiedSong => ({
  id,
  title: `Song ${id}`,
  artist: 'Artist',
  highResArt: '',
  downloadUrl: `https://cdn/${id}.mp4`,
  source: 'Saavn',
  duration: 200,
});

beforeEach(() => {
  usePlayerStore.getState().reset();
  playerControls.play = jest.fn();
  playerControls.pause = jest.fn();
  mockGetRecommendations.mockReset().mockResolvedValue([]);
  mockFetchLyrics.mockReset().mockResolvedValue(null);
  mockRecordPlay.mockReset();
  mockAddToQueue.mockReset();
});

describe('StreamService.play', () => {
  it('queues transient stream songs and starts on the tapped one', () => {
    StreamService.play([track('a'), track('b'), track('c')], 1);
    const state = usePlayerStore.getState();
    expect(state.currentPlaylistId).toBe(STREAM_QUEUE_ID);
    expect(state.playlistQueue?.map(s => s.id)).toEqual(['stream:saavn:a', 'stream:saavn:b', 'stream:saavn:c']);
    expect(state.currentSongId).toBe('stream:saavn:b');
    expect(state.currentSong?.audioUri).toBe('https://cdn/b.mp4');
    expect(playerControls.play).toHaveBeenCalled();
  });

  it('keeps pointing at the tapped song after dropping unplayable ones', () => {
    StreamService.play([{ ...track('x'), downloadUrl: '' }, track('a'), track('b')], 2);
    expect(usePlayerStore.getState().currentSongId).toBe('stream:saavn:b');
  });
});

describe('StreamService.playNext', () => {
  it('inserts right after the current song', () => {
    StreamService.play([track('a'), track('b')], 0);
    StreamService.playNext(track('n'));
    expect(usePlayerStore.getState().playlistQueue?.map(s => s.id)).toEqual([
      'stream:saavn:a',
      'stream:saavn:n',
      'stream:saavn:b',
    ]);
  });
});

describe('StreamService.onSongChanged', () => {
  it('ignores library songs', async () => {
    await StreamService.onSongChanged('42');
    expect(mockRecordPlay).not.toHaveBeenCalled();
  });

  it('records history and extends the radio before the queue runs out', async () => {
    mockGetRecommendations.mockResolvedValue([track('a'), track('r1'), track('r2')]);
    StreamService.play([track('a'), track('b')], 1);
    await StreamService.onSongChanged('stream:saavn:b');

    expect(mockRecordPlay).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
    expect(mockGetRecommendations).toHaveBeenCalledWith('b');
    // 'a' is already queued, so only the new tracks are appended.
    expect(usePlayerStore.getState().playlistQueue?.map(s => s.id)).toEqual([
      'stream:saavn:a',
      'stream:saavn:b',
      'stream:saavn:r1',
      'stream:saavn:r2',
    ]);
  });

  it('does not extend while plenty of queue is left', async () => {
    StreamService.play([track('a'), track('b'), track('c'), track('d'), track('e')], 0);
    await StreamService.onSongChanged('stream:saavn:a');
    expect(mockGetRecommendations).not.toHaveBeenCalled();
  });

  it('attaches fetched lyrics to the playing stream song', async () => {
    mockFetchLyrics.mockResolvedValue({ lyrics: 'line one\nline two', source: 'LrcLib' });
    StreamService.play([track('a'), track('b'), track('c'), track('d')], 0);
    await StreamService.onSongChanged('stream:saavn:a');
    const state = usePlayerStore.getState();
    expect(state.currentSong?.lyrics.map(l => l.text)).toEqual(['line one', 'line two']);
    expect(state.currentSong?.lyricSource).toBe('LrcLib');
    expect(state.playlistQueue?.[0].lyrics).toHaveLength(2);
  });

  it('drops lyrics that arrive after the listener skipped', async () => {
    let resolve: (v: unknown) => void = () => {};
    mockFetchLyrics.mockReturnValue(new Promise(r => { resolve = r; }));
    StreamService.play([track('a'), track('b'), track('c'), track('d')], 0);
    const pending = StreamService.onSongChanged('stream:saavn:a');
    usePlayerStore.getState().setPlaylistQueue(STREAM_QUEUE_ID, usePlayerStore.getState().playlistQueue ?? [], 1);
    resolve({ lyrics: 'late', source: 'LrcLib' });
    await pending;
    expect(usePlayerStore.getState().currentSong?.id).toBe('stream:saavn:b');
    expect(usePlayerStore.getState().currentSong?.lyrics).toEqual([]);
  });
});

describe('StreamService.save', () => {
  it('queues a known stream song for download', () => {
    StreamService.play([track('a')], 0);
    expect(StreamService.save('stream:saavn:a')).toBe(true);
    expect(mockAddToQueue).toHaveBeenCalledWith([expect.objectContaining({ id: 'a' })]);
    expect(StreamService.save('stream:saavn:unknown')).toBe(false);
  });
});

describe('shouldRefillQueue (Echo’s auto load more)', () => {
  const { shouldRefillQueue } = jest.requireActual('./StreamService') as typeof import('./StreamService');
  const base = { playlistId: 'library', repeat: 'all' as const, enabled: true, remaining: 1, force: false };

  it('tops up any queue of ours that is running out', () => {
    expect(shouldRefillQueue(base)).toBe(true);
    expect(shouldRefillQueue({ ...base, playlistId: 'playlist-42' })).toBe(true);
    expect(shouldRefillQueue({ ...base, remaining: 9, force: true })).toBe(true);
  });

  it('waits while plenty is left', () => {
    expect(shouldRefillQueue({ ...base, remaining: 9 })).toBe(false);
  });

  it('respects the setting, except for a Stream radio, which always keeps going', () => {
    expect(shouldRefillQueue({ ...base, enabled: false })).toBe(false);
    expect(shouldRefillQueue({ ...base, enabled: false, playlistId: 'stream' })).toBe(true);
  });

  it('never tops up repeat-one, a shared room, or no queue', () => {
    expect(shouldRefillQueue({ ...base, repeat: 'one' })).toBe(false);
    expect(shouldRefillQueue({ ...base, playlistId: 'listen-together' })).toBe(false);
    expect(shouldRefillQueue({ ...base, playlistId: null })).toBe(false);
  });

  it('keeps a queue handed over by another device going, when the listener has it on', () => {
    expect(shouldRefillQueue({ ...base, playlistId: 'connect' })).toBe(true);
    expect(shouldRefillQueue({ ...base, playlistId: 'connect', enabled: false })).toBe(false);
  });
});

describe('StreamService.playFromSearch', () => {
  it('follows a search hit with its radio even when the song change asks first', async () => {
    const by = (id: string, artist: string): UnifiedSong => ({ ...track(id), artist });
    mockGetRecommendations.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve([by('b', 'B'), by('c', 'C'), by('d', 'D')]), 5)));
    StreamService.playFromSearch(track('a'));
    await StreamService.onSongChanged('stream:saavn:a');
    for (let i = 0; i < 20; i += 1) await new Promise(resolve => setTimeout(resolve, 0));
    expect(usePlayerStore.getState().playlistQueue?.map(s => s.id)).toEqual(['stream:saavn:a', 'stream:saavn:b', 'stream:saavn:c', 'stream:saavn:d']);
  });
});
