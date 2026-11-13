jest.mock('../services/DownloadManager', () => ({ downloadManager: { pauseDownload: jest.fn(), resumeDownload: jest.fn() } }));
jest.mock('../database/downloadQueueQueries', () => ({
  deleteJob: jest.fn(() => Promise.resolve()),
  updateJobStatus: jest.fn(() => Promise.resolve()),
  deleteCompletedJobs: jest.fn(() => Promise.resolve()),
}));

import { QueueItem, useDownloadQueueStore } from './downloadQueueStore';

const item = (id: string, title: string, artist: string, status: QueueItem['status']): QueueItem => ({
  id,
  song: { id, title, artist } as QueueItem['song'],
  status,
  progress: status === 'completed' ? 1 : 0,
});

const ids = (): string[] => useDownloadQueueStore.getState().queue.map(q => q.id);

describe('removeFinishedFor', () => {
  beforeEach(() => useDownloadQueueStore.setState({ queue: [] }));

  it('drops the finished download of a song that was deleted, so Download comes back', () => {
    useDownloadQueueStore.setState({ queue: [item('saavn:1', 'Tum Hi Ho', 'Arijit Singh', 'completed'), item('saavn:2', 'Kesariya', 'Arijit Singh', 'completed')] });
    useDownloadQueueStore.getState().removeFinishedFor({ title: 'Tum Hi Ho', artist: 'Arijit Singh' });
    expect(ids()).toEqual(['saavn:2']);
  });

  it('matches the way the library does: case, punctuation and extra credited artists do not matter', () => {
    useDownloadQueueStore.setState({ queue: [item('saavn:1', 'Tum Hi Ho', 'Arijit Singh', 'completed')] });
    useDownloadQueueStore.getState().removeFinishedFor({ title: 'tum hi ho', artist: 'Arijit Singh, Someone Else' });
    expect(ids()).toEqual([]);
  });

  it('matches by the catalog id too, when the title was edited after downloading', () => {
    useDownloadQueueStore.setState({ queue: [item('saavn:1', 'Tum Hi Ho', 'Arijit Singh', 'completed')] });
    useDownloadQueueStore.getState().removeFinishedFor({ title: 'Edited title', artist: 'Edited artist', originId: 'saavn:1' });
    expect(ids()).toEqual([]);
  });

  it('also clears a failed item, and never touches one that is still waiting or downloading', () => {
    useDownloadQueueStore.setState({
      queue: [
        item('a', 'Same', 'Band', 'failed'),
        item('b', 'Same', 'Band', 'downloading'),
        item('c', 'Same', 'Band', 'pending'),
        item('d', 'Same', 'Band', 'paused'),
      ],
    });
    useDownloadQueueStore.getState().removeFinishedFor({ title: 'Same', artist: 'Band' });
    expect(ids()).toEqual(['b', 'c', 'd']);
  });

  it('leaves other songs alone', () => {
    useDownloadQueueStore.setState({ queue: [item('x', 'Other', 'Else', 'completed')] });
    useDownloadQueueStore.getState().removeFinishedFor({ title: 'Deleted', artist: 'Band' });
    expect(ids()).toEqual(['x']);
  });
});
