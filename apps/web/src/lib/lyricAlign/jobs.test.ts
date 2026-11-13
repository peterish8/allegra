import assert from 'node:assert/strict';
import test from 'node:test';
import type { LyricsSyncCandidate } from '@shared/lyricSync';
import type { UnifiedSong } from '@shared/types';
import { createLyricsSyncCoordinator, createLyricsSyncTarget, type AlignedVersion } from './jobs.ts';

const songA: UnifiedSong = {
  id: 'track-a', title: 'Song A', artist: 'Artist A', artwork: 'https://example.test/a.jpg',
  streamUrl: '/api/stream/track-a', duration: 180, hasLyrics: false, playCount: 0, source: 'Saavn'
};
const songB: UnifiedSong = { ...songA, id: 'track-b', title: 'Song B', streamUrl: '/api/stream/track-b' };

function candidate(id: string, line = 'the original words'): LyricsSyncCandidate {
  return { id, origin: 'site', source: 'Allegra', url: null, script: 'latin', language: 'en', lines: [line], synced: false };
}

function version(value: LyricsSyncCandidate): AlignedVersion {
  return { candidate: value, wordTimes: [{ start: 1, end: 2 }, { start: 2.2, end: 3 }], lineConfidence: [0.9], confidence: 0.9 };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test('closing the picker leaves its app-owned job running and the result attached to song A', async () => {
  const pending = deferred<AlignedVersion[]>();
  let signal: AbortSignal | undefined;
  let currentSong = songA;
  let saves = 0;
  const target = createLyricsSyncTarget(songA, [candidate('a-lyrics')], false);
  const coordinator = createLyricsSyncCoordinator({
    run: async (_target, jobSignal) => { signal = jobSignal; return pending.promise; },
    save: async () => { saves += 1; return { versions: [{ script: 'latin', saved: true }] }; },
    createId: () => 'job-a'
  });

  const id = coordinator.enqueue(target);
  assert.equal(id, 'job-a');
  await settle();
  assert.ok(signal);
  currentSong = songB;
  // Closing the dialog has no coordinator cancellation path.
  assert.equal(signal.aborted, false);
  pending.resolve([version(target.candidates[0]!)]);
  await settle();

  const job = coordinator.getSnapshot().find((item) => item.id === id);
  assert.equal(job?.status, 'ready');
  assert.equal(job?.target.song.id, 'track-a');
  assert.equal(currentSong.id, 'track-b');
  assert.equal(saves, 0);
});

test('duplicate requests share one run and a second song waits for the active alignment', async () => {
  const runs: Array<{ targetId: string; pending: ReturnType<typeof deferred<AlignedVersion[]>> }> = [];
  const coordinator = createLyricsSyncCoordinator({
    run: (target) => {
      const pending = deferred<AlignedVersion[]>();
      runs.push({ targetId: target.song.id, pending });
      return pending.promise;
    },
    createId: (() => { let id = 0; return () => `job-${++id}`; })()
  });
  const a = createLyricsSyncTarget(songA, [candidate('a-lyrics')], false);
  const b = createLyricsSyncTarget(songB, [candidate('b-lyrics')], false);

  const first = coordinator.enqueue(a);
  assert.equal(coordinator.enqueue(a), first);
  const second = coordinator.enqueue(b);
  await settle();
  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.targetId, 'track-a');

  runs[0]!.pending.resolve([version(a.candidates[0]!)]);
  await settle();
  assert.equal(runs.length, 2);
  assert.equal(runs[1]?.targetId, 'track-b');
  runs[1]!.pending.resolve([version(b.candidates[0]!)]);
  await settle();
  assert.equal(coordinator.getSnapshot().find((job) => job.id === first)?.target.song.id, 'track-a');
  assert.equal(coordinator.getSnapshot().find((job) => job.id === second)?.target.song.id, 'track-b');
});

