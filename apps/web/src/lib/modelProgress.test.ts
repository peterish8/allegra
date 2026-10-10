import assert from 'node:assert/strict';
import test from 'node:test';

import { createProgressTracker } from './modelProgress';

function collect(): { readonly seen: number[]; readonly handle: ReturnType<typeof createProgressTracker> } {
  const seen: number[] = [];
  return { seen, handle: createProgressTracker((percent) => seen.push(percent)) };
}

test('sums bytes across files instead of restarting per file', () => {
  const { seen, handle } = collect();
  handle({ status: 'progress', file: 'a', loaded: 50, total: 100 });
  handle({ status: 'progress', file: 'b', loaded: 0, total: 100 });
  assert.deepEqual(seen, [50]);
  handle({ status: 'progress', file: 'b', loaded: 50, total: 100 });
  assert.equal(seen[seen.length - 1], 50);
  handle({ status: 'progress', file: 'a', loaded: 100, total: 100 });
  assert.equal(seen[seen.length - 1], 75);
});

test('reports 100 only when every seen file is done', () => {
  const { seen, handle } = collect();
  handle({ status: 'progress', file: 'a', loaded: 100, total: 100 });
  handle({ status: 'initiate', file: 'b' });
  handle({ status: 'done', file: 'a' });
  handle({ status: 'progress', file: 'b', loaded: 100, total: 100 });
  assert.ok(!seen.includes(100));
  handle({ status: 'done', file: 'b' });
  assert.equal(seen[seen.length - 1], 100);
});

test('never decreases when a new file appears late or events arrive out of order', () => {
  const { seen, handle } = collect();
  handle({ status: 'progress', file: 'a', loaded: 80, total: 100 });
  handle({ status: 'progress', file: 'a', loaded: 40, total: 100 });
  handle({ status: 'progress', file: 'b', loaded: 0, total: 900 });
  for (let i = 1; i < seen.length; i += 1) assert.ok((seen[i] ?? 0) > (seen[i - 1] ?? 0));
  assert.equal(seen[0], 80);
});

test('a file without total adds nothing until it finishes', () => {
  const { seen, handle } = collect();
  handle({ status: 'initiate', file: 'config.json' });
  handle({ status: 'progress', file: 'model.onnx', loaded: 25, total: 100 });
  assert.deepEqual(seen, [25]);
  handle({ status: 'done', file: 'config.json' });
  handle({ status: 'done', file: 'model.onnx' });
  assert.equal(seen[seen.length - 1], 100);
});
