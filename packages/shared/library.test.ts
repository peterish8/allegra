import assert from 'node:assert/strict';
import test from 'node:test';

import {
  alignOpTimes,
  applyLibraryOps,
  isTombstone,
  itemKey,
  LIBRARY_SENT_AT_MAX_SKEW_MS,
  pageOfChanges,
  parseLibraryOps,
  parseSentAt,
  seedFromProfile,
  toChange,
  toProfileLibrary,
  type LibraryOp,
  type LibraryRowsView,
  type LikeRow,
  type PlaylistItemRow,
  type PlaylistRow
} from './library.ts';
import type { SongRef } from './songRef.ts';

/** An in-memory library that applies batches the way Convex and the API do. */
function library(seed?: { likes: LikeRow[]; playlists: PlaylistRow[]; items: PlaylistItemRow[]; rev: number }) {
  const likes = new Map<SongRef, LikeRow>();
  const playlists = new Map<string, PlaylistRow>();
  const items = new Map<string, PlaylistItemRow>();
  let rev = 0;
  if (seed) {
    seed.likes.forEach((r) => likes.set(r.ref, r));
    seed.playlists.forEach((r) => playlists.set(r.playlistId, r));
    seed.items.forEach((r) => items.set(itemKey(r.playlistId, r.ref), r));
    rev = seed.rev;
  }
  const view: LibraryRowsView = {
    like: (ref) => likes.get(ref),
    playlist: (id) => playlists.get(id),
    item: (id, ref) => items.get(itemKey(id, ref))
  };
  return {
    apply(ops: LibraryOp[], now = 1_000_000) {
      const write = applyLibraryOps(view, ops, { now, rev });
      write.likes.forEach((r) => likes.set(r.ref, r));
      write.playlists.forEach((r) => playlists.set(r.playlistId, r));
      write.items.forEach((r) => items.set(itemKey(r.playlistId, r.ref), r));
      rev = write.rev;
      return write;
    },
    profile: () => toProfileLibrary([...likes.values()], [...playlists.values()], [...items.values()]),
    rows: () => ({ likes: [...likes.values()], playlists: [...playlists.values()], items: [...items.values()] }),
    get rev() {
      return rev;
    }
  };
}

const A = 'saavn:a' as SongRef;
const B = 'saavn:b' as SongRef;
const G = 'gaana:g' as SongRef;

test('the newest change to a like wins, whatever order they arrive in', () => {
  const lib = library();
  lib.apply([{ op: 'unlike', ref: A, at: 200 }]);
  lib.apply([{ op: 'like', ref: A, at: 100 }]); // an offline phone's older like, arriving late
  assert.deepEqual(lib.profile().likedSongIds, []);
  lib.apply([{ op: 'like', ref: A, at: 300 }]);
  assert.deepEqual(lib.profile().likedSongIds, ['a']);
});

test('a time from the future is clamped to now', () => {
  const lib = library();
  lib.apply([{ op: 'like', ref: A, at: 9_999_999_999 }], 1000);
  lib.apply([{ op: 'unlike', ref: A, at: 1500 }], 2000); // later in real time, so it must win
  assert.deepEqual(lib.profile().likedSongIds, []);
});

test('liked songs keep the order they were first liked in', () => {
  const lib = library();
  lib.apply([
    { op: 'like', ref: B, at: 10 },
    { op: 'like', ref: A, at: 20 }
  ]);
  lib.apply([{ op: 'like', ref: B, at: 30 }]); // liking again does not move it
  assert.deepEqual(lib.profile().likedSongIds, ['b', 'a']);
});

test('a removal that arrives before its add still wins', () => {
  const lib = library();
  lib.apply([{ op: 'playlist_upsert', playlistId: 'p1', name: 'Road', at: 1 }]);
  lib.apply([{ op: 'playlist_remove', playlistId: 'p1', ref: A, at: 200 }]);
  lib.apply([{ op: 'playlist_add', playlistId: 'p1', ref: A, at: 100 }]);
  assert.deepEqual(lib.profile().libraries[0]?.songIds, []);
});

