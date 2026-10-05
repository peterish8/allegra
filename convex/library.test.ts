/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import presenceTest from '@convex-dev/presence/test';
import rateLimiterTest from '@convex-dev/rate-limiter/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from './_generated/api';
import schema from './schema';

const modules = {
  ...import.meta.glob('./**/*.ts'),
  ...import.meta.glob('./_generated/*.js')
};

const secret = 'test-server-secret';

function backend() {
  const t = convexTest(schema, modules);
  presenceTest.register(t);
  rateLimiterTest.register(t);
  return t;
}

const profile = (userId: string) => ({ userId, isGuest: false, createdAt: '2026-09-01T00:00:00.000Z', libraries: [], likedSongIds: [], recentlyPlayed: [], settings: {} });

describe('library origin', () => {
  beforeEach(() => vi.stubEnv('CONVEX_SERVER_SECRET', secret));
  afterEach(() => vi.unstubAllEnvs());

  it('keeps origin: import on likes and playlists through the change feed', async () => {
    const t = backend();
    await t.mutation(api.profiles.save, { secret, user: profile('asha') });
    await t.mutation(api.library.apply, {
      secret,
      userId: 'asha',
      ops: [
        { op: 'like', ref: 'saavn:a', origin: 'import', at: 100 },
        { op: 'like', ref: 'saavn:b', at: 100 },
        { op: 'playlist_upsert', playlistId: 'import-abc', name: 'Road trip', origin: 'import', at: 100 },
        { op: 'playlist_add', playlistId: 'import-abc', ref: 'saavn:a', at: 100 }
      ]
    });
    const page = await t.query(api.library.changes, { secret, userId: 'asha', since: 0, limit: 100 });
    const byKey = new Map(page.changes.map((change) => [change.kind === 'playlist' ? change.playlistId : `${change.kind}:${change.ref}`, change]));
    expect(byKey.get('like:saavn:a')).toMatchObject({ origin: 'import' });
    expect(byKey.get('like:saavn:b')).not.toHaveProperty('origin');
    expect(byKey.get('import-abc')).toMatchObject({ origin: 'import' });
    expect(byKey.get('playlist_item:saavn:a')).not.toHaveProperty('origin');

    // A like made in the app clears the import mark.
    await t.mutation(api.library.apply, { secret, userId: 'asha', ops: [{ op: 'like', ref: 'saavn:a', at: 200 }] });
    const after = await t.query(api.library.changes, { secret, userId: 'asha', since: page.rev, limit: 100 });
    expect(after.changes).toHaveLength(1);
    expect(after.changes[0]).not.toHaveProperty('origin');
  });

  it('recent likes and playlist songs come newest first, capped, without removals', async () => {
    const t = backend();
    await t.mutation(api.profiles.save, { secret, user: profile('ravi') });
    const likes = Array.from({ length: 60 }, (_, n) => ({ op: 'like' as const, ref: `saavn:l${n}`, at: 1000 + n }));
    await t.mutation(api.library.apply, { secret, userId: 'ravi', ops: likes });
    await t.mutation(api.library.apply, {
      secret,
      userId: 'ravi',
      ops: [
        { op: 'unlike', ref: 'saavn:l59', at: 5000 },
        { op: 'playlist_upsert', playlistId: 'p', name: 'P', at: 100 },
        { op: 'playlist_add', playlistId: 'p', ref: 'saavn:i1', at: 200 },
        { op: 'playlist_add', playlistId: 'p', ref: 'saavn:i2', at: 300 },
        { op: 'playlist_remove', playlistId: 'p', ref: 'saavn:i2', at: 400 }
      ]
    });
    const recent = await t.query(api.library.recentLikes, { secret, userId: 'ravi', limit: 5 });
    expect(recent.map((row) => row.ref)).toEqual(['saavn:l58', 'saavn:l57', 'saavn:l56', 'saavn:l55', 'saavn:l54']);
    expect((await t.query(api.library.recentLikes, { secret, userId: 'ravi', limit: 5000 })).length).toBe(59);
    expect((await t.query(api.library.recentItems, { secret, userId: 'ravi', limit: 300 })).map((row) => row.ref)).toEqual(['saavn:i1']);
  });
});
