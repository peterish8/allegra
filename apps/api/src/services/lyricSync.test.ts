import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryCacheStore } from '../lib/cache.js';
import { parseLyrics } from '../lib/lrc.js';
import type { UnifiedSong } from '../types.js';
import { LyricSyncService, rebuildLrc, type LyricSource } from './lyricSync.js';
import { MemoryVerifiedLyricsStore, type PastedLyrics } from './verifiedLyrics.js';

const song: UnifiedSong = { id: 'song', title: 'Song', artist: 'Singer', duration: 200, artwork: '', streamUrl: '/api/stream/song', hasLyrics: false, playCount: 0, source: 'Saavn' };
const source: LyricSource = { origin: 'site', source: { name: 'private-site', url: 'https://lyrics.example/song' },
  script: 'latin', language: 'ta', lines: ['First word', 'Second line'], synced: false };
const times = [{ start: 10, end: 11 }, { start: 12, end: 13 }, { start: 14, end: 15 }, { start: 16, end: 17 }];

function fixture() {
  const store = new MemoryVerifiedLyricsStore();
  let reads = 0;
  let current: LyricSource[] = [source];
  let invalidations = 0;
  const lyrics = { sources: async () => { reads++; return current; }, forgetVerified: async () => { invalidations++; } };
  const make = () => new LyricSyncService({ getSong: async () => song }, lyrics, store, new MemoryCacheStore());
  return { make, store, get reads() { return reads; }, get invalidations() { return invalidations; }, change: (sources: LyricSource[]) => { current = sources; } };
}

test('finder hides site provenance and a different instance reconstructs the exact words before saving', async () => {
  const f = fixture();
  const found = await f.make().sources('saavn:AbC');
  const candidate = found.candidates[0];
  assert.ok(candidate);
  assert.equal(candidate.source, 'Found online');
  assert.equal(candidate.url, null);
  assert.ok(!JSON.stringify(found).includes('lyrics.example'));
  assert.ok(!JSON.stringify(found).includes('private-site'));
  const result = await f.make().submit('saavn:AbC', [{ candidateId: candidate.id, script: 'latin', wordTimes: times, confidence: 0.9 }], 'listener');
  assert.equal(f.reads, 2, 'a cold instance re-fetches the canonical words');
  assert.equal(result.versions[0]?.saved, true);
  const stored = await f.store.get('saavn:AbC');
  assert.equal(stored?.versions[0]?.syncedBy, 'listener');
  assert.equal(stored?.versions[0]?.source.name, 'private-site');
  const parsed = parseLyrics(stored?.versions[0]?.lrc ?? '', 200);
  assert.deepEqual(parsed.map(line => line.text), source.lines);
  assert.deepEqual(parsed[0]?.words?.map(word => [word.start, word.end]), [[10, 11], [12, 13]]);
  assert.equal(f.invalidations, 1);
});

test('forged words, wrong scripts, stale IDs and IDs from another recording never save', async () => {
  const f = fixture();
  const found = await f.make().sources('saavn:AbC');
  const id = found.candidates[0]?.id;
  const version = { candidateId: id, script: 'latin', wordTimes: times, confidence: 0.9 };
  for (const versions of [[{ ...version, text: 'forged' }], [{ ...version, script: 'native' }], [{ ...version, wordTimes: times.slice(1) }]]) {
    await assert.rejects(f.make().submit('saavn:AbC', versions, 'listener'));
  }
  await assert.rejects(f.make().submit('saavn:abc', [version], 'listener'));
  f.change([{ ...source, lines: ['Words changed'] }]);
  await assert.rejects(f.make().submit('saavn:AbC', [version], 'listener'));
  assert.equal(await f.store.get('saavn:AbC'), null);
});

test('every selected version is checked before writing, and duplicate scripts are rejected', async () => {
  const f = fixture();
  f.change([source, { ...source, script: 'native', lines: ['தமிழ் வரி'] }]);
  const found = await f.make().sources('saavn:AbC');
  const good = { candidateId: found.candidates[0]?.id, script: 'latin', wordTimes: times, confidence: 0.9 };
  const bad = { candidateId: found.candidates[1]?.id, script: 'native', wordTimes: [], confidence: 0.9 };
  await assert.rejects(f.make().submit('saavn:AbC', [good, bad], 'listener'));
  await assert.rejects(f.make().submit('saavn:AbC', [good, good], 'listener'));
  assert.equal(await f.store.get('saavn:AbC'), null);
});

