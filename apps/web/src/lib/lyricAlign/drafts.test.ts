import assert from 'node:assert/strict';
import test from 'node:test';
import type { LyricsSyncCandidate } from '@shared/lyricSync';
import type { UnifiedSong } from '@shared/types';
import { createLyricsSyncCoordinator, createLyricsSyncTarget, type AlignedVersion, type LyricsSyncJob } from './jobs.ts';
import { persistLyricsSyncDrafts, readLyricsSyncDrafts } from './drafts.ts';

const song: UnifiedSong = {
  id: 'draft-song', title: 'Draft Song', artist: 'Artist', artwork: 'https://example.test/art.jpg',
  streamUrl: '/api/stream/draft-song', duration: 180, hasLyrics: false, playCount: 0, source: 'Saavn'
};
const candidate: LyricsSyncCandidate = {
  id: 'draft-words', origin: 'site', source: 'Allegra', url: null, script: 'latin', language: 'en',
  lines: ['first lyric line', 'second lyric line'], synced: false
};
const version: AlignedVersion = {
  candidate, wordTimes: [
    { start: 1, end: 1.4 }, { start: 1.5, end: 2 }, { start: 2.1, end: 2.5 },
    { start: 3, end: 3.5 }, { start: 3.6, end: 4 }, { start: 4.1, end: 4.5 }
  ],
  lineConfidence: [0.9, 0.8], confidence: 0.88
};

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

function draft(status: 'ready' | 'saved' | 'failed' = 'ready'): LyricsSyncJob {
  const target = createLyricsSyncTarget(song, [candidate], false);
  return {
    id: `job-${status}`, target, status,
    progress: { stage: status === 'failed' ? 'Failed' : 'Ready to review', percent: 100, overall: 100 },
    ...(status === 'failed' ? { error: 'retry later' } : { versions: [version] }),
    createdAt: 123
  };
}

test('completed local previews restore as immutable review drafts with their original recording', () => {
  const storage = new MemoryStorage();
  persistLyricsSyncDrafts([draft('ready')], storage);
  const restored = readLyricsSyncDrafts(storage);

  assert.equal(restored.length, 1);
  assert.equal(restored[0]?.target.song.id, 'draft-song');
  assert.equal(restored[0]?.target.ref, draft().target.ref);
  assert.equal(restored[0]?.versions?.[0]?.candidate.lines[0], 'first lyric line');
  assert.ok(Object.isFrozen(restored[0]));
  assert.ok(Object.isFrozen(restored[0]?.versions?.[0]?.wordTimes));

  const coordinator = createLyricsSyncCoordinator({ run: async () => [] });
  coordinator.restore(restored);
  assert.equal(coordinator.getSnapshot()[0]?.status, 'ready');
  assert.equal(coordinator.getSnapshot()[0]?.target.song.id, 'draft-song');
});

test('only completed drafts persist; malformed data is ignored safely', () => {
  const storage = new MemoryStorage();
  persistLyricsSyncDrafts([draft('ready'), draft('failed')], storage);
  assert.deepEqual(readLyricsSyncDrafts(storage).map((job) => job.status), ['ready']);

  storage.setItem('allegra-lyric-sync-drafts-v1', '{bad json');
  assert.deepEqual(readLyricsSyncDrafts(storage), []);
});
