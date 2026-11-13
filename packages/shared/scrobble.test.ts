import assert from 'node:assert/strict';
import test from 'node:test';

import { SCROBBLE_RULES, isScrobbleEligible, retryDelaySec, scrobbleThresholdSec, scrobbleTimestamp } from './scrobble';

test('a track must be longer than 30 seconds to count at all', () => {
  assert.equal(scrobbleThresholdSec(30), null);
  assert.equal(scrobbleThresholdSec(29.9), null);
  assert.equal(scrobbleThresholdSec(Number.NaN), null);
  assert.equal(scrobbleThresholdSec(Number.POSITIVE_INFINITY), null);
  assert.equal(scrobbleThresholdSec(31), 15.5);
});

test('the threshold is half the track, capped at 4 minutes', () => {
  assert.equal(scrobbleThresholdSec(245), 122.5);
  assert.equal(scrobbleThresholdSec(480), 240);
  assert.equal(scrobbleThresholdSec(600), 240);
});

test('eligibility compares heard seconds with the threshold, inclusive at the threshold', () => {
  assert.equal(isScrobbleEligible({ durationSec: 245, heardSec: 122 }), false);
  assert.equal(isScrobbleEligible({ durationSec: 245, heardSec: 122.5 }), true);
  assert.equal(isScrobbleEligible({ durationSec: 600, heardSec: 239.9 }), false);
  assert.equal(isScrobbleEligible({ durationSec: 600, heardSec: 240 }), true);
  assert.equal(isScrobbleEligible({ durationSec: 30, heardSec: 1_000 }), false);
  assert.equal(isScrobbleEligible({ durationSec: 245, heardSec: Number.NaN }), false);
});

test('retry delays follow the table and repeat the last step', () => {
  assert.equal(retryDelaySec(1), 60);
  assert.equal(retryDelaySec(2), 300);
  assert.equal(retryDelaySec(5), 21_600);
  assert.equal(retryDelaySec(9), 21_600);
  assert.equal(retryDelaySec(0), 60);
  assert.deepEqual([...SCROBBLE_RULES.retryDelaysSec], [60, 300, 1_800, 7_200, 21_600]);
});

test('a listen keeps its start time in Unix seconds', () => {
  assert.equal(scrobbleTimestamp('2026-11-13T10:00:00.000Z', 200, Date.parse('2026-11-13T10:05:00Z')), 1_794_564_000);
});

test('a start time far in the future is replaced by now minus the heard seconds', () => {
  const now = Date.parse('2026-11-13T10:05:00Z');
  assert.equal(scrobbleTimestamp('2026-11-13T10:30:00Z', 200, now), 1_794_564_100);
});

test('a start time within the future slack is kept as sent', () => {
  const now = Date.parse('2026-11-13T10:05:00Z');
  assert.equal(scrobbleTimestamp('2026-11-13T10:09:00Z', 200, now), 1_794_564_540);
});

test('a listen older than 14 days is refused', () => {
  assert.equal(scrobbleTimestamp('2026-10-29T10:04:59Z', 200, Date.parse('2026-11-13T10:05:00Z')), null);
  assert.equal(scrobbleTimestamp('2026-10-30T10:05:00Z', 200, Date.parse('2026-11-13T10:05:00Z')), 1_793_354_700);
});

test('an unparseable start time or clock gives no timestamp', () => {
  assert.equal(scrobbleTimestamp('not a date', 200, Date.now()), null);
  assert.equal(scrobbleTimestamp('2026-11-13T10:00:00Z', 200, Number.NaN), null);
});
