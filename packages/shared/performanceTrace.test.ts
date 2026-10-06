import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPerformanceTrace,
  type PerformanceTraceDetails,
} from './performanceTrace';

test('disabled traces do not call the clock or retain diagnostic state', () => {
  let clockCalls = 0;
  const trace = createPerformanceTrace({
    enabled: false,
    platform: 'web',
    now: () => { clockCalls += 1; return 12; },
  });

  assert.equal(trace.enabled, false);
  assert.equal(trace.beginAttempt('web.search-to-play', 1), null);
  assert.equal(trace.getActiveAttempt('web.search-to-play'), null);
  assert.deepEqual(trace.exportRecords(), []);
  assert.equal(clockCalls, 0);
});

test('records elapsed time from the injected monotonic clock and exports only allowlisted details', () => {
  let now = 100;
  const trace = createPerformanceTrace({ enabled: true, platform: 'web', now: () => now });
  const attempt = trace.beginAttempt('web.search-to-play', 4, { scenario: 'online' });
  assert.ok(attempt);

  now = 121;
  assert.equal(trace.record(attempt, 'search.dispatched'), true);
  now = 175;
  const unsafeDetails = {
    durationMs: 54,
    resultCount: 3,
    cache: 'warm',
    query: 'private query text',
    url: 'https://private.invalid/audio',
  } as unknown as PerformanceTraceDetails;
  assert.equal(trace.record(attempt, 'catalog.completed', unsafeDetails), true);
  now = 180;
  assert.equal(trace.finish(attempt, 'empty', unsafeDetails), true);

  const records = trace.exportRecords();
  assert.deepEqual(records.map(({ event, elapsedMs }) => [event, elapsedMs]), [
    ['search.dispatched', 21],
    ['catalog.completed', 75],
    ['attempt.finished', 80],
  ]);
  assert.equal(records[1]?.resultCount, 3);
  assert.equal(records[1]?.durationMs, 54);
  assert.equal(records[1]?.cache, 'warm');
  assert.equal(records[1]?.scenario, 'online');
  assert.equal(JSON.stringify(records).includes('private query text'), false);
  assert.equal(JSON.stringify(records).includes('private.invalid'), false);
  assert.equal(trace.finish(attempt, 'success'), false);
});

test('a new attempt supersedes its scope and rejects late callbacks from the old generation', () => {
  let now = 0;
  const trace = createPerformanceTrace({ enabled: true, platform: 'android', now: () => now });
  const first = trace.beginAttempt('android.search.online', 10, { scenario: 'online' });
  assert.ok(first);
  now = 30;
  assert.equal(trace.record(first, 'search.dispatched'), true);

  now = 40;
  const second = trace.beginAttempt('android.search.online', 11, { scenario: 'online' });
  assert.ok(second);
  assert.equal(trace.getActiveAttempt('android.search.online'), second);
  assert.equal(trace.record(first, 'catalog.completed', { resultCount: 99 }), false);
  assert.equal(trace.finish(first, 'success'), false);
  assert.equal(trace.record(second, 'catalog.completed', { resultCount: 2 }), true);

  const records = trace.exportRecords();
  const firstRecords = records.filter((record) => record.attemptId === first.attemptId);
  assert.deepEqual(firstRecords.map((record) => record.event), ['search.dispatched', 'attempt.finished']);
  assert.equal(firstRecords[1]?.outcome, 'superseded');
  assert.equal(firstRecords.every((record) => record.generation === 10), true);
});

test('duplicate readiness and playback observations are ignored for the same attempt', () => {
  let now = 5;
  const trace = createPerformanceTrace({ enabled: true, platform: 'web', now: () => now });
  const attempt = trace.beginAttempt('web.search-to-play', 1);
  assert.ok(attempt);

  now = 10;
  assert.equal(trace.record(attempt, 'media.ready'), true);
  now = 12;
  assert.equal(trace.record(attempt, 'media.ready'), false);
  assert.equal(trace.record(attempt, 'playback.observed'), true);
  now = 15;
  assert.equal(trace.record(attempt, 'playback.observed'), false);
  assert.deepEqual(trace.exportRecords().map((record) => record.event), ['media.ready', 'playback.observed']);
});

test('the buffer keeps only the latest 250 records and exports defensive copies', () => {
  let now = 1;
  const trace = createPerformanceTrace({ enabled: true, platform: 'web', now: () => now });
  const attempt = trace.beginAttempt('web.search-to-play', 2);
  assert.ok(attempt);

  for (let index = 0; index < 260; index += 1) {
    now += 1;
    assert.equal(trace.record(attempt, 'query.changed'), true);
  }
  const records = trace.exportRecords();
  assert.equal(records.length, 250);
  assert.equal(records[0]?.elapsedMs, 11);
  assert.equal(records.at(-1)?.elapsedMs, 260);
  (records as PerformanceTraceDetails[]).push({ resultCount: 500 });
  assert.equal(trace.exportRecords().length, 250);
});

test('clear drops buffered records and dispose finishes active attempts as aborted', () => {
  let now = 0;
  const trace = createPerformanceTrace({ enabled: true, platform: 'android', now: () => now });
  const attempt = trace.beginAttempt('android.search.local', 7, { scenario: 'local' });
  assert.ok(attempt);
  now = 8;
  assert.equal(trace.record(attempt, 'query.changed'), true);

  trace.clear();
  assert.deepEqual(trace.exportRecords(), []);
  now = 9;
  trace.dispose();
  assert.equal(trace.enabled, false);
  assert.equal(trace.record(attempt, 'search.dispatched'), false);
  assert.equal(trace.finish(attempt, 'success'), false);
  assert.equal(trace.exportRecords().at(-1)?.outcome, 'aborted');
});

test('a regressing or invalid clock cannot produce negative elapsed values', () => {
  const readings = [40, 35, Number.NaN, 45];
  const trace = createPerformanceTrace({ enabled: true, platform: 'web', now: () => readings.shift() ?? 45 });
  const attempt = trace.beginAttempt('web.search-to-play', 3);
  assert.ok(attempt);

  assert.equal(trace.record(attempt, 'query.changed'), true);
  assert.equal(trace.record(attempt, 'search.dispatched'), true);
  assert.equal(trace.finish(attempt, 'timeout'), true);
  assert.deepEqual(trace.exportRecords().map((record) => record.elapsedMs), [0, 0, 5]);
});
