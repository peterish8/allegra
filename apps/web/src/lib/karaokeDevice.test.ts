import assert from 'node:assert/strict';
import test from 'node:test';

import { aiBlock, paceIsMeasurable, verdictAfterSlowRun, type DeviceFacts } from './liveKaraoke/device.ts';

const laptop: DeviceFacts = {
  mode: 'auto',
  worker: true,
  webgpu: true,
  mobile: false,
  deviceMemory: 8,
  saveData: false,
  modelOnDevice: false,
  verdict: null
};

test('a capable laptop uses the AI model', () => {
  assert.equal(aiBlock(laptop), null);
  assert.equal(aiBlock({ ...laptop, deviceMemory: null }), null);
});

test('devices that cannot keep up never reach the 752 MB download', () => {
  assert.equal(aiBlock({ ...laptop, webgpu: false }), 'no-webgpu');
  assert.equal(aiBlock({ ...laptop, mobile: true }), 'phone');
  assert.equal(aiBlock({ ...laptop, deviceMemory: 2 }), 'low-memory');
  assert.equal(aiBlock({ ...laptop, verdict: 'too-slow' }), 'too-slow');
});

test('Data Saver blocks the download but not a model already on the device', () => {
  assert.equal(aiBlock({ ...laptop, saveData: true }), 'save-data');
  assert.equal(aiBlock({ ...laptop, saveData: true, modelOnDevice: true }), null);
});

test('Always AI skips every device guess except the worker requirement', () => {
  const weak: DeviceFacts = { ...laptop, mode: 'ai', webgpu: false, mobile: true, deviceMemory: 2, verdict: 'too-slow', saveData: true };
  assert.equal(aiBlock(weak), null);
  assert.equal(aiBlock({ ...weak, worker: false }), 'no-worker');
});

test('one slow run does not undo a device that already kept up', () => {
  // A busy GPU once is no verdict: forget the "ok" so the next song measures again.
  assert.equal(verdictAfterSlowRun('ok'), null);
  // Slow again from there (or slow on the first measure): too slow.
  assert.equal(verdictAfterSlowRun(null), 'too-slow');
  assert.equal(verdictAfterSlowRun('too-slow'), 'too-slow');
});

test('a chunk that ran while the tab was hidden is not timed', () => {
  assert.equal(paceIsMeasurable(false, -Infinity, 1000), true);
  assert.equal(paceIsMeasurable(true, -Infinity, 1000), false);
  // Hidden partway through the chunk, visible again when it landed.
  assert.equal(paceIsMeasurable(false, 1500, 1000), false);
  // Hidden before the chunk started: that chunk ran in the open.
  assert.equal(paceIsMeasurable(false, 500, 1000), true);
});
