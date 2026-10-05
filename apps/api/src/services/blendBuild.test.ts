import assert from 'node:assert/strict';
import test from 'node:test';

import type { ArtistFacts } from '../shared/blendTypes.js';
import type { SongRef, SongSnapshot } from '../shared/songRef.js';
import { MemoryBlendStore } from '../user/blendStore.js';
import type { LibraryEntry, LibraryStore } from '../user/library.js';
import { MemoryTasteTally } from '../user/tasteTally.js';
import type { UnifiedSong } from '../types.js';
import { BLEND_BUILD, BlendBuildService, type BlendBuildDeps } from './blendBuild.js';
import type { MatchResult } from './importMatch.js';

const consent = { policyVersion: '2026-10-05', at: 1 };
const snap = (source: 'saavn' | 'gaana', id: string, title: string, artist: string): SongSnapshot => ({ ref: `${source}:${id}` as SongRef, title, artist, artwork: '', duration: 200 });
const likes = (prefix: string, artist: string, count: number, source: 'saavn' | 'gaana' = 'saavn'): LibraryEntry[] =>
  Array.from({ length: count }, (_, n) => {
    const song = snap(source, `${prefix}${n}`, `${prefix} song ${n}`, artist);
    return { ref: song.ref, song, at: 1000 + n };
  });

interface Fixture {
  readonly service: BlendBuildService;
  readonly blends: MemoryBlendStore;
  readonly tally: MemoryTasteTally;
  readonly calls: { facts: number; suggestions: number; resolve: number; tallyTop: string[] };
  readonly logs: Record<string, number>[];
  setNow(ms: number): void;
}

function fixture(options: {
  library?: Record<string, { likes?: LibraryEntry[]; items?: LibraryEntry[] }>;
  failing?: boolean;
  failingLibrary?: boolean;
  beforeFacts?: () => Promise<void>;
  slow?: boolean;
  resolve?: (title: string) => SongSnapshot | null;
} = {}): Fixture {
  let now = Date.UTC(2026, 9, 5, 12);
  const calls = { facts: 0, suggestions: 0, resolve: 0, tallyTop: [] as string[] };
  const logs: Record<string, number>[] = [];
  const blends = new MemoryBlendStore(() => now);
  const tally = new MemoryTasteTally(() => now);
  const top = tally.top.bind(tally);
  tally.top = async (userId, limit) => {
    calls.tallyTop.push(userId);
    return top(userId, limit);
  };
  const library: LibraryStore = {
    apply: async () => { throw new Error('unused'); },
    changes: async () => { throw new Error('unused'); },
    recentLikes: async (userId) => { if (options.failingLibrary) throw new Error('library unavailable'); return options.library?.[userId]?.likes ?? []; },
    recentItems: async (userId) => options.library?.[userId]?.items ?? []
  };
  const hang = <T>(): Promise<T> => new Promise<T>(() => undefined);
  const deps: BlendBuildDeps = {
    blends,
    tally,
    library: () => library,
    facts: {
      facts: async (keys: readonly string[]) => {
        calls.facts += 1;
        await options.beforeFacts?.();
        if (options.slow) return hang();
        if (options.failing) throw new Error('down');
        return new Map(keys.map((key): [string, ArtistFacts] => [key, { key, popularity: 0.5, similar: [] }]));
      }
    },
    catalog: {
      getSuggestions: async (): Promise<UnifiedSong[]> => {
        calls.suggestions += 1;
        if (options.slow) return hang();
        if (options.failing) throw new Error('down');
        return [];
      },
      getSongs: async (): Promise<UnifiedSong[]> => {
        if (options.failing) throw new Error('down');
        return [];
      }
    },
    resolver: {
      match: async (tracks): Promise<MatchResult[]> => {
        calls.resolve += tracks.length;
        if (options.failing) throw new Error('down');
        return tracks.map((track, index) => {
          const song = options.resolve?.(track.title) ?? null;
          return { index, song, confidence: song ? 'exact' : 'none' };
        });
      }
    },
    now: () => now,
    log: (fields) => logs.push(fields),
    budgets: { budgetMs: 400, factsBudgetMs: 150 }
  };
  return { service: new BlendBuildService(deps), blends, tally, calls, logs, setNow: (ms) => { now = ms; } };
}

async function pairBlend(f: Fixture, learning = { asha: true, ravi: true }) {
  const created = await f.blends.create({ userId: 'asha', displayName: 'Asha Rao', name: 'Ours', consent, learning: learning.asha, code: 'abcdefghjkmn' });
  await f.blends.join({ code: 'abcdefghjkmn', userId: 'ravi', displayName: 'Ravi', consent, learning: learning.ravi });
  return created.blendId;
}

