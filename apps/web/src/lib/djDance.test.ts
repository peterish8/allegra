import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { djDanceVibe, djMotionFor, djTonePalette } from './djDance';

describe('djDanceVibe', () => {
  it('bounces for coral or high energy, whatever else is true', () => {
    assert.equal(djDanceVibe('coral', 2), 'bouncy');
    assert.equal(djDanceVibe('amber', 4), 'bouncy');
    assert.equal(djDanceVibe('violet', 5), 'bouncy');
  });

  it('dreams for violet and floats for blue or low energy', () => {
    assert.equal(djDanceVibe('violet', 3), 'dreamy');
    assert.equal(djDanceVibe('blue', 3), 'calm');
    assert.equal(djDanceVibe('amber', 1), 'calm');
    assert.equal(djDanceVibe('amber', 2), 'calm');
  });

  it('walks at middling energy', () => {
    assert.equal(djDanceVibe('amber', 3), 'steady');
  });
});

describe('djMotionFor', () => {
  it('idles without dance moves when nothing plays, whatever the vibe', () => {
    for (const vibe of ['calm', 'steady', 'bouncy', 'dreamy'] as const) {
      assert.equal(djMotionFor(vibe, false, 'roam').sway, 0);
    }
  });

  it('laps faster for bouncy than for calm', () => {
    assert.ok(djMotionFor('bouncy', true, 'roam').period < djMotionFor('calm', true, 'roam').period);
  });

  it('draws a figure eight for dreamy', () => {
    assert.equal(djMotionFor('dreamy', true, 'roam').yRatio, 2);
  });

  it('holds still and leans while thinking, and heads for the prompt while listening', () => {
    const thinking = djMotionFor('bouncy', true, 'still');
    assert.equal(thinking.ampX, 0);
    assert.equal(thinking.ampY, 0);
    assert.ok(thinking.tilt < 0);
    const listening = djMotionFor('bouncy', true, 'listen');
    assert.equal(listening.ampX, 0);
    assert.ok(listening.yOffset > 0);
  });
});

describe('djTonePalette', () => {
  it('gives every tone its own darkened trio and falls back to amber', () => {
    const seen = new Set(['amber', 'violet', 'blue', 'coral'].map((tone) => djTonePalette(tone).primary));
    assert.equal(seen.size, 4);
    assert.equal(djTonePalette('unknown').primary, djTonePalette('amber').primary);
  });
});