test('retry keeps the chosen words and explicit cancellation is separate from dismissal', async () => {
  const signals: AbortSignal[] = [];
  const targets: Array<Parameters<NonNullable<Parameters<typeof createLyricsSyncCoordinator>[0]['run']>>[0]> = [];
  let attempts = 0;
  const coordinator = createLyricsSyncCoordinator({
    run: (target, signal) => {
      attempts += 1;
      targets.push(target);
      signals.push(signal);
      if (attempts === 1) return Promise.reject(new Error('Model download failed. Please try again.'));
      return new Promise<AlignedVersion[]>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    },
    createId: () => 'retry-job'
  });
  const chosen = candidate('chosen-by-listener');
  const target = createLyricsSyncTarget(songA, [chosen], false);
  const id = coordinator.enqueue(target);
  await settle();
  assert.equal(coordinator.getSnapshot().find((job) => job.id === id)?.status, 'failed');

  coordinator.retry(id);
  await settle();
  assert.equal(attempts, 2);
  assert.equal(targets[0], target);
  assert.equal(targets[1], target);
  assert.equal(targets[1]?.candidates[0]?.id, 'chosen-by-listener');
  coordinator.cancel(id);
  await settle();
  assert.equal(signals[1]?.aborted, true);
  assert.equal(coordinator.getSnapshot().find((job) => job.id === id)?.status, 'cancelled');
});

test('an immediate retry survives a stale completion from the canceled run', async () => {
  const oldRun = deferred<AlignedVersion[]>();
  const target = createLyricsSyncTarget(songA, [candidate('retry-words')], false);
  let attempts = 0;
  const coordinator = createLyricsSyncCoordinator({
    run: () => ++attempts === 1 ? oldRun.promise : Promise.resolve([version(target.candidates[0]!)]),
    createId: () => 'cancel-retry-job'
  });
  const id = coordinator.enqueue(target);
  await settle();
  coordinator.cancel(id);
  coordinator.retry(id);
  oldRun.reject(new Error('stale canceled run failed'));
  await settle();
  await settle();

  assert.equal(attempts, 2);
  assert.equal(coordinator.getSnapshot().find((job) => job.id === id)?.status, 'ready');
});

test('model and alignment progress are observable, but saving only starts after an explicit request', async () => {
  const pending = deferred<AlignedVersion[]>();
  let saves = 0;
  const coordinator = createLyricsSyncCoordinator({
    run: async (_target, _signal, progress) => {
      progress({ stage: 'Downloading model', percent: 42, overall: 12 });
      progress({ stage: 'Syncing lyrics', percent: 18, overall: 53 });
      return pending.promise;
    },
    save: async () => { saves += 1; return { versions: [{ script: 'latin', saved: true }] }; },
    createId: () => 'progress-job'
  });
  const observedStatuses: string[] = [];
  coordinator.subscribe(() => {
    const job = coordinator.getSnapshot().find((item) => item.id === 'progress-job');
    if (job) observedStatuses.push(job.status);
  });
  const target = createLyricsSyncTarget(songA, [candidate('a-lyrics')], false);
  const id = coordinator.enqueue(target);
  await settle();
  const current = coordinator.getSnapshot().find((job) => job.id === id);
  assert.equal(current?.status, 'syncing');
  assert.deepEqual(current?.progress, { stage: 'Syncing lyrics', percent: 18, overall: 53 });
  assert.ok(observedStatuses.includes('downloading'));
  assert.ok(observedStatuses.includes('syncing'));
  assert.equal(saves, 0);

  pending.resolve([version(target.candidates[0]!)]);
  await settle();
  assert.equal(coordinator.getSnapshot().find((job) => job.id === id)?.status, 'ready');
  assert.equal(saves, 0);
  assert.equal(await coordinator.save(id), true);
  assert.equal(saves, 1);
  assert.equal(coordinator.getSnapshot().find((job) => job.id === id)?.status, 'saved');
});

test('target identity, art, stream and selected lyric lines are copied and frozen', () => {
  const mutableSong = { ...songA, title: 'Song A' };
  const mutableCandidate = { ...candidate('selected'), lines: ['one', 'two'] };
  const target = createLyricsSyncTarget(mutableSong, [mutableCandidate], true);
  mutableSong.title = 'Song B';
  mutableCandidate.lines[0] = 'different words';

  assert.equal(target.song.id, 'track-a');
  assert.equal(target.song.title, 'Song A');
  assert.equal(target.song.artwork, 'https://example.test/a.jpg');
  assert.equal(target.streamUrl, '/api/stream/track-a');
  assert.equal(target.candidates[0]?.lines[0], 'one');
  assert.ok(Object.isFrozen(target));
  assert.ok(Object.isFrozen(target.song));
  assert.ok(Object.isFrozen(target.candidates[0]?.lines));
});
