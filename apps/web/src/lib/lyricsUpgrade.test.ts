import assert from 'node:assert/strict';
import test from 'node:test';

import type { LyricsPayload } from '@shared/types';
import { isLyricsUpgrade, LYRICS_UPGRADE_DELAYS_MS, wantsLyricsUpgrade } from './lyricsUpgrade.ts';

const payload = (type: LyricsPayload['type'], lines = 3): LyricsPayload => ({
  source: type === 'synced' ? 'LRCLIB' : 'JioSaavn',
  type,
  matchScore: 40,
  matchReason: '',
  lines: Array.from({ length: lines }, (_, i) => ({ timestamp: type === 'synced' ? i * 4 + 2 : 0, text: `Line ${i}` }))
});

test('JioSaavn plain words are replaced once synced lines turn up', () => {
  assert.equal(wantsLyricsUpgrade(payload('plain')), true);
  assert.equal(isLyricsUpgrade(payload('plain'), payload('synced')), true);
});

test('a missing answer is filled by plain or synced words', () => {
  assert.equal(wantsLyricsUpgrade(null), true);
  assert.equal(isLyricsUpgrade(null, payload('plain')), true);
  assert.equal(isLyricsUpgrade(payload('plain', 0), payload('plain')), true);
});

test('synced lines are kept and never swapped for plain, empty or another synced answer', () => {
  assert.equal(wantsLyricsUpgrade(payload('synced')), false);
  assert.equal(isLyricsUpgrade(payload('synced'), payload('plain')), false);
  assert.equal(isLyricsUpgrade(payload('synced'), payload('synced')), false);
  assert.equal(isLyricsUpgrade(payload('plain'), payload('plain')), false);
  assert.equal(isLyricsUpgrade(payload('plain'), payload('synced', 0)), false);
  assert.equal(isLyricsUpgrade(payload('plain'), null), false);
});

test('asks are few and spread out, so one song never polls for long', () => {
  assert.ok(LYRICS_UPGRADE_DELAYS_MS.length <= 4);
  assert.ok(LYRICS_UPGRADE_DELAYS_MS.every((ms, i) => i === 0 || ms > LYRICS_UPGRADE_DELAYS_MS[i - 1]!));
});
