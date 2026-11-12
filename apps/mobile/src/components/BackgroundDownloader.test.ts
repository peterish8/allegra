const mockEffects: (() => unknown)[] = [];
jest.mock('react', () => ({
  useEffect: (effect: () => unknown) => { mockEffects.push(effect); },
  useRef: (current: unknown) => ({ current }),
}));
const mockUpdate = jest.fn();
const mockAdd = jest.fn();
const mockScan = jest.fn();
const mockFinalize = jest.fn();
const mockItem = { id: 'job', status: 'pending', song: { id: 'song', source: 'jiosaavn', title: 'Song', artist: 'Artist', streamUrl: 'https://example.com/song.mp3' } };
jest.mock('../store/downloadQueueStore', () => ({ useDownloadQueueStore: Object.assign(
  (select: (s: unknown) => unknown) => select({ updateItem: mockUpdate }),
  { getState: () => ({ queue: [mockItem] }) },
) }));
jest.mock('../store/songsStore', () => ({ useSongsStore: Object.assign(
  (select: (s: unknown) => unknown) => select({ addSong: mockAdd }),
  { getState: () => ({ songs: [] }) },
) }));
jest.mock('../store/settingsStore', () => ({ useSettingsStore: { getState: () => ({}) } }));
jest.mock('../store/lyricsScanQueueStore', () => ({ useLyricsScanQueueStore: Object.assign(
  (select: (s: unknown) => unknown) => select({ queue: {}, processing: false }),
  { getState: () => ({ addToQueue: mockScan }) },
) }));
jest.mock('../services/lyricsScanWorker', () => ({ processLyricsScanQueue: jest.fn() }));
jest.mock('../services/LyricaService', () => ({ lyricaService: { fetchLyrics: jest.fn(() => new Promise(() => {})) } }));
jest.mock('../store/playlistStore', () => ({ usePlaylistStore: { getState: () => ({}) } }));
jest.mock('../store/onlineLibraryStore', () => ({ useOnlineLibraryStore: { getState: () => ({ likedRefs: new Set() }) } }));
jest.mock('../database/syncQueries', () => ({ removeOnlineLike: jest.fn() }));
jest.mock('../database/playlistQueries', () => ({}));
jest.mock('../services/DownloadManager', () => ({ downloadManager: { finalizeDownload: (...args: unknown[]) => mockFinalize(...args) }, clearDownloadReceipt: jest.fn() }));
jest.mock('../services/YouTubeSearchService', () => ({ findYouTubeVideoId: jest.fn() }));
jest.mock('../database/queries', () => ({ patchYoutubeVideoId: jest.fn(), setPlaylistOnly: jest.fn() }));
jest.mock('../services/offlinePlaylistPlan', () => ({ reuseBeforeDownload: () => null }));
jest.mock('../store/downloadQueueSelectors', () => ({ useQueueShape: () => 'pending' }));
import { BackgroundDownloader } from './BackgroundDownloader';
import { lyricaService } from '../services/LyricaService';

beforeEach(() => {
  jest.clearAllMocks();
  mockEffects.length = 0;
  mockFinalize.mockResolvedValue({ id: 'song', title: 'Song', duration: 120, lyrics: [] });
  mockAdd.mockResolvedValue(undefined);
});

async function runDownload() {
  BackgroundDownloader();
  mockEffects.forEach(effect => effect());
  for (let i = 0; i < 15; i++) await Promise.resolve();
}

test('Audio is saved and marked done without waiting for a lyrics provider', async () => {
  await runDownload();
  expect(mockAdd).toHaveBeenCalledTimes(1);
  expect(mockUpdate).toHaveBeenCalledWith('job', { status: 'completed', progress: 1, stageStatus: 'Done' });
  expect(mockScan).toHaveBeenCalledWith(expect.objectContaining({ id: 'song' }), true);
  expect(lyricaService.fetchLyrics).not.toHaveBeenCalled();
  expect(mockAdd.mock.invocationCallOrder[0]).toBeLessThan(mockScan.mock.invocationCallOrder[0]);
});

test('A failed library save does not report a completed download or queue lyrics', async () => {
  mockAdd.mockRejectedValue(new Error('Disk full'));
  await runDownload();
  expect(mockUpdate).toHaveBeenCalledWith('job', expect.objectContaining({ status: 'failed', error: 'Disk full' }));
  expect(mockUpdate).not.toHaveBeenCalledWith('job', expect.objectContaining({ status: 'completed' }));
  expect(mockScan).not.toHaveBeenCalled();
});
