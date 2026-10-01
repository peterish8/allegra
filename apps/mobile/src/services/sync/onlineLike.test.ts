import { DatabaseSync } from 'node:sqlite';
import type * as SQLite from 'expo-sqlite';

import type { SongSnapshot } from '@shared/songRef';
import { closeDatabase, initDatabase } from '../../database/db';
import { getOnlineLikes } from '../../database/syncQueries';
import { useOnlineLibraryStore } from '../../store/onlineLibraryStore';
import { toggleOnlineLike } from './onlineLike';

// The database is real (Node's SQLite behind Expo's async API, as in syncQueries.test.ts);
// only the hand-off to the sync outbox is observed.
const mockRecord = jest.fn();
jest.mock('./LibrarySync', () => ({ record: (...args: unknown[]) => mockRecord(...args) }));
const mockOpenDatabaseAsync = jest.fn();
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: (...args: unknown[]) => mockOpenDatabaseAsync(...args),
  deleteDatabaseAsync: jest.fn(),
}));

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
    closeAsync: async () => undefined,
  } as unknown as SQLite.SQLiteDatabase;
}

// The song another device is playing over Connect: the phone knows it only by its ref.
const remoteSong: SongSnapshot = {
  ref: 'saavn:uI4Kz-7H',
  title: 'FOREVER',
  artist: 'Stanley Xavier',
  artwork: 'https://img.example/forever.jpg',
  duration: 231,
};

beforeEach(async () => {
  nativeDb = new DatabaseSync(':memory:');
  mockOpenDatabaseAsync.mockResolvedValue(expoAdapter());
  mockRecord.mockClear();
  await initDatabase();
  await useOnlineLibraryStore.getState().load();
});

afterEach(async () => {
  await closeDatabase();
  nativeDb.close();
});

test('liking a song known only by its ref stores an online like and syncs it', async () => {
  await expect(toggleOnlineLike(remoteSong)).resolves.toBe('liked');

  expect(useOnlineLibraryStore.getState().likedRefs.has(remoteSong.ref)).toBe(true);
  expect((await getOnlineLikes()).map(row => row.ref)).toEqual([remoteSong.ref]);
  expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({ op: 'like', ref: remoteSong.ref, song: remoteSong }));
});

test('liking it again removes the like and syncs the unlike', async () => {
  await toggleOnlineLike(remoteSong);
  await expect(toggleOnlineLike(remoteSong)).resolves.toBe('unliked');

  expect(useOnlineLibraryStore.getState().likedRefs.has(remoteSong.ref)).toBe(false);
  expect(await getOnlineLikes()).toEqual([]);
  expect(mockRecord).toHaveBeenLastCalledWith(expect.objectContaining({ op: 'unlike', ref: remoteSong.ref }));
});
