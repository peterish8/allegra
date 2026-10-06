import assert from 'node:assert/strict';
import test from 'node:test';

import { createSpotifyTransfer, type TransferDeps } from './spotifyTransfer.ts';

const step = (n: number, complete: boolean) => ({ complete, added: n, skipped: 0, reviewNeeded: 0, libraryId: 'L' });
const deps = (sync: TransferDeps['sync'], landed: number[] = []): TransferDeps => ({
  sync,
  errorText: (error) => (error instanceof Error ? error.message : 'failed'),
  stopsRun: (error) => (error instanceof Error && error.message === 'auth' ? { reconnect: true } : null),
  onLanded: (added) => landed.push(added)
});

test('a run keeps going with nobody subscribed, and lands an arrival', async () => {
  const transfer = createSpotifyTransfer();
  const calls = new Map<string, number>();
  const landed: number[] = [];
  await transfer.start('me', [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], deps(async (id) => {
    const n = (calls.get(id) ?? 0) + 1;
    calls.set(id, n);
    return step(n * 5, n >= 2);
  }, landed));
  const state = transfer.getState();
  assert.equal(state.syncing, false);
  assert.deepEqual(state.arrival, { added: 20, notExact: 0 });
  assert.equal(state.runs.get('a')?.state, 'done');
  assert.deepEqual(landed, [20]);
  assert.equal(state.finishedAt, 1);
});

test('a failed source stays on its row and there is no arrival', async () => {
  const transfer = createSpotifyTransfer();
  await transfer.start('me', [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], deps(async (id) => {
    if (id === 'a') throw new Error('boom');
    return step(3, true);
  }));
  const state = transfer.getState();
  assert.equal(state.arrival, null);
  assert.deepEqual(state.runs.get('a'), { state: 'failed', message: 'boom' });
  assert.match(state.message, /3 songs added from 1 source/);
});

test('an authorization failure stops the whole run and asks to reconnect', async () => {
  const transfer = createSpotifyTransfer();
  let calls = 0;
  await transfer.start('me', [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], deps(async () => { calls += 1; throw new Error('auth'); }));
  assert.equal(calls, 1);
  assert.equal(transfer.getState().needsReconnect, true);
  assert.equal(transfer.getState().runs.get('b')?.state, 'waiting');
});

test('pause stops the run and keeps finished rows', async () => {
  const transfer = createSpotifyTransfer();
  let release: () => void = () => undefined;
  const running = transfer.start('me', [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], deps(async (id, signal) => {
    if (id === 'a') return step(4, true);
    await new Promise<void>((resolve) => { release = resolve; signal.addEventListener('abort', () => resolve()); });
    return step(1, false);
  }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(transfer.getState().syncing, true);
  transfer.pause();
  release();
  await running;
  const state = transfer.getState();
  assert.equal(state.syncing, false);
  assert.deepEqual([...state.runs.keys()], ['a']);
  assert.match(state.message, /Paused/);
});

test('another account stops and forgets the run; the same account keeps it', async () => {
  const transfer = createSpotifyTransfer();
  await transfer.start('me', [{ id: 'a', name: 'A' }], deps(async () => step(2, true)));
  transfer.useAccount('me');
  assert.ok(transfer.getState().arrival);
  transfer.useAccount('someone-else');
  assert.equal(transfer.getState().arrival, null);
  assert.equal(transfer.getState().runs.size, 0);
});