const shared = { asha: { likes: [...likes('a', 'Arijit Singh', 30), ...likes('s', 'Shared Band', 10)] }, ravi: { likes: [...likes('r', 'Pritam', 30), ...likes('s', 'Shared Band', 10)] } };

test('opening a Blend built yesterday rebuilds it for today', async () => {
  const f = fixture({ library: shared });
  const blendId = await pairBlend(f);
  const detail = await f.service.detailFor(blendId, 'asha');
  assert.equal(detail?.builtFor, '2026-10-05');
  assert.equal(detail?.state, 'ready');
  assert.equal(detail?.tracks.length, 50);
  assert.ok(detail?.tracks.some((track) => track.kind === 'shared'));
  assert.equal(detail?.members.find((member) => member.isYou)?.initials, 'AR');
  f.setNow(Date.UTC(2026, 9, 6, 1));
  const tomorrow = await f.service.detailFor(blendId, 'ravi');
  assert.equal(tomorrow?.builtFor, '2026-10-06');
});

test('opening a Blend already built today reads it and calls no provider', async () => {
  const f = fixture({ library: shared });
  const blendId = await pairBlend(f);
  await f.service.detailFor(blendId, 'asha');
  const before = { ...f.calls, tallyTop: f.calls.tallyTop.length };
  const again = await f.service.detailFor(blendId, 'ravi');
  assert.equal(again?.builtFor, '2026-10-05');
  assert.deepEqual({ ...f.calls, tallyTop: f.calls.tallyTop.length }, before);
  assert.equal(f.logs.length, 1);
});

test('two opens at once share one build lease and a later read sees that build', async () => {
  const f = fixture({ library: shared });
  const blendId = await pairBlend(f);
  const [first, second] = await Promise.all([f.service.detailFor(blendId, 'asha'), f.service.detailFor(blendId, 'ravi')]);
  const stored = await f.blends.get(blendId, 'asha');
  assert.equal(stored?.buildVersion, 1);
  assert.equal(f.logs.length, 1);
  assert.ok(first?.tracks.length === 50 || second?.tracks.length === 50);
  assert.deepEqual((await f.service.detailFor(blendId, 'ravi'))?.tracks, stored?.tracks);
});

test('a failed required library read preserves the previous build', async () => {
  const options = { library: shared, failingLibrary: false };
  const f = fixture(options);
  const blendId = await pairBlend(f);
  const previous = await f.service.detailFor(blendId, 'asha');
  f.setNow(Date.UTC(2026, 9, 6, 12));
  options.failingLibrary = true;
  const result = await f.service.detailFor(blendId, 'asha');
  assert.equal(result?.builtFor, previous?.builtFor);
  assert.equal(result?.status, 'refreshing');
  assert.equal((await f.blends.get(blendId, 'asha'))?.buildVersion, 1);
});

test('leaving while a provider is resolving prevents publication of departed member data', async () => {
  let blendId = '';
  const f = fixture({ library: shared, beforeFacts: async () => { await f.blends.leave(blendId, 'ravi'); } });
  blendId = await pairBlend(f);
  const result = await f.service.detailFor(blendId, 'asha');
  assert.equal(result?.members.length, 1);
  assert.equal(result?.status, 'waiting');
  assert.deepEqual(result?.tracks, []);
  assert.deepEqual(result?.pairs, []);
  assert.equal((await f.blends.get(blendId, 'asha'))?.buildVersion, 0);
});

test('disjoint tastes still request suggestions from each member', async () => {
  const f = fixture({ library: { asha: { likes: likes('a', 'Artist A', 25) }, ravi: { likes: likes('b', 'Artist B', 25) } } });
  const blendId = await pairBlend(f);
  await f.service.detailFor(blendId, 'asha');
  assert.equal(f.calls.suggestions, 2);
});

test('Gaana-only songs are resolved to Saavn or dropped and counted', async () => {
  const f = fixture({
    library: {
      asha: { likes: [...likes('a', 'Arijit Singh', 20), ...likes('g', 'Gaana Only', 4, 'gaana')] },
      ravi: { likes: likes('r', 'Pritam', 20) }
    },
    resolve: (title) => (title === 'g song 0' ? snap('saavn', 'resolved0', 'g song 0', 'Gaana Only') : null)
  });
  const blendId = await pairBlend(f);
  const detail = await f.service.detailFor(blendId, 'asha');
  const refs = detail?.tracks.map((track) => track.song.ref) ?? [];
  assert.ok(refs.every((ref) => ref.startsWith('saavn:')));
  assert.ok(refs.includes('saavn:resolved0'));
  assert.equal(f.logs[0]?.unresolved, 3);
});

