import assert from 'node:assert/strict';
import test from 'node:test';

import type { ImportBundle } from '@shared/importParse';
import type { LibraryOp } from '@shared/library';

import { importReducer, INITIAL_IMPORT, type ImportState, type MatchedTrack } from './importReducer.ts';

const bundle: ImportBundle = {
  source: 'csv',
  liked: [{ title: 'A', artist: 'X' }],
  playlists: [{ name: 'Road', tracks: [{ title: 'B', artist: 'Y' }] }],
  skipped: 0,
  truncated: false
};
const song = { ref: 'saavn:1' as const, title: 'A', artist: 'X', artwork: '', duration: 1 };
const match = (key: string, confidence: MatchedTrack['confidence']): MatchedTrack => ({
  key, track: { title: key, artist: 'X' }, song: confidence === 'none' ? null : song, confidence, accepted: confidence !== 'none'
});
const chunks: LibraryOp[][] = [[{ op: 'like', ref: 'saavn:1', song, origin: 'import', at: 123 }]];
const saveAction = { type: 'save' as const, runId: 1, total: 1, chunks, sentAt: 123, added: 1, already: 0, playlists: 0, unmatched: 0 };

function walk(...actions: Parameters<typeof importReducer>[1][]): ImportState {
  return actions.reduce(importReducer, INITIAL_IMPORT);
}

test('the happy path runs choose → reading → preview → matching → review → saving → done → choose', () => {
  let state = walk({ type: 'pick', fileName: 'x.csv' });
  assert.equal(state.step, 'reading');
  state = importReducer(state, { type: 'read', bundle, fileHash: 'h' });
  assert.equal(state.step, 'preview');
  assert.equal(state.step === 'preview' && state.selection.includeLiked, true);
  state = importReducer(state, { type: 'togglePlaylist', name: 'Road' });
  assert.equal(state.step === 'preview' && state.selection.playlists.has('Road'), false);
  state = importReducer(state, { type: 'toggleLiked' });
  state = importReducer(state, { type: 'toggleLiked' });
  state = importReducer(state, { type: 'startMatching', total: 2, runId: 1 });
  assert.equal(state.step, 'matching');
  state = importReducer(state, { type: 'matched', runId: 1, results: [['a', match('a', 'exact')], ['b', match('b', 'none')]] });
  assert.equal(state.step === 'matching' && state.done, 2);
  state = importReducer(state, { type: 'finishMatching' });
  assert.equal(state.step, 'review');
  state = importReducer(state, { type: 'accept', key: 'a', accepted: false });
  state = importReducer(state, { type: 'replace', key: 'b', song });
  assert.equal(state.step === 'review' && state.results.get('b')?.accepted, true);
  assert.equal(state.step === 'review' && state.results.get('a')?.accepted, false);
  state = importReducer(state, { ...saveAction, total: 4 });
  state = importReducer(state, { type: 'savedChunk', runId: 1, index: 0, count: 3 });
  assert.equal(state.step === 'saving' && state.saved, 3);
  state = importReducer(state, { type: 'finish', runId: 1, added: 1, already: 0, playlists: 1, unmatched: 0 });
  assert.equal(state.step, 'done');
  assert.equal(importReducer(state, { type: 'reset' }).step, 'choose');
});

test('a bad file goes to error(file) and back to choose', () => {
  const failed = walk({ type: 'pick', fileName: 'x.zip' }, { type: 'fail', kind: 'file', message: 'no', resumable: false });
  assert.deepEqual(failed, { step: 'error', kind: 'file', message: 'no', resumable: false });
  assert.equal(importReducer(failed, { type: 'reset' }).step, 'choose');
});

test('cancel returns to preview; a network failure while matching resumes at preview', () => {
  const matching = walk({ type: 'pick', fileName: 'x' }, { type: 'read', bundle, fileHash: 'h' }, { type: 'startMatching', total: 2, runId: 1 });
  assert.equal(importReducer(matching, { type: 'cancel' }).step, 'preview');
  const failed = importReducer(matching, { type: 'fail', kind: 'network', message: 'offline', resumable: true });
  assert.equal(failed.step, 'error');
  assert.equal(importReducer(failed, { type: 'resume' }).step, 'preview');
});

test('a reply from a superseded matching run cannot modify the active progress', () => {
  const preview = walk({ type: 'pick', fileName: 'x' }, { type: 'read', bundle, fileHash: 'h' });
  const active = importReducer(preview, { type: 'startMatching', total: 1, runId: 8 });
  const late = importReducer(active, { type: 'matched', runId: 7, results: [['a', match('a', 'exact')]] });
  assert.equal(late, active);
  assert.equal(late.step === 'matching' && late.results.size, 0);
});

test('a failure while saving is resumable network error', () => {
  const saving = walk(
    { type: 'pick', fileName: 'x' }, { type: 'read', bundle, fileHash: 'h' }, { type: 'startMatching', total: 0, runId: 1 },
    { type: 'finishMatching' }, saveAction
  );
  const failed = importReducer(saving, { type: 'saveFailed', runId: 1, message: 'offline' });
  assert.equal(failed.step === 'error' && failed.kind, 'network');
  if (failed.step === 'error' && failed.resume?.step === 'saving') {
    const stale = importReducer(failed.resume, { type: 'savedChunk', runId: 1, index: 0, count: 1 });
    assert.equal(stale, failed.resume);
  }
});

test('anything else leaves the state unchanged', () => {
  assert.equal(importReducer(INITIAL_IMPORT, saveAction), INITIAL_IMPORT);
  const preview = walk({ type: 'pick', fileName: 'x' }, { type: 'read', bundle, fileHash: 'h' });
  assert.equal(importReducer(preview, { type: 'matched', runId: 0, results: [] }), preview);
  const matching = importReducer(preview, { type: 'startMatching', total: 1, runId: 1 });
  assert.equal(importReducer(matching, saveAction), matching);
  const reading = walk({ type: 'pick', fileName: 'x' });
  assert.equal(importReducer(reading, { type: 'fail', kind: 'network', message: '', resumable: true }), reading);
});

test('a duplicate song in likes and the same selected playlist is matched once; recording versions remain distinct', async () => {
  const { selectedTracks } = await import('./importReducer.ts');
  const both: ImportBundle = {
    source: 'csv',
    liked: [{ title: 'Tum Hi Ho', artist: 'Arijit Singh' }],
    playlists: [
      { name: 'Road', tracks: [{ title: 'Tum Hi Ho', artist: 'Arijit Singh' }, { title: 'Kesariya', artist: 'Arijit Singh' }] },
      { name: 'Gym', tracks: [{ title: 'Other', artist: 'Someone' }] }
    ],
    skipped: 0,
    truncated: false
  };
  const tracks = selectedTracks(both, { includeLiked: true, playlists: new Set(['Road']) });
  assert.equal(tracks.size, 2);
  assert.equal(selectedTracks(both, { includeLiked: false, playlists: new Set() }).size, 0);
});
