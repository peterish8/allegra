import assert from 'node:assert/strict';
import test from 'node:test';

import type { ImportBundle } from '@shared/importParse';
import { stateFromCheckpoint, type ImportCheckpoint } from './importProgressStore.ts';

const bundle: ImportBundle = { source: 'csv', liked: [{ title: 'A', artist: 'X' }], playlists: [], skipped: 0, truncated: false };
const song = { ref: 'saavn:1' as const, title: 'A', artist: 'X', artwork: '', duration: 100 };
const base: ImportCheckpoint = {
  accountKey: 'account-a', fileHash: 'hash', updatedAt: 1, stage: 'review', bundle,
  selection: { includeLiked: true, playlists: [] },
  results: [['a|x', { key: 'a|x', track: bundle.liked[0]!, song, confidence: 'exact', accepted: false }]]
};

test('recovery reconstructs review decisions under the same account manifest', () => {
  const state = stateFromCheckpoint(base);
  assert.equal(state.step, 'review');
  assert.equal(state.selection.includeLiked, true);
  assert.equal(state.step === 'review' && state.results.get('a|x')?.accepted, false);
});

test('saving recovery retains stable chunks, timestamps, and acknowledged receipts', () => {
  const saving = stateFromCheckpoint({ ...base, stage: 'saving', chunks: [[{ op: 'like', ref: 'saavn:1', song, origin: 'import', at: 123 }]], sentAt: 456, acknowledged: [0], saved: 1, total: 1 });
  assert.equal(saving.step, 'saving');
  assert.equal(saving.step === 'saving' && saving.sentAt, 456);
  assert.deepEqual(saving.step === 'saving' && [...saving.acknowledged], [0]);
  assert.equal(saving.step === 'saving' && saving.chunks[0]?.[0]?.at, 123);
});
