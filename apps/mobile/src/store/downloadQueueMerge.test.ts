jest.mock('../services/DownloadManager', () => ({ downloadManager: { pauseDownload: jest.fn(), resumeDownload: jest.fn() } }));

import { mergeQueue, visibleDownloads, type QueueItem } from './downloadQueueStore';
import { libraryKeys, matchKey } from '../utils/downloadState';

const song = (id: string) => ({ id, title: `Song ${id}`, artist: 'Artist', highResArt: '', downloadUrl: 'u', source: 'Saavn' as const });
const queued = (id: string, over: Partial<QueueItem> = {}): QueueItem =>
  ({ id, song: song(id), status: 'pending', progress: 0, ...over });

describe('offline playlist downloads in the queue (1.41.0)', () => {
  it('queues a playlist download as playlist-only, with its playlist and order', () => {
    const { queue, added } = mergeQueue([], [song('a'), song('b')], 'sleep', [4, 5], true);
    expect(added.map(i => [i.id, i.playlistOnly, i.targetPlaylistId, i.sortOrder])).toEqual([['a', true, 'sleep', 4], ['b', true, 'sleep', 5]]);
    expect(queue).toHaveLength(2);
  });

  it('never queues a song twice, even listed twice in one request', () => {
    const { queue, added } = mergeQueue([queued('a')], [song('a'), song('b'), song('b')], undefined, undefined, false);
    expect(added.map(i => i.id)).toEqual(['b']);
    expect(queue.map(i => i.id)).toEqual(['a', 'b']);
  });

  it('a song you save that is already queued for a playlist becomes an ordinary download', () => {
    const { queue, upgraded, added } = mergeQueue([queued('a', { playlistOnly: true, targetPlaylistId: 'sleep' })], [song('a')], undefined, undefined, false);
    expect(added).toEqual([]);
    expect(upgraded.map(i => i.id)).toEqual(['a']);
    expect(queue[0]).toMatchObject({ playlistOnly: false, targetPlaylistId: 'sleep' });
  });

  it('a playlist asking for a song you already queued leaves it yours', () => {
    const { queue, upgraded } = mergeQueue([queued('a', { playlistOnly: false })], [song('a')], 'sleep', [0], true);
    expect(upgraded).toEqual([]);
    expect(queue[0].playlistOnly).toBe(false);
  });

  it('keeps playlist-only downloads out of the Downloads list', () => {
    expect(visibleDownloads([queued('a'), queued('b', { playlistOnly: true })]).map(i => i.id)).toEqual(['a']);
  });

  it('a playlist-only copy is not "in your Library", so its Download button can still save it', () => {
    const songs = [
      { title: 'Mine', artist: 'X', audioUri: 'file:///a' },
      { title: 'Theirs', artist: 'Y', audioUri: 'file:///b', playlistOnly: true },
    ];
    const keys = libraryKeys(songs);
    expect(keys.has(matchKey('Mine', 'X'))).toBe(true);
    expect(keys.has(matchKey('Theirs', 'Y'))).toBe(false);
  });
});
