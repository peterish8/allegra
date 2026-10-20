import assert from 'node:assert/strict';
import test from 'node:test';
import type { LyricsPayload } from '@shared/types';
import { syncedUpgrade } from './lyricsUpgrade';

const payload = (source: string, type: LyricsPayload['type'], matchScore: number, lines = 2): LyricsPayload => ({
  source, type, matchScore, matchReason: '', lines: Array.from({ length: lines }, (_, i) => ({ text: `line ${i}`, timestamp: i * 4, lineOrder: i }))
});

test('plain words give way to the best synced version, Allegra listener syncs first', () => {
  const lrclib = payload('LRCLIB', 'synced', 60);
  const lyrica = payload('Lyrica(synced-slow)', 'synced', 50);
  assert.equal(syncedUpgrade([payload('JioSaavn', 'plain', 30), lyrica, lrclib]), lrclib);
  const allegra = payload('Allegra (English)', 'synced', 40);
  assert.equal(syncedUpgrade([lrclib, allegra]), allegra);
});

test('no synced alternative, or an empty one, keeps the plain words', () => {
  assert.equal(syncedUpgrade([payload('Found online', 'plain', 30)]), null);
  assert.equal(syncedUpgrade([payload('LRCLIB', 'synced', 90, 0)]), null);
  assert.equal(syncedUpgrade([]), null);
});
