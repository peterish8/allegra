jest.mock('../DownloadManager', () => ({ downloadManager: { pauseDownload: jest.fn(), resumeDownload: jest.fn() } }));
jest.mock('../../database/downloadQueueQueries', () => ({ insertJob: jest.fn(() => Promise.resolve()), updateJobStatus: jest.fn(() => Promise.resolve()) }));

jest.mock('../../store/songsStore', () => {
  const { create } = jest.requireActual('zustand');
  return { useSongsStore: create(() => ({ songs: [] })) };
});

import { useDownloadQueueStore } from '../../store/downloadQueueStore';
import { useSongsStore } from '../../store/songsStore';
import type { UnifiedSong } from '../../types/song';
import { startCatalogAlbumDownload } from './albumDownload';

const song = (id: string): UnifiedSong => ({ id, title: `Song ${id}`, artist: 'Band', highResArt: '', downloadUrl: '', source: 'Saavn' });
const album = [song('a'), song('b'), song('c')];

beforeEach(() => {
  useDownloadQueueStore.setState({ queue: [] });
  useSongsStore.setState({ songs: [] });
});

describe('startCatalogAlbumDownload', () => {
  it('queues every song of an album once', () => {
    expect(startCatalogAlbumDownload(album, true)).toEqual({ queued: 3, retried: 0 });
    expect(useDownloadQueueStore.getState().queue.map(q => q.id)).toEqual(['a', 'b', 'c']);
  });

  it('does nothing before the album has fully loaded', () => {
    expect(startCatalogAlbumDownload(album, false)).toEqual({ queued: 0, retried: 0 });
    expect(useDownloadQueueStore.getState().queue).toHaveLength(0);
  });

  it('ignores rapid repeat taps', () => {
    startCatalogAlbumDownload(album, true);
    expect(startCatalogAlbumDownload(album, true)).toEqual({ queued: 0, retried: 0 });
    startCatalogAlbumDownload(album, true);
    expect(useDownloadQueueStore.getState().queue).toHaveLength(3);
  });

  it('queues only the songs that are missing', () => {
    useSongsStore.setState({ songs: [{ id: 'local-a', title: 'Song a', artist: 'Band', audioUri: 'file:///a.mp3' } as never] });
    useDownloadQueueStore.getState().addToQueue([album[1]]);
    expect(startCatalogAlbumDownload(album, true)).toEqual({ queued: 1, retried: 0 });
    expect(useDownloadQueueStore.getState().queue.map(q => q.id).sort()).toEqual(['b', 'c']);
  });

  it('retries only failed songs and leaves completed ones alone', () => {
    useDownloadQueueStore.getState().addToQueue(album);
    useDownloadQueueStore.setState(state => ({
      queue: state.queue.map(q => (q.id === 'a' ? { ...q, status: 'completed' as const, progress: 1 } : q.id === 'b' ? { ...q, status: 'failed' as const } : q)),
    }));
    expect(startCatalogAlbumDownload(album, true)).toEqual({ queued: 0, retried: 1 });
    const queue = useDownloadQueueStore.getState().queue;
    expect(queue.find(q => q.id === 'a')?.status).toBe('completed');
    expect(queue.find(q => q.id === 'b')?.status).toBe('pending');
  });
});
