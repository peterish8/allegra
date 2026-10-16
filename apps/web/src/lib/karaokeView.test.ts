import assert from 'node:assert/strict';
import test from 'node:test';

import { coverageGradient, coverageRuns, karaokeButtonAriaLabel, karaokeButtonLabel, workingSpan } from './karaokeView.ts';

const on = { active: true, busy: false, status: 'active' as const, stage: null };

test('the button says what karaoke is waiting on, never a bare percentage', () => {
  assert.equal(karaokeButtonLabel({ ...on, active: false }), 'Karaoke');
  assert.equal(karaokeButtonLabel(on), 'Karaoke on');
  assert.equal(
    karaokeButtonLabel({ ...on, busy: true, status: 'loading', stage: { kind: 'model-download', loaded: 312_400_000, total: 751_788_567 } }),
    'AI download · 42%'
  );
  assert.equal(karaokeButtonLabel({ ...on, busy: true, status: 'loading', stage: { kind: 'model-start' } }), 'Starting AI model');
  assert.equal(karaokeButtonLabel({ ...on, busy: true, status: 'loading', stage: { kind: 'separating', eta: 6.4 } }), 'Separating · ~6 s');
  assert.equal(karaokeButtonLabel({ ...on, busy: true, status: 'loading', stage: { kind: 'separating', eta: null } }), 'AI separating');
});

test('after a seek past the separated part, the button says it is catching up', () => {
  assert.equal(karaokeButtonLabel({ ...on, status: 'catching-up', stage: { kind: 'separating', eta: 0.2 } }), 'Catching up · ~1 s');
  assert.equal(karaokeButtonLabel({ ...on, status: 'catching-up', stage: null }), 'Catching up');
});

test('while karaoke is on, pressing turns it off, even mid-download', () => {
  assert.equal(karaokeButtonAriaLabel({ ...on, active: false }), 'Turn karaoke on');
  assert.equal(karaokeButtonAriaLabel(on), 'Turn karaoke off');
  assert.match(karaokeButtonAriaLabel({ ...on, busy: true, status: 'loading', stage: { kind: 'model-check' } }), /^Turn karaoke off\. /);
});

test('coverage merges neighbouring segments and clamps the last one to the song', () => {
  // 4 segments of 10 s over a 35 s song: the last one is half a segment.
  const runs = coverageRuns([1, 1, 0, 1], 10, 35);
  assert.equal(runs.length, 3);
  assert.deepEqual(runs.map((r) => r.ready), [true, false, true]);
  assert.ok(Math.abs(runs[0]!.to - (20 / 35) * 100) < 1e-9);
  assert.equal(runs[2]!.to, 100);
  assert.deepEqual(coverageRuns([], 10, 35), []);
  assert.deepEqual(coverageRuns([1], 10, 0), []);
});

test('the gradient paints hard stops in the two colours', () => {
  const css = coverageGradient(coverageRuns([1, 0], 10, 20), 'red', 'blue');
  assert.equal(css, 'linear-gradient(90deg, red 0.00% 50.00%, blue 50.00% 100.00%)');
  assert.equal(coverageGradient([], 'red', 'blue'), 'none');
});

test('the shimmer sits over the segment being separated', () => {
  const span = workingSpan({ ready: new Uint8Array(4), working: 1, segmentSeconds: 10, totalSeconds: 40 });
  assert.deepEqual(span, { left: 25, width: 25 });
  assert.equal(workingSpan({ ready: new Uint8Array(4), working: null, segmentSeconds: 10, totalSeconds: 40 }), null);
});
