import { DatabaseSync } from 'node:sqlite';
import type * as SQLite from 'expo-sqlite';

import { closeDatabase, getDatabase, initDatabase } from './db';
import { addSongToPlaylistWithOrder, getPlaylistSongs, removeSongFromPlaylist } from './playlistQueries';
import { getAllSongs, getOrphanPlaylistOnlySongIds, insertSong, setPlaylistOnly } from './queries';
import type { Song } from '../types/song';

// The real schema and SQL on Node's SQLite engine (as syncQueries.test.ts): only Expo's async bridge is replaced.
const mockOpenDatabaseAsync = jest.fn();
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: (...args: unknown[]) => mockOpenDatabaseAsync(...args),
  deleteDatabaseAsync: jest.fn(),
}));
jest.mock('expo-file-system/legacy', () => ({}));

type SqlValue = string | number | bigint | null | Uint8Array;
let nativeDb: DatabaseSync;

function expoAdapter(): SQLite.SQLiteDatabase {
  return {
    execAsync: async (sql: string) => { nativeDb.exec(sql); },
    runAsync: async (sql: string, params: readonly SqlValue[] = []) => {
      nativeDb.prepare(sql).run(...params);
      return {};
    },
    getFirstAsync: async <T>(sql: string, params: readonly SqlValue[] = []) =>
      nativeDb.prepare(sql).get(...params) as T | undefined,
    getAllAsync: async <T>(sql: string, params: readonly SqlValue[] = []) =>
      nativeDb.prepare(sql).all(...params) as T[],
    withTransactionAsync: async (task: () => Promise<void>) => { await task(); },
    closeAsync: async () => undefined,
  } as unknown as SQLite.SQLiteDatabase;
}

const NOW = '2026-11-06T00:00:00.000Z';
const song = (id: string, title: string, extra: Partial<Song> = {}): Song => ({
  id, title, artist: 'Mira Vale', gradientId: 'dynamic', duration: 200, dateCreated: NOW, dateModified: NOW, playCount: 0,
  audioUri: `file:///music/${id}/audio.m4a`, lyrics: [], ...extra,
});

beforeAll(async () => {
  nativeDb = new DatabaseSync(':memory:');
  mockOpenDatabaseAsync.mockResolvedValue(expoAdapter());
  await initDatabase();
});

beforeEach(async () => {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM playlist_songs');
  await db.runAsync('DELETE FROM lyrics');
  await db.runAsync('DELETE FROM playlists WHERE is_default = 0');
  await db.runAsync('DELETE FROM songs');
  await db.runAsync(
    "INSERT INTO playlists (id, name, is_default, sort_order, date_created, date_modified) VALUES ('sleep', 'Sleep', 0, 0, ?, ?)",
    [NOW, NOW],
  );
});

afterAll(async () => {
  await closeDatabase();
  nativeDb.close();
});

describe('offline playlists against SQLite (1.41.0)', () => {
  it('reads a playlist in its order, each song with its own lyrics, in two queries', async () => {
    await insertSong(song('a', 'First', { lyrics: [{ id: 1, timestamp: 1, text: 'a one', lineOrder: 0 }, { id: 2, timestamp: 2, text: 'a two', lineOrder: 1 }] }));
    await insertSong(song('b', 'Second', { lyrics: [{ id: 3, timestamp: 1, text: 'b one', lineOrder: 0 }] }));
    await insertSong(song('c', 'Not in it'));
    await addSongToPlaylistWithOrder('sleep', 'b', 0);
    await addSongToPlaylistWithOrder('sleep', 'a', 1);

    const songs = await getPlaylistSongs('sleep');
    expect(songs.map(s => s.id)).toEqual(['b', 'a']);
    expect(songs[0].lyrics.map(l => l.text)).toEqual(['b one']);
    expect(songs[1].lyrics.map(l => l.text)).toEqual(['a one', 'a two']);
    expect(await getPlaylistSongs('nothing')).toEqual([]);
  });

  it('keeps a playlist-only song on the phone but marked, and lets it become yours', async () => {
    await insertSong(song('po', 'Lullaby', { playlistOnly: true }));
    await addSongToPlaylistWithOrder('sleep', 'po', 0);
    expect((await getAllSongs()).find(s => s.id === 'po')?.playlistOnly).toBe(true);
    expect((await getPlaylistSongs('sleep'))[0].playlistOnly).toBe(true);

    await setPlaylistOnly('po', false);
    expect((await getAllSongs()).find(s => s.id === 'po')?.playlistOnly).toBe(false);
  });

  it('finds playlist-only songs no playlist holds any more, and never your own songs', async () => {
    await insertSong(song('po', 'Lullaby', { playlistOnly: true }));
    await insertSong(song('mine', 'Mine'));
    await addSongToPlaylistWithOrder('sleep', 'po', 0);
    expect(await getOrphanPlaylistOnlySongIds()).toEqual([]);

    await removeSongFromPlaylist('sleep', 'po');
    expect(await getOrphanPlaylistOnlySongIds()).toEqual(['po']);
  });
});