test('with every provider failing a build still completes from library data', async () => {
  const f = fixture({ library: shared, failing: true });
  const blendId = await pairBlend(f);
  const detail = await f.service.detailFor(blendId, 'asha');
  assert.equal(detail?.tracks.length, 50);
  assert.equal(detail?.pairs.length, 1);
});

test('a member with learning off contributes no Now layer', async () => {
  const f = fixture({ library: shared });
  const blendId = await pairBlend(f, { asha: true, ravi: false });
  await f.tally.record('ravi', snap('saavn', 'x', 'Only In Tally', 'Tally Artist'), 200, Date.UTC(2026, 9, 5));
  const detail = await f.service.detailFor(blendId, 'asha');
  assert.deepEqual(f.calls.tallyTop, ['asha']);
  assert.ok(!detail?.tracks.some((track) => track.song.title === 'Only In Tally'));
  assert.equal(detail?.members.find((member) => member.userId === 'ravi')?.learning, false);
});

test('a slow provider cannot hold the build past its deadline', async () => {
  const f = fixture({ library: shared, slow: true });
  const blendId = await pairBlend(f);
  const started = Date.now();
  const detail = await f.service.detailFor(blendId, 'asha');
  assert.ok(Date.now() - started < 2000);
  assert.equal(detail?.tracks.length, 50);
});

test('a non-member gets null', async () => {
  const f = fixture({ library: shared });
  const blendId = await pairBlend(f);
  assert.equal(await f.service.detailFor(blendId, 'meera'), null);
});

test('the D6 seed uses native likes and playlist songs and the last listens, never imports', async () => {
  const f = fixture({
    library: {
      asha: {
        likes: [...likes('n', 'Native', 2), { ...likes('i', 'Imported', 1)[0] as LibraryEntry, origin: 'import' }],
        items: [{ ...likes('p', 'Imported Playlist', 1)[0] as LibraryEntry, origin: 'import' }]
      }
    }
  });
  await f.service.seedTally({
    userId: 'asha', isGuest: false, createdAt: '', libraries: [], likedSongIds: [], settings: {},
    recentlyPlayed: [{ songId: 'r', playDuration: 100, playedAt: new Date(Date.UTC(2026, 9, 4)).toISOString(), song: snap('saavn', 'r', 'Recent', 'Someone') }]
  });
  const titles = (await f.tally.top('asha', 200)).map((row) => row.title).sort();
  assert.deepEqual(titles, ['Recent', 'n song 0', 'n song 1']);
});

test('a six-member Blend builds inside the budget, reading at most 1,500 rows per member', async () => {
  const names = ['asha', 'ravi', 'meera', 'kabir', 'zoya', 'dev'];
  const artists = ['Arijit Singh', 'Pritam', 'Shreya Ghoshal', 'Diljit Dosanjh', 'A. R. Rahman', 'Atif Aslam'];
  const library = Object.fromEntries(names.map((name, n) => [name, { likes: [...likes(`${name}-`, artists[n] ?? 'X', 40), ...likes('shared-', 'Shared Band', 10)], items: likes(`${name}-p`, artists[(n + 1) % 6] ?? 'X', 20) }]));
  const f = fixture({ library });
  const created = await f.blends.create({ userId: 'asha', displayName: 'Asha', name: 'Group', consent, learning: true, code: 'abcdefghjkmn' });
  for (const name of names.slice(1)) await f.blends.join({ code: 'abcdefghjkmn', userId: name, displayName: name, consent, learning: true });
  const started = Date.now();
  const detail = await f.service.detailFor(created.blendId, 'asha');
  const elapsed = Date.now() - started;
  assert.equal(detail?.members.length, 6);
  assert.equal(detail?.pairs.length, 15);
  assert.equal(detail?.tracks.length, 50);
  assert.deepEqual(detail?.stories.map((story) => story.kind), ['groupMatch', 'mostInTune', 'leastInTune', 'glue']);
  assert.ok(elapsed < 8000, `${elapsed} ms`);
  assert.equal(BLEND_BUILD.tallyRead + BLEND_BUILD.likesRead + BLEND_BUILD.itemsRead, 1500);
});