test('a batch can create a playlist and fill it; adding to a missing one is rejected', () => {
  const lib = library();
  const write = lib.apply([
    { op: 'playlist_upsert', playlistId: 'p1', name: 'Road', at: 1 },
    { op: 'playlist_add', playlistId: 'p1', ref: A, at: 2 },
    { op: 'playlist_add', playlistId: 'p1', ref: B, at: 3 },
    { op: 'playlist_add', playlistId: 'nope', ref: A, at: 4 },
    { op: 'playlist_upsert', playlistId: 'p2', at: 5 }
  ]);
  assert.deepEqual(write.rejected, [
    { index: 3, reason: 'no_playlist' },
    { index: 4, reason: 'missing_name' }
  ]);
  assert.deepEqual(lib.profile().libraries.map((l) => [l.id, l.name, l.songIds]), [['p1', 'Road', ['a', 'b']]]);
});

test('deleting a playlist frees its cover and hides it; recreating needs a name', () => {
  const lib = library();
  lib.apply([{ op: 'playlist_upsert', playlistId: 'p1', name: 'Road', cover: { key: 'k1', url: 'https://c/1' }, at: 1 }]);
  const swapped = lib.apply([{ op: 'playlist_upsert', playlistId: 'p1', cover: { key: 'k2', url: 'https://c/2' }, at: 2 }]);
  assert.deepEqual(swapped.removedCoverKeys, ['k1']);
  const deleted = lib.apply([{ op: 'playlist_delete', playlistId: 'p1', at: 3 }]);
  assert.deepEqual(deleted.removedCoverKeys, ['k2']);
  assert.deepEqual(lib.profile().libraries, []);
  assert.equal(lib.apply([{ op: 'playlist_upsert', playlistId: 'p1', isPublic: true, at: 4 }]).rejected[0]?.reason, 'missing_name');
});

test('only Saavn songs reach the profile; other refs stay in the rows', () => {
  const lib = library();
  lib.apply([
    { op: 'like', ref: G, at: 1 },
    { op: 'like', ref: A, at: 2 }
  ]);
  assert.deepEqual(lib.profile().likedSongIds, ['a']);
  assert.equal(lib.rows().likes.length, 2);
});

test('seeding from a profile reproduces it exactly, and any real change beats the seed', () => {
  const profile = {
    likedSongIds: ['x', 'y', 'x'],
    libraries: [
      { id: 'p1', name: 'Old', isPublic: false, songIds: ['y', 'x'], createdAt: '2026-09-01T00:00:00.000Z', coverKey: 'k', coverUrl: 'https://c' },
      { id: 'p2', name: 'Newer', description: 'd', isPublic: true, songIds: [], createdAt: '2026-09-02T00:00:00.000Z' }
    ]
  };
  const lib = library(seedFromProfile(profile));
  assert.deepEqual(lib.profile(), { ...profile, likedSongIds: ['x', 'y'] });
  lib.apply([{ op: 'unlike', ref: 'saavn:x' as SongRef, at: 1 }]);
  assert.deepEqual(lib.profile().likedSongIds, ['y']);
});

test('every changed row gets the next revision', () => {
  const lib = library();
  const write = lib.apply([
    { op: 'like', ref: A, at: 1 },
    { op: 'like', ref: B, at: 2 }
  ]);
  assert.deepEqual(write.likes.map((r) => r.rev), [1, 2]);
  assert.equal(lib.apply([{ op: 'like', ref: A, at: 0 }]).rev, 2); // older: nothing changes
});

test('paging the change feed never skips a row', () => {
  const lib = library();
  const ops: LibraryOp[] = [{ op: 'playlist_upsert', playlistId: 'p', name: 'P', at: 1 }];
  for (let i = 0; i < 7; i++) {
    ops.push({ op: 'like', ref: `saavn:l${i}` as SongRef, at: 10 + i });
    ops.push({ op: 'playlist_add', playlistId: 'p', ref: `saavn:i${i}` as SongRef, at: 20 + i });
  }
  lib.apply(ops);
  const { likes, playlists, items } = lib.rows();
  const seen: number[] = [];
  let since = 0;
  for (let guard = 0; guard < 20; guard++) {
    const read = (rows: { rev: number }[]) => rows.filter((r) => r.rev > since).sort((a, b) => a.rev - b.rev).slice(0, 4);
    const page = pageOfChanges([read(likes) as LikeRow[], read(playlists) as PlaylistRow[], read(items) as PlaylistItemRow[]], 4, lib.rev);
    seen.push(...page.changes.map((c) => c.rev));
    since = page.next;
    if (!page.more) break;
  }
  assert.deepEqual(seen, Array.from({ length: lib.rev }, (_, i) => i + 1));
});

