import assert from 'node:assert/strict';
import test from 'node:test';

import type { ImportedTrack } from './importParse.ts';
import { runMatching, type MatchReply } from './importRun.ts';

const tracks = new Map<string, ImportedTrack>(Array.from({ length: 230 }, (_, n) => [`k${n}`, { title: `T${n}`, artist: 'A' }]));
const keys = [...tracks.keys()];
const song = { ref: 'saavn:x' as const, title: 'T', artist: 'A', artwork: '', duration: 1 };
const exact = (batch: ImportedTrack[]): MatchReply[] => batch.map((_, index) => ({ index, song, confidence: 'exact' }));
const tick = () => new Promise((resolve) => setTimeout(resolve, 2));

test('batches of 50, never more than 2 in flight, every key reported once', async () => {
  let inFlight = 0;
  let most = 0;
  const sizes: number[] = [];
  const seen: string[] = [];
  const outcome = await runMatching({
    keys, tracks, signal: new AbortController().signal,
    send: async (batch) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      sizes.push(batch.length);
      await tick();
      inFlight -= 1;
      return exact(batch);
    },
    onBatch: (results) => { seen.push(...results.map(([key]) => key)); }
  });
  assert.equal(outcome, 'done');
  assert.deepEqual(sizes.sort((a, b) => b - a), [50, 50, 50, 50, 30]);
  assert.equal(most, 2);
  assert.deepEqual(seen.sort(), [...keys].sort());
});

test('cancel stops new requests at once and ignores replies still in flight', async () => {
  const controller = new AbortController();
  let sent = 0;
  let reported = 0;
  const outcome = await runMatching({
    keys, tracks, signal: controller.signal,
    send: async (batch) => {
      sent += 1;
      controller.abort();
      await tick();
      return exact(batch);
    },
    onBatch: (results) => { reported += results.length; }
  });
  assert.equal(outcome, 'cancelled');
  assert.ok(sent <= 2);
  assert.equal(reported, 0);
});

test('a 429 waits for Retry-After and retries the same batch', async () => {
  const slept: number[] = [];
  let calls = 0;
  const outcome = await runMatching({
    keys: keys.slice(0, 50), tracks, signal: new AbortController().signal,
    send: async (batch) => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error('slow down'), { status: 429, retryAfterSeconds: 3 });
      return exact(batch);
    },
    onBatch: () => undefined,
    sleep: async (ms) => { slept.push(ms); }
  });
  assert.equal(outcome, 'done');
  assert.deepEqual(slept, [3000]);
  assert.equal(calls, 2);
});

test('a network failure ends the run as a resumable failure', async () => {
  const outcome = await runMatching({
    keys, tracks, signal: new AbortController().signal,
    send: async () => { throw Object.assign(new Error('offline'), { status: 0 }); },
    onBatch: () => undefined
  });
  assert.deepEqual(outcome, { failed: 'network' });
});

test('replies with no song come back as none and unaccepted', async () => {
  const results: [string, { confidence: string; accepted: boolean }][] = [];
  await runMatching({
    keys: ['k0', 'k1'], tracks, signal: new AbortController().signal,
    send: async () => [{ index: 0, song, confidence: 'close' }, { index: 1, song: null, confidence: 'none' }],
    onBatch: (batch) => { results.push(...batch); }
  });
  assert.deepEqual(results.map(([key, match]) => [key, match.confidence, match.accepted]), [['k0', 'close', true], ['k1', 'none', false]]);
});

test('transient per-track provider misses are retried and never checkpointed before final status', async () => {
  const reported: [string, { retryable?: boolean; song: unknown; accepted: boolean }][] = [];
  const sent: string[][] = [];
  await runMatching({
    keys: ['k0', 'k1'], tracks, signal: new AbortController().signal,
    send: async (batch) => {
      sent.push(batch.map((track) => track.title));
      if (sent.length === 1) return [
        { index: 0, song: null, confidence: 'none', retryable: true },
        { index: 1, song: null, confidence: 'none' }
      ];
      return [{ index: 0, song, confidence: 'exact' }];
    },
    onBatch: (batch) => { reported.push(...batch.map(([key, match]) => [key, match])); },
    sleep: async () => undefined
  });
  assert.deepEqual(sent, [['T0', 'T1'], ['T0']]);
  assert.deepEqual(reported.map(([key, match]) => [key, match.song !== null, match.retryable ?? false, match.accepted]), [
    ['k0', true, false, true], ['k1', false, false, false]
  ]);
});

test('a transient match still failing after bounded retries is skippable and marked for later retry', async () => {
  let calls = 0;
  let final: [string, { retryable?: boolean; accepted: boolean }][] = [];
  await runMatching({
    keys: ['k0'], tracks, signal: new AbortController().signal,
    send: async () => { calls += 1; return [{ index: 0, song: null, confidence: 'none', retryable: true }]; },
    onBatch: (batch) => { final = batch; },
    sleep: async () => undefined
  });
  assert.equal(calls, 1 + 2);
  assert.equal(final[0]?.[1].retryable, true);
  assert.equal(final[0]?.[1].accepted, false);
});
