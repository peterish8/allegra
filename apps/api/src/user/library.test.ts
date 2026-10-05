import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryLibraryStore } from './library.js';
import { MemoryUserStore, type UserData } from './store.js';

const profile = (overrides: Partial<UserData> = {}): UserData => ({
  userId: 'u1',
  isGuest: false,
  createdAt: '2026-09-01T00:00:00.000Z',
  libraries: [],
  likedSongIds: [],
  recentlyPlayed: [],
  settings: {},
  ...overrides
});

test('a whole-profile save made from an older read cannot undo a library change', async () => {
  const users = new MemoryUserStore();
  const library = new MemoryLibraryStore(users);
  await users.save(profile());

  const staleRead = await users.get('u1'); // e.g. a taste update that started before the like
  await library.apply('u1', [{ op: 'like', ref: 'saavn:a', at: Date.now() }]);
  assert.ok(staleRead);
  await users.save({ ...staleRead, settings: { theme: 'dark' } });

  const now = await users.get('u1');
  assert.deepEqual(now?.likedSongIds, ['a']);
  assert.deepEqual(now?.settings, { theme: 'dark' });
});

test("a listener's first sync sends the library they already had", async () => {
  const users = new MemoryUserStore();
  const library = new MemoryLibraryStore(users);
  await users.save(
    profile({
      likedSongIds: ['a', 'b'],
      libraries: [{ id: 'p1', name: 'Old list', isPublic: false, songIds: ['b'], createdAt: '2026-09-02T00:00:00.000Z' }]
    })
  );
  const page = await library.changes('u1', 0, 100);
  assert.deepEqual(
    page.changes.map((change) => [change.kind, 'ref' in change ? change.ref : change.playlistId]),
    [
      ['like', 'saavn:a'],
      ['like', 'saavn:b'],
      ['playlist', 'p1'],
      ['playlist_item', 'saavn:b']
    ]
  );
  assert.equal(page.more, false);
  // Unchanged by being moved into rows.
  assert.deepEqual((await users.get('u1'))?.likedSongIds, ['a', 'b']);
});

test('unknown listeners are refused rather than given an empty library', async () => {
  const library = new MemoryLibraryStore(new MemoryUserStore());
  await assert.rejects(library.apply('nobody', [{ op: 'like', ref: 'saavn:a', at: 1 }]));
});

test('pruned tombstones request a paged full resync and retention uses updatedAt', async () => {
  const now = Date.parse('2026-10-05T00:00:00.000Z');
  const users = new MemoryUserStore();
  const library = new MemoryLibraryStore(users, () => now);
  await users.save(profile());

  await library.apply('u1', [
    { op: 'like', ref: 'saavn:old', at: now - 91 * 24 * 60 * 60 * 1000 },
    { op: 'unlike', ref: 'saavn:old', at: now - 91 * 24 * 60 * 60 * 1000 + 1 },
    // This unlike has an old likedAt but a recent updatedAt, so the tombstone must stay.
    { op: 'like', ref: 'saavn:recent', at: now - 200 * 24 * 60 * 60 * 1000 },
    { op: 'unlike', ref: 'saavn:recent', at: now - 89 * 24 * 60 * 60 * 1000 },
    { op: 'like', ref: 'saavn:live-a', at: now - 1000 },
    { op: 'like', ref: 'saavn:live-b', at: now - 999 }
  ]);

  assert.equal(library.pruneTombstones(now - 90 * 24 * 60 * 60 * 1000), 1);

  const first = await library.changes('u1', 1, 1);
  const all = [...first.changes];
  let since = first.rev;
  let more: boolean = first.more;
  assert.equal(first.resync, true);
  assert.equal(first.more, true);
  assert.deepEqual(first.changes, []); // the first retained row is the 89-day tombstone

  while (more) {
    const page = await library.changes('u1', since, 1, true);
    assert.equal(page.resync, true);
    all.push(...page.changes);
    since = page.rev;
    more = page.more;
  }

  assert.deepEqual(all.filter((change) => change.kind === 'like').map((change) => change.ref), ['saavn:live-a', 'saavn:live-b']);
  assert.ok((await library.changes('u1', 3, 10)).changes.some((change) => change.kind === 'like' && !change.liked));
});
