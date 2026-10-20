import type { Song } from '../../types/song';

const mockFetchLyrics = jest.fn();
let mockState: { currentSong: Song | null; playlistQueue: Song[] | null; updateCurrentSong: jest.Mock; updateQueue: jest.Mock };

jest.mock('../LyricaService', () => ({
  lyricaService: {
    fetchLyrics: (...args: unknown[]) => mockFetchLyrics(...args),
    hasTimestamps: (lrc: string) => /\[\d+:\d+/.test(lrc),
    parseLrc: (lrc: string) => lrc.split('\n').map(line => {
      const m = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/);
      return m ? { timestamp: Number(m[1]) * 60 + Number(m[2]), text: m[3], lineOrder: 0 } : { timestamp: 0, text: line, lineOrder: 0 };
    }),
  },
}));
jest.mock('../../store/playerStore', () => ({ usePlayerStore: { getState: () => mockState } }));
jest.mock('../../database/queries', () => ({ updateSong: jest.fn(async () => undefined) }));

import { resetLyricsUpgrades, upgradeToSyncedLyrics, wantsSyncedUpgrade } from './lyricsUpgrade';

const plain = [{ timestamp: 0, text: 'Mozhiye', lineOrder: 0 }, { timestamp: 0, text: 'Second line', lineOrder: 1 }];
const SYNCED = '[00:12.00]Mozhiye\n[00:16.50]Second line';

function song(over: Partial<Song> = {}): Song {
  return {
    id: 'stream:saavn:bWAryKJA', title: 'One Sun One Moon', artist: 'Anirudh Ravichander, Super Subu', gradientId: 'g',
    duration: 217, dateCreated: '', dateModified: '', playCount: 0, lyrics: plain, lyricSource: 'JioSaavn', ...over,
  };
}

function playing(current: Song): void {
  mockState = { currentSong: current, playlistQueue: [current], updateCurrentSong: jest.fn(), updateQueue: jest.fn() };
}

beforeEach(() => {
  resetLyricsUpgrades();
  mockFetchLyrics.mockReset();
});

describe('upgrading plain lyrics to synced', () => {
  it('swaps JioSaavn plain words for synced lines found by a synced-only lookup, on screen and in the queue', async () => {
    const current = song();
    playing(current);
    mockFetchLyrics.mockResolvedValue({ lyrics: SYNCED, source: 'LRCLIB' });
    await expect(upgradeToSyncedLyrics(current)).resolves.toBe(true);
    expect(mockFetchLyrics).toHaveBeenCalledWith(current.title, current.artist, true, 217, { ref: 'saavn:bWAryKJA' });
    expect(mockState.updateCurrentSong).toHaveBeenCalledWith(expect.objectContaining({ lyricSource: 'LRCLIB' }));
    expect(mockState.updateQueue.mock.calls[0][0][0].lyrics[0].timestamp).toBe(12);
  });

  it('asks once per song, so a song with no synced lyrics anywhere is not polled', async () => {
    const current = song();
    playing(current);
    mockFetchLyrics.mockResolvedValue(null);
    await upgradeToSyncedLyrics(current);
    await upgradeToSyncedLyrics(current);
    expect(mockFetchLyrics).toHaveBeenCalledTimes(1);
  });

  it('leaves the next song alone when the listener skipped during the lookup', async () => {
    const current = song();
    playing(current);
    mockFetchLyrics.mockImplementation(async () => {
      playing(song({ id: 'stream:saavn:other' }));
      return { lyrics: SYNCED, source: 'LRCLIB' };
    });
    await expect(upgradeToSyncedLyrics(current)).resolves.toBe(false);
    expect(mockState.updateCurrentSong).not.toHaveBeenCalled();
  });

  it('keeps a version picked by hand while the lookup ran', async () => {
    const current = song();
    playing(current);
    mockFetchLyrics.mockImplementation(async () => {
      playing({ ...current, lyrics: [{ timestamp: 0, text: 'Picked', lineOrder: 0 }] });
      return { lyrics: SYNCED, source: 'LRCLIB' };
    });
    await expect(upgradeToSyncedLyrics(current)).resolves.toBe(false);
  });

  it('never replaces synced or hand-typed lyrics, and ignores an answer without timestamps', async () => {
    const asked = new Set<string>();
    expect(wantsSyncedUpgrade(song({ lyrics: [{ timestamp: 3, text: 'x', lineOrder: 0 }] }), asked)).toBe(false);
    expect(wantsSyncedUpgrade(song({ lyricSource: 'Manual' }), asked)).toBe(false);
    expect(wantsSyncedUpgrade(song({ lyrics: [] }), asked)).toBe(false);
    const current = song();
    playing(current);
    mockFetchLyrics.mockResolvedValue({ lyrics: 'Just words\nNo times', source: 'Lyrica' });
    await expect(upgradeToSyncedLyrics(current)).resolves.toBe(false);
  });

  it('never throws when the lookup fails', async () => {
    const current = song();
    playing(current);
    mockFetchLyrics.mockRejectedValue(new Error('backend down'));
    await expect(upgradeToSyncedLyrics(current)).resolves.toBe(false);
  });
});
