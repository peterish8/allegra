import { applyPlaylistMembershipChanges, canonicalSongRef, desiredPlaylistMembership, isSongAlreadySaved, routeSongToSaved, saveSelectedPlaylists } from './savedInBehavior';

describe('Saved sheet routing and playlist retry behavior', () => {
  it('routes a local song to Saved in by its local identity', () => {
    const navigate = jest.fn();
    expect(routeSongToSaved({ id: 'download-1', title: 'Offline song' }, navigate)).toBe(true);
    expect(navigate).toHaveBeenCalledWith({ name: 'AddToPlaylist', params: { songId: 'download-1' } });
  });

  it('routes a stream song with its available metadata so Saved can add non-current songs', () => {
    const navigate = jest.fn();
    expect(routeSongToSaved({ id: 'stream:gaana:g-1', title: 'Stream song', artist: 'Artist', duration: 204 }, navigate)).toBe(true);
    expect(navigate).toHaveBeenCalledWith({ name: 'AddToPlaylist', params: {
      songId: 'stream:gaana:g-1',
      songMetadata: { id: 'stream:gaana:g-1', title: 'Stream song', artist: 'Artist', duration: 204 },
    } });
  });

  it('does not open Saved in when the song has no usable title or id', () => {
    const navigate = jest.fn();
    expect(routeSongToSaved({ id: 'stream:saavn:x', title: '  ' }, navigate)).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('resolves canonical identity for downloaded and streamed forms', () => {
    expect(canonicalSongRef('download-1', { id: 'download-1', originId: 'gaana:g-1' })).toBe('gaana:g-1');
    expect(canonicalSongRef('stream:saavn:s-1')).toBe('saavn:s-1');
    expect(canonicalSongRef('download-2', { id: 'download-2', originId: 'not-a-ref' })).toBeNull();
  });

  it('keeps either local or online membership marked as already saved', () => {
    expect(isSongAlreadySaved(true, false)).toBe(true);
    expect(isSongAlreadySaved(false, true)).toBe(true);
    expect(isSongAlreadySaved(false, false)).toBe(false);
  });

  it('toggles an existing membership off and an absent one on until Done', () => {
    const existing = new Set(['liked', 'mix-a']);
    const changed = new Set(['liked', 'mix-b']);
    expect(desiredPlaylistMembership('liked', existing, changed)).toBe(false);
    expect(desiredPlaylistMembership('mix-a', existing, changed)).toBe(true);
    expect(desiredPlaylistMembership('mix-b', existing, changed)).toBe(true);
  });

  it('retains partial membership changes and stops when a write fails', async () => {
    const add = jest.fn(async (id: string) => { if (id === 'mix-b') throw new Error('offline'); });
    const remove = jest.fn(async () => undefined);
    const result = await applyPlaylistMembershipChanges(['mix-a', 'mix-b', 'mix-c'], new Set(), add, remove);
    expect(result).toEqual({ changed: [{ id: 'mix-a', present: true }], failed: true });
    expect(add.mock.calls.map(([id]) => id)).toEqual(['mix-a', 'mix-b']);
    expect(remove).not.toHaveBeenCalled();
  });

  it('retains a completed removal when a later removal fails', async () => {
    const add = jest.fn(async () => undefined);
    const remove = jest.fn(async (id: string) => { if (id === 'mix-b') throw new Error('offline'); });
    const result = await applyPlaylistMembershipChanges(['mix-a', 'mix-b'], new Set(['mix-a', 'mix-b']), add, remove);
    expect(result).toEqual({ changed: [{ id: 'mix-a', present: false }], failed: true });
    expect(remove.mock.calls.map(([id]) => id)).toEqual(['mix-a', 'mix-b']);
    expect(add).not.toHaveBeenCalled();
  });

  it('retries only failed playlist additions after a mixed save result', async () => {
    let failOnce = true;
    const calls: string[] = [];
    const save = jest.fn(async (id: string) => {
      calls.push(id);
      if (id === 'mix-b' && failOnce) {
        failOnce = false;
        throw new Error('temporary failure');
      }
    });
    const selected = ['mix-a', 'mix-b', 'mix-c'];

    const first = await saveSelectedPlaylists(selected, new Set(), save);
    expect(first).toEqual({ saved: ['mix-a'], failed: true });
    const retry = await saveSelectedPlaylists(selected, new Set(first.saved), save);

    expect(retry).toEqual({ saved: ['mix-b', 'mix-c'], failed: false });
    expect(calls.filter(id => id === 'mix-a')).toHaveLength(1);
    expect(calls).toEqual(['mix-a', 'mix-b', 'mix-b', 'mix-c']);
  });
});
