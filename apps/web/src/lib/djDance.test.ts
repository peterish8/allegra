import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { djTonePalette, djToneFor } from './djDance';

describe('djToneFor', () => {
  it('reads energy first, then the words of the vibe', () => {
    assert.equal(djToneFor('late night', 5), 'coral');
    assert.equal(djToneFor('workout', 2), 'coral');
    assert.equal(djToneFor('late night tamil', 3), 'violet');
    assert.equal(djToneFor('focus flow', 3), 'blue');
    assert.equal(djToneFor('', 3), 'amber');
  });
});

describe('djTonePalette', () => {
  it('gives every tone its own colours and falls back to amber', () => {
    const tones = ['amber', 'violet', 'blue', 'coral'].map((tone) => djTonePalette(tone).primary);
    assert.equal(new Set(tones).size, 4);
    assert.deepEqual(djTonePalette('nope'), djTonePalette('amber'));
  });
});