test('invalid, overlapping, negative and out-of-duration times, low confidence and excessive filler are refused', () => {
  for (const first of [{ start: -1, end: 1 }, { start: NaN, end: 1 }, { start: 1, end: Infinity }, { start: 1, end: 1 }, { start: 1, end: 201 }, { start: 1, end: 12.5 }]) {
    assert.throws(() => rebuildLrc(source.lines, [first, ...times.slice(1)], 200, 0.9));
  }
  assert.throws(() => rebuildLrc(source.lines, times, 200, 0.69));
  assert.throws(() => rebuildLrc(source.lines, times, 200, NaN));
  assert.throws(() => rebuildLrc(source.lines, times.map((time, i) => ({ ...time, filler: i === 0 })), 200, 0.9));
  const lines = Array.from({ length: 10 }, (_, i) => `Word${i}`);
  const aligned = lines.map((_, i) => ({ start: i, end: i + 0.5, filler: i < 3 }));
  assert.ok(rebuildLrc(lines, aligned, 200, 0.7), 'exactly 70% real lines is accepted');
});

test('equal or lower confidence preserves a live version, and three distinct reports hide it', async () => {
  const f = fixture();
  const api = f.make();
  const found = await api.sources('saavn:AbC');
  const version = { candidateId: found.candidates[0]?.id, script: 'latin', wordTimes: times, confidence: 0.9 };
  await api.submit('saavn:AbC', [version], 'listener');
  assert.equal((await api.submit('saavn:AbC', [{ ...version, confidence: 0.8 }], 'other')).versions[0]?.saved, false);
  assert.equal((await api.report('saavn:AbC', 'latin', 'a')).hidden, false);
  assert.equal((await api.report('saavn:AbC', 'latin', 'a')).hidden, false);
  assert.equal((await api.report('saavn:AbC', 'latin', 'b')).hidden, false);
  assert.equal((await api.report('saavn:AbC', 'latin', 'c')).hidden, true);
});

/** A shared store that also keeps admin-approved pastes, as Convex does (convex/verifiedLyrics.ts). */
class PastingStore extends MemoryVerifiedLyricsStore {
  public readonly pasted = new Map<string, PastedLyrics>();
  public async createPasted(candidate: PastedLyrics, passcode: string): Promise<boolean> {
    if (passcode !== 'right-passcode') return false;
    this.pasted.set(`${candidate.id}:${candidate.userId}:${candidate.ref}`, candidate);
    return true;
  }
  public async getPasted(id: string, ref: string, userId: string): Promise<PastedLyrics | null> {
    return this.pasted.get(`${id}:${userId}:${ref}`) ?? null;
  }
}

function pastingFixture() {
  const store = new PastingStore();
  const lyrics = { sources: async (): Promise<LyricSource[]> => [], forgetVerified: async () => undefined };
  return { store, make: () => new LyricSyncService({ getSong: async () => ({ ...song, language: 'tamil' }) }, lyrics, store, new MemoryCacheStore()) };
}

test('pasted words need the admin passcode, and a refusal stores nothing', async () => {
  const f = pastingFixture();
  await assert.rejects(f.make().paste('saavn:AbC', 'First word\nSecond line', 'wrong', 'listener'), /Passcode not accepted/);
  await assert.rejects(f.make().paste('saavn:AbC', '   ', 'right-passcode', 'listener'), /Enter lyrics/);
  await assert.rejects(f.make().paste('saavn:AbC', 'First word', '', 'listener'), /Enter lyrics/);
  assert.equal(f.store.pasted.size, 0);
});

test('pasting without the shared backend is refused instead of silently keeping words in memory', async () => {
  const lyrics = { sources: async (): Promise<LyricSource[]> => [], forgetVerified: async () => undefined };
  const api = new LyricSyncService({ getSong: async () => song }, lyrics, new MemoryVerifiedLyricsStore(), new MemoryCacheStore());
  await assert.rejects(api.paste('saavn:AbC', 'First word', 'right-passcode', 'listener'), /shared lyrics backend/);
});

test('native-script pastes are refused, since the alignment model reads Latin script only', async () => {
  const f = pastingFixture();
  await assert.rejects(f.make().paste('saavn:AbC', 'தமிழ் வரி', 'right-passcode', 'listener'), /romanized/);
});

test('approved words become a manual candidate that a cold instance syncs and shares, for that listener only', async () => {
  const f = pastingFixture();
  const candidate = await f.make().paste('saavn:AbC', 'First word\nSecond line', 'right-passcode', 'listener');
  assert.equal(candidate.origin, 'manual');
  assert.equal(candidate.synced, false);
  assert.equal(candidate.language, 'ta');
  assert.deepEqual(candidate.lines, ['First word', 'Second line']);
  assert.ok(![...f.store.pasted.values()].some(row => JSON.stringify(row).includes('right-passcode')), 'the passcode is never stored');
  const version = { candidateId: candidate.id, script: 'latin', wordTimes: times, confidence: 0.9 };
  await assert.rejects(f.make().submit('saavn:AbC', [version], 'someone-else'), 'another account cannot use the pasted words');
  const result = await f.make().submit('saavn:AbC', [version], 'listener');
  assert.equal(result.versions[0]?.saved, true);
  const stored = await f.store.get('saavn:AbC');
  assert.equal(stored?.versions[0]?.source.name, 'Admin-approved paste');
  assert.deepEqual(parseLyrics(stored?.versions[0]?.lrc ?? '', 200).map(line => line.text), candidate.lines);
});
