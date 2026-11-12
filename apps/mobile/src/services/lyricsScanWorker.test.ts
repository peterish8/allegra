import type { ScanJob } from '../store/lyricsScanQueueStore';
const mockFetch = jest.fn();
const mockUpdateSong = jest.fn();
let mockJob: ScanJob | undefined;
let mockProcessing = false;
jest.mock('./LyricaService', () => ({ lyricaService: {
  fetchLyrics: (...args: unknown[]) => mockFetch(...args),
  hasTimestamps: () => true,
  parseLrc: () => [{ timestamp: 1, text: 'Hello' }],
} }));
jest.mock('../store/songsStore', () => ({ useSongsStore: { getState: () => ({
  getSong: async () => ({ id: 'song', title: 'Song', audioUri: 'file:///song.mp3', duration: 120 }),
  updateSong: (...args: unknown[]) => mockUpdateSong(...args),
}) } }));
jest.mock('../store/lyricsScanQueueStore', () => ({
  useLyricsScanQueueStore: { getState: () => ({
    processing: mockProcessing,
    queue: mockJob ? { song: mockJob } : {},
    pruneExpiredJobs: () => {},
    setProcessing: (value: boolean) => { mockProcessing = value; },
    updateJob: (_id: string, update: Partial<ScanJob> | ((job: ScanJob) => Partial<ScanJob>)) => {
      if (mockJob) mockJob = { ...mockJob, ...(typeof update === 'function' ? update(mockJob) : update) };
    },
    removeFromQueue: () => { mockJob = undefined; },
  }) },
  appendLog: (log: string[], text: string) => [...log, text],
  cancelPruneTimer: () => {},
  schedulePruneTimer: () => {},
}));
import { processLyricsScanQueue } from './lyricsScanWorker';

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockProcessing = false;
  mockJob = { songId: 'song', title: 'Song', artist: 'Artist', duration: 120, attempts: 0, status: 'pending', log: [], createdAt: 0, updatedAt: 0 };
});
afterEach(() => { jest.useRealTimers(); });

test('Lyrics arriving later are attached to the already downloaded song', async () => {
  let deliver!: (value: { lyrics: string; source: string }) => void;
  mockFetch.mockReturnValue(new Promise(resolve => { deliver = resolve; }));
  const running = processLyricsScanQueue();
  expect(mockJob?.status).toBe('scanning');
  expect(mockUpdateSong).not.toHaveBeenCalled();
  deliver({ lyrics: '[00:01]Hello', source: 'lrclib' });
  await jest.runAllTimersAsync();
  await running;
  expect(mockUpdateSong).toHaveBeenCalledWith(expect.objectContaining({
    id: 'song', audioUri: 'file:///song.mp3', lyrics: [{ timestamp: 1, text: 'Hello' }],
  }));
  expect(mockJob?.status).toBe('completed');
});

test('Missing lyrics leave downloaded audio alone and finish the scan', async () => {
  mockFetch.mockResolvedValue(null);
  const running = processLyricsScanQueue();
  await jest.runAllTimersAsync();
  await running;
  expect(mockUpdateSong).not.toHaveBeenCalled();
  expect(mockJob?.status).toBe('failed');
  expect(mockProcessing).toBe(false);
});