test('device operations are checked, and covers are never taken from a device', () => {
  assert.equal(parseLibraryOps([]), null);
  assert.equal(parseLibraryOps([{ op: 'like', ref: 'spotify:1', at: 1 }]), null);
  assert.equal(parseLibraryOps([{ op: 'like', ref: 'saavn:1', at: -1 }]), null);
  assert.equal(parseLibraryOps([{ op: 'playlist_add', playlistId: '../x', ref: 'saavn:1', at: 1 }]), null);
  assert.equal(parseLibraryOps(Array.from({ length: 101 }, () => ({ op: 'unlike', ref: 'saavn:1', at: 1 }))), null);
  const ops = parseLibraryOps([
    { op: 'like', ref: 'SAAVN:abc', at: 5, song: { title: ' Song ', artist: 'A', artwork: 'http://insecure', duration: 200 } },
    { op: 'playlist_upsert', playlistId: 'p-1', name: '  Mix  ', cover: { key: 'k', url: 'https://x' }, description: '', at: 6 }
  ]);
  assert.deepEqual(ops, [
    { op: 'like', ref: 'saavn:abc', song: { ref: 'saavn:abc', title: 'Song', artist: 'A', artwork: '', duration: 200 }, at: 5 },
    { op: 'playlist_upsert', playlistId: 'p-1', name: 'Mix', description: null, at: 6 }
  ]);
});

test('a batch says which operations lost to something newer, and how many applied', () => {
  const lib = library();
  lib.apply([
    { op: 'like', ref: A, at: 500 },
    { op: 'playlist_upsert', playlistId: 'p1', name: 'Road', at: 500 },
    { op: 'playlist_add', playlistId: 'p1', ref: A, at: 500 }
  ]);
  const write = lib.apply([
    { op: 'unlike', ref: A, at: 400 }, // older than the like: lost
    { op: 'like', ref: B, at: 400 }, // nothing stored for B: applies
    { op: 'playlist_upsert', playlistId: 'p1', name: 'Older name', at: 100 }, // lost
    { op: 'playlist_remove', playlistId: 'p1', ref: A, at: 100 }, // lost
    { op: 'playlist_add', playlistId: 'nope', ref: A, at: 600 }, // refused, not superseded
    { op: 'playlist_delete', playlistId: 'never-existed', at: 600 }, // already so: neither
    { op: 'playlist_delete', playlistId: 'p1', at: 100 } // lost
  ]);
  assert.deepEqual(write.superseded, [0, 2, 3, 6]);
  assert.deepEqual(write.rejected, [{ index: 4, reason: 'no_playlist' }]);
  assert.equal(write.applied, 1);
  assert.equal(write.rev, 4); // three from the first batch, one from this
  assert.deepEqual(lib.profile().likedSongIds, ['b', 'a']); // B's like is dated before A's
  assert.deepEqual(lib.profile().libraries.map((l) => [l.name, l.songIds]), [['Road', ['a']]]);
});

test('a batch that applies cleanly has nothing superseded', () => {
  const write = library().apply([
    { op: 'like', ref: A, at: 10 },
    { op: 'unlike', ref: A, at: 10 } // same moment, later in the batch: still applies
  ]);
  assert.deepEqual(write.superseded, []);
  assert.equal(write.applied, 2);
});

test('a slow device clock is corrected by what it says the time was when it sent', () => {
  const received = 10_000_000;
  const slow = 5 * 60_000;
  // Made 3 s before sending, on a clock five minutes behind.
  const ops: LibraryOp[] = [{ op: 'unlike', ref: A, at: received - slow - 3000 }];
  assert.deepEqual(alignOpTimes(ops, received - slow, received), [{ op: 'unlike', ref: A, at: received - 3000 }]);
});

