import { DatabaseSync } from 'node:sqlite';
const mockSqlite = new DatabaseSync(':memory:');
mockSqlite.exec('CREATE TABLE generated_playlists (scope TEXT PRIMARY KEY, payload TEXT NOT NULL)');
const mockAdapter = {
  getFirstAsync: async (sql: string, params: string[]) => mockSqlite.prepare(sql).get(...params) ?? null,
  runAsync: async (sql: string, params: string[]) => mockSqlite.prepare(sql).run(...params),
};
let mockTail = Promise.resolve<unknown>(undefined);
jest.mock('./db', () => ({
  withDbRead: (run: (db: typeof mockAdapter) => Promise<unknown>) => { const work = mockTail.then(() => run(mockAdapter)); mockTail = work.catch(() => {}); return work; },
  withDbWrite: (run: (db: typeof mockAdapter) => Promise<unknown>) => { const work = mockTail.then(() => run(mockAdapter)); mockTail = work.catch(() => {}); return work; },
}));
import { readQuickPicks, writeQuickPicks, bookmarkQuickPicks } from './generatedPlaylistQueries';
import type { LiveQuickPicks } from '../services/stream/liveQuickPicks';
const entry: LiveQuickPicks = { scope: 'user-a', saved: false, songs: [], revision: 1, generatedAt: 1, daypart: 'morning', signal: 'one', source: 'account' };
beforeEach(() => mockSqlite.exec('DELETE FROM generated_playlists'));
afterAll(() => mockSqlite.close());
test('Bookmark writes and refreshes preserve each other in either order', async () => {
  await writeQuickPicks(entry);
  await Promise.all([bookmarkQuickPicks('user-a', true), writeQuickPicks({ ...entry, revision: 2 })]);
  expect(await readQuickPicks('user-a')).toMatchObject({ saved: true, revision: 2 });
  await Promise.all([writeQuickPicks({ ...entry, revision: 3 }), bookmarkQuickPicks('user-a', false)]);
  expect(await readQuickPicks('user-a')).toMatchObject({ saved: false, revision: 3 });
});
test('Saved playlists load by scope and cannot leak into another account', async () => {
  await writeQuickPicks(entry);
  await bookmarkQuickPicks('user-a', true);
  expect((await readQuickPicks('user-a'))?.saved).toBe(true);
  expect(await readQuickPicks('guest')).toBeUndefined();
});
