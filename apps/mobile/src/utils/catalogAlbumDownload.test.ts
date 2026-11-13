import { albumDownloadState, albumPercent, type AlbumSong, type AlbumQueueItem } from './catalogAlbumDownload';
import { matchKey } from './downloadState';

const songs: AlbumSong[] = [
  { id: 'a', title: 'One', artist: 'Band' },
  { id: 'b', title: 'Two', artist: 'Band' },
  { id: 'c', title: 'Three', artist: 'Band' },
];
const item = (id: string, status: AlbumQueueItem['status'], progress = 0): AlbumQueueItem => ({ id, status, progress });
const none = new Set<string>();

describe('albumDownloadState', () => {
  it('is unavailable until the whole album has loaded', () => {
    expect(albumDownloadState(songs, [], none, false).phase).toBe('unavailable');
    expect(albumDownloadState([], [], none, true).phase).toBe('unavailable');
  });

  it('offers every song when nothing is saved', () => {
    const state = albumDownloadState(songs, [], none, true);
    expect(state.phase).toBe('idle');
    expect(state.missing.map(s => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('only offers the songs that are neither queued nor on the phone', () => {
    const library = new Set([matchKey('One', 'Band')]);
    const state = albumDownloadState(songs, [item('b', 'pending')], library, true);
    expect(state.missing.map(s => s.id)).toEqual(['c']);
    expect(state.saved).toBe(1);
    expect(state.phase).toBe('queued');
  });

  it('reports a partly saved album as partial, not downloaded', () => {
    const library = new Set([matchKey('One', 'Band')]);
    const state = albumDownloadState(songs, [], library, true);
    expect(state.phase).toBe('partial');
    expect(state.missing).toHaveLength(2);
  });

  it('shows downloaded only when every song is confirmed saved', () => {
    const onPhone = (...titles: string[]) => new Set(titles.map(title => matchKey(title, 'Band')));
    expect(albumDownloadState(songs, [item('a', 'completed'), item('b', 'completed'), item('c', 'downloading', 0.9)], onPhone('One', 'Two'), true).phase).toBe('downloading');
    expect(albumDownloadState(songs, [item('a', 'completed'), item('b', 'completed'), item('c', 'completed')], onPhone('One', 'Two', 'Three'), true).phase).toBe('saved');
  });

  it('does not call a finished download saved once the song is no longer in the library', () => {
    expect(albumDownloadState(songs, [item('a', 'completed'), item('b', 'completed'), item('c', 'completed')], none, true).phase).toBe('idle');
  });

  it('averages real progress across the album', () => {
    const library = new Set([matchKey('One', 'Band')]);
    const state = albumDownloadState(songs, [item('a', 'completed'), item('b', 'downloading', 0.5), item('c', 'pending')], library, true);
    expect(state.phase).toBe('downloading');
    expect(state.progress).toBeCloseTo((1 + 0.5 + 0) / 3);
    expect(albumPercent(songs, [item('a', 'completed'), item('b', 'downloading', 0.5), item('c', 'pending')], library)).toBe(50);
  });

  it('retries only the failed songs and keeps completed ones', () => {
    const library = new Set([matchKey('One', 'Band'), matchKey('Three', 'Band')]);
    const state = albumDownloadState(songs, [item('a', 'completed'), item('b', 'failed'), item('c', 'completed')], library, true);
    expect(state.phase).toBe('failed');
    expect(state.failed.map(s => s.id)).toEqual(['b']);
    expect(state.missing).toHaveLength(0);
  });

  it('keeps working while some fail and some still run', () => {
    const state = albumDownloadState(songs, [item('a', 'downloading', 0.2), item('b', 'failed')], none, true);
    expect(state.phase).toBe('downloading');
    expect(state.failed.map(s => s.id)).toEqual(['b']);
    expect(state.missing.map(s => s.id)).toEqual(['c']);
  });

  it('reads all-paused as paused', () => {
    expect(albumDownloadState(songs, [item('a', 'paused', 0.3), item('b', 'completed'), item('c', 'completed')], none, true).phase).toBe('paused');
  });
});