test('a fast device clock is corrected too, so it cannot outrank a change made after it', () => {
  const received = 10_000_000;
  const fast = 5 * 60_000;
  const ops: LibraryOp[] = [{ op: 'like', ref: A, at: received + fast - 60_000 }]; // really a minute ago
  assert.deepEqual(alignOpTimes(ops, received + fast, received), [{ op: 'like', ref: A, at: received - 60_000 }]);
});

test('no sentAt, or a clock within two seconds, leaves the batch exactly as sent', () => {
  const ops: LibraryOp[] = [{ op: 'like', ref: A, at: 123 }];
  assert.equal(alignOpTimes(ops, undefined, 10_000_000), ops);
  assert.equal(alignOpTimes(ops, 10_000_000 - 2000, 10_000_000), ops);
  assert.equal(alignOpTimes(ops, 10_000_000 + 2000, 10_000_000), ops);
  assert.notEqual(alignOpTimes(ops, 10_000_000 - 2001, 10_000_000), ops);
});

test('lying about sentAt buys at most "made just now", never the future', () => {
  const received = 10_000_000;
  // Claims the clock is an hour slow to push a fresh op an hour ahead.
  const pushed = alignOpTimes([{ op: 'like', ref: A, at: received }], received - 3_600_000, received);
  assert.equal(pushed[0]?.at, received);
  // An op dated after its own sentAt cannot get past the receive time either.
  const ahead = alignOpTimes([{ op: 'like', ref: A, at: received + 9_000_000 }], received + 60_000, received);
  assert.equal(ahead[0]?.at, received);
  // Claims the clock is far ahead: the op only gets older, and never negative.
  const buried = alignOpTimes([{ op: 'like', ref: A, at: 5 }], received + 3_600_000, received);
  assert.equal(buried[0]?.at, 0);

  // And the clamped op then loses to an honest change made later.
  const lib = library();
  lib.apply([...pushed], received);
  lib.apply([{ op: 'unlike', ref: A, at: received + 1 }], received + 10);
  assert.deepEqual(lib.profile().likedSongIds, []);
});

test('a sentAt that is not a plausible device clock is ignored', () => {
  const received = 1_790_000_000_000;
  assert.equal(parseSentAt(received - 300_000, received), received - 300_000);
  assert.equal(parseSentAt(received + 300_000, received), received + 300_000);
  for (const bad of [undefined, null, '1790000000000', {}, [], true, Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
    assert.equal(parseSentAt(bad, received), undefined, String(bad));
  }
  assert.equal(parseSentAt(received / 1000, received), undefined); // seconds, not milliseconds
  assert.equal(parseSentAt(48_213.5, received), undefined); // a monotonic timer
  assert.equal(parseSentAt(received * 1000, received), undefined); // microseconds
  assert.equal(parseSentAt(received - LIBRARY_SENT_AT_MAX_SKEW_MS - 1, received), undefined);
  assert.equal(parseSentAt(received + LIBRARY_SENT_AT_MAX_SKEW_MS + 1, received), undefined);
});

test('remembered deletes are told apart from what is in the library now', () => {
  const lib = library();
  lib.apply([
    { op: 'like', ref: A, at: 1 },
    { op: 'like', ref: B, at: 1 },
    { op: 'unlike', ref: B, at: 2 },
    { op: 'playlist_upsert', playlistId: 'p1', name: 'Road', at: 1 },
    { op: 'playlist_add', playlistId: 'p1', ref: A, at: 1 },
    { op: 'playlist_remove', playlistId: 'p1', ref: A, at: 2 },
    { op: 'playlist_upsert', playlistId: 'p2', name: 'Gone', at: 1 },
    { op: 'playlist_delete', playlistId: 'p2', at: 2 }
  ]);
  const { likes, playlists, items } = lib.rows();
  const current = [...likes, ...playlists, ...items].map(toChange).filter((change) => !isTombstone(change));
  assert.deepEqual(
    current.map((change) => [change.kind, 'ref' in change ? change.ref : change.playlistId]),
    [
      ['like', 'saavn:a'],
      ['playlist', 'p1']
    ]
  );
});
