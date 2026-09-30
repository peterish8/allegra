import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryUserStore } from '../user/store.js';
import type { SongSnapshot } from '../shared/songRef.js';
import { AuthService, bearerToken, mergeGuestInto } from './auth.js';
import { FirstMatchVerifier, GuestTokenVerifier } from './verifier.js';

const SECRET = 'test-secret-value-16';

function build(
  directory?: { identity: (userId: string) => Promise<{ email?: string; displayName?: string } | null> },
  songSnapshots?: (songIds: readonly string[]) => Promise<ReadonlyMap<string, SongSnapshot>>
) {
  const store = new MemoryUserStore();
  const guest = new GuestTokenVerifier(SECRET);
  const auth = new AuthService({
    store,
    guest,
    verifier: new FirstMatchVerifier(guest, {
      // Stands in for Convex Auth: any token starting with `convex:` is a signed-in account.
      verify: async (token) =>
        token.startsWith('convex:') ? { userId: token.slice('convex:'.length), source: 'convex' as const } : null
    }),
    ...(directory ? { directory } : {}),
    ...(songSnapshots ? { songSnapshots } : {})
  });
  return { auth, store };
}

test('a guest session is created, resolvable, and persisted', async () => {
  const { auth } = build();
  const guest = await auth.createGuest();
  const caller = await auth.resolveCaller(guest.token);
  assert.deepEqual(caller, { userId: guest.userId, source: 'guest' });

  const stored = await auth.getUser(guest.userId);
  assert.ok(stored?.isGuest);
});

test('bearer headers are parsed strictly', () => {
  assert.equal(bearerToken('Bearer abc'), 'abc');
  assert.equal(bearerToken('Token abc'), null);
  assert.equal(bearerToken(undefined), null);
  assert.equal(bearerToken('Bearer   '), null);
});

test('a junk token resolves to nobody', async () => {
  const { auth } = build();
  assert.equal(await auth.resolveCaller('not-a-jwt'), null);
});

test('the first Convex sign-in creates a profile carrying the Google identity', async () => {
  const { auth } = build({
    identity: async () => ({ email: 'asha@example.com', displayName: 'Asha' })
  });
  const caller = await auth.resolveCaller('convex:user_abc');
  assert.deepEqual(caller, { userId: 'user_abc', source: 'convex' });

  const profile = await auth.getUser('user_abc');
  assert.equal(profile?.isGuest, false);
  assert.equal(profile?.email, 'asha@example.com');
  assert.equal(profile?.displayName, 'Asha');
});

test('signing in again reuses the profile instead of resetting it', async () => {
  const { auth } = build({ identity: async () => ({ displayName: 'Asha' }) });
  await auth.resolveCaller('convex:user_abc');
  const profile = await auth.getUser('user_abc');
  assert.ok(profile);
  await auth.updateProfile('user_abc', (current) => ({ ...current, likedSongIds: ['song-1'] }));

  await auth.resolveCaller('convex:user_abc');
  assert.deepEqual((await auth.getUser('user_abc'))?.likedSongIds, ['song-1']);
});

test('a directory that fails still lets someone sign in', async () => {
  const { auth } = build({
    identity: async () => {
      throw new Error('convex unreachable');
    }
  });
  assert.equal((await auth.resolveCaller('convex:user_xyz'))?.userId, 'user_xyz');
  assert.equal((await auth.getUser('user_xyz'))?.isGuest, false);
});

test('signing in keeps what the browser did as a guest', async () => {
  const { auth } = build();
  const guest = await auth.createGuest();
  const asGuest = await auth.getUser(guest.userId);
  assert.ok(asGuest);
  await auth.updateProfile(guest.userId, (current) => ({ ...current, likedSongIds: ['song-1'], recentlyPlayed: [{ songId: 'song-1', playDuration: 30, playedAt: '2026-01-01T00:00:00.000Z' }] }));

  await auth.resolveCaller('convex:user_abc');
  await auth.linkGuest(guest.userId, 'user_abc');

  const account = await auth.getUser('user_abc');
  assert.deepEqual(account?.likedSongIds, ['song-1']);
  assert.equal(account?.recentlyPlayed.length, 1);
  assert.equal(account?.isGuest, false);
});

test('guest library merge attaches catalog snapshots to copied likes and playlist items', async () => {
  const details = new Map<string, SongSnapshot>([
    ['song-1', { ref: 'saavn:song-1', title: 'One', artist: 'Artist', artwork: '', duration: 180 }],
    ['song-2', { ref: 'saavn:song-2', title: 'Two', artist: 'Artist', artwork: '', duration: 200 }]
  ]);
  let lookedUp: readonly string[] = [];
  const { auth } = build(undefined, async (ids) => {
    lookedUp = ids;
    return details;
  });
  const guest = await auth.createGuest();
  await auth.updateProfile(guest.userId, (current) => ({
    ...current,
    likedSongIds: ['song-1'],
    libraries: [{ id: 'guest-list', name: 'Guest list', isPublic: false, songIds: ['song-2'], createdAt: '2026-01-01T00:00:00.000Z' }]
  }));
  await auth.resolveCaller('convex:user_abc');

  await auth.linkGuest(guest.userId, 'user_abc');

  assert.deepEqual(lookedUp, ['song-1', 'song-2']);
  const { changes } = await auth.library.changes('user_abc', 0, 500);
  const like = changes.find((change) => change.kind === 'like');
  assert.equal(like?.kind, 'like');
  if (like?.kind === 'like') assert.deepEqual(like.song, details.get('song-1'));
  const item = changes.find((change) => change.kind === 'playlist_item');
  assert.equal(item?.kind, 'playlist_item');
  if (item?.kind === 'playlist_item') assert.deepEqual(item.song, details.get('song-2'));
});

test('linking is idempotent and never merges an account into itself', async () => {
  const { auth } = build();
  const guest = await auth.createGuest();
  await auth.updateProfile(guest.userId, (current) => ({ ...current, likedSongIds: ['song-1'] }));
  await auth.resolveCaller('convex:user_abc');

  await auth.linkGuest(guest.userId, 'user_abc');
  await auth.linkGuest(guest.userId, 'user_abc');
  assert.deepEqual((await auth.getUser('user_abc'))?.likedSongIds, ['song-1']);

  await auth.linkGuest('user_abc', 'user_abc');
  assert.equal((await auth.getUser('user_abc'))?.isGuest, false);
});

test('merging never lets guest data overwrite the account identity', () => {
  const base = { createdAt: '2026-01-01T00:00:00.000Z', settings: {}, recentlyPlayed: [], libraries: [] };
  const merged = mergeGuestInto(
    { ...base, userId: 'account', isGuest: false, email: 'asha@example.com', displayName: 'Asha', likedSongIds: ['a'] },
    { ...base, userId: 'guest', isGuest: true, displayName: 'Guest', likedSongIds: ['b'] }
  );
  assert.equal(merged.userId, 'account');
  assert.equal(merged.displayName, 'Asha');
  assert.equal(merged.email, 'asha@example.com');
  assert.deepEqual(merged.likedSongIds.sort(), ['a', 'b']);
});
