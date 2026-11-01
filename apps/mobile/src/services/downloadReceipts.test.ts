import type { Song } from '../types/song';
import { parseReceipt, reconcileDownloadReceipts, songFromReceipt, type ReceiptStore } from './downloadReceipts';

const NOW = '2026-11-01T10:00:00.000Z';

function receiptJson(id: string, meta: Record<string, unknown> = { title: 'Tum Hi Ho', artist: 'Arijit Singh' }): string {
  return JSON.stringify({
    v: 1,
    id,
    audioUri: `file:///data/music/${id}/audio.mp3`,
    coverUri: null,
    meta: JSON.stringify(meta),
    finishedAtMs: 1,
  });
}

/** A phone where the library is a Map: the same contract the real SQLite store meets. */
function phone(receipts: string[], library: string[] = []): ReceiptStore & { library: Map<string, Song>; cleared: string[] } {
  const rows = new Map<string, Song>(library.map(id => [id, songFromReceipt(parseReceipt(receiptJson(id))!, NOW)]));
  const cleared: string[] = [];
  return {
    library: rows,
    cleared,
    pending: () => receipts.filter(json => !cleared.includes(parseReceipt(json)?.id ?? '')),
    hasSong: async id => rows.has(id),
    addSong: async song => {
      rows.set(song.id, song);
    },
    clear: id => {
      cleared.push(id);
    },
  };
}

describe('parseReceipt', () => {
  it('reads what the worker writes', () => {
    const receipt = parseReceipt(receiptJson('song-1', { title: 'Halo', artist: 'Beyonce', duration: 261, originId: 'saavn:x' }));
    expect(receipt).toEqual({
      id: 'song-1',
      audioUri: 'file:///data/music/song-1/audio.mp3',
      coverUri: null,
      meta: expect.objectContaining({ title: 'Halo', artist: 'Beyonce', duration: 261, originId: 'saavn:x' }),
    });
  });

  it('refuses a receipt with no id, no audio or no title', () => {
    expect(parseReceipt('not json')).toBeNull();
    expect(parseReceipt(JSON.stringify({ id: 'a', audioUri: '', meta: '{"title":"x"}' }))).toBeNull();
    expect(parseReceipt(receiptJson('a', { artist: 'no title' }))).toBeNull();
    expect(parseReceipt(JSON.stringify({ id: 'a', audioUri: 'file:///a', meta: 'not json' }))).toBeNull();
  });
});

describe('songFromReceipt', () => {
  it('builds the row a download made in the app gets, falling back to the remote cover', () => {
    const song = songFromReceipt(parseReceipt(receiptJson('song-1', {
      title: 'Halo', artist: 'Beyonce', duration: 261, coverFallback: 'https://img/1.jpg', coverRemoteUri: 'https://img/1.jpg',
    }))!, NOW);
    expect(song).toEqual(expect.objectContaining({
      id: 'song-1', title: 'Halo', artist: 'Beyonce', duration: 261, playCount: 0, lyrics: [],
      audioUri: 'file:///data/music/song-1/audio.mp3', coverImageUri: 'https://img/1.jpg', coverRemoteUri: 'https://img/1.jpg',
      dateCreated: NOW,
    }));
  });
});

describe('reconcileDownloadReceipts', () => {
  it('adds a row for a download that finished while the app was gone, and clears its receipt', async () => {
    const p = phone([receiptJson('song-1')]);
    await expect(reconcileDownloadReceipts(p, NOW)).resolves.toBe(1);
    expect([...p.library.keys()]).toEqual(['song-1']);
    expect(p.cleared).toEqual(['song-1']);
  });

  it('adds nothing twice: a second start, or a song already in the library, only clears', async () => {
    const p = phone([receiptJson('song-1'), receiptJson('song-2')], ['song-2']);
    await expect(reconcileDownloadReceipts(p, NOW)).resolves.toBe(1);
    await expect(reconcileDownloadReceipts(p, NOW)).resolves.toBe(0);
    expect([...p.library.keys()].sort()).toEqual(['song-1', 'song-2']);
    expect(p.cleared.sort()).toEqual(['song-1', 'song-2']);
  });

  it('keeps a receipt whose row could not be added, for the next start', async () => {
    const p = phone([receiptJson('song-1')]);
    p.addSong = async () => {
      throw new Error('SQLite busy');
    };
    await expect(reconcileDownloadReceipts(p, NOW)).resolves.toBe(0);
    expect(p.cleared).toEqual([]);
  });

  it('skips a receipt it cannot read', async () => {
    const p = phone(['{"v":1,"id":"', receiptJson('song-1')]);
    await expect(reconcileDownloadReceipts(p, NOW)).resolves.toBe(1);
  });
});
