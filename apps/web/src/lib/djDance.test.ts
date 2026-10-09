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
  it('hops quicker and rests less for bouncy than for calm', () => {
    const bouncy = djMotionFor('bouncy', true, 'roam');
    const calm = djMotionFor('calm', true, 'roam');
    assert.ok(bouncy.rest[1] < calm.rest[0], 'bouncy never rests as long as calm does at the least');
    assert.ok(bouncy.height > calm.height);
    assert.ok(bouncy.reach > calm.reach);
  });

  it('hops in the air for well under a second whatever the vibe, so it never glides', () => {
    for (const vibe of ['calm', 'steady', 'bouncy', 'dreamy'] as const) {
      assert.ok(djMotionFor(vibe, true, 'roam').flight[1] < 1);
    }
    assert.ok(djMotionFor('calm', false, 'roam').flight[1] < 1);
  });

  it('rests longer when nothing plays', () => {
    assert.ok(djMotionFor('bouncy', false, 'roam').rest[0] > djMotionFor('bouncy', true, 'roam').rest[1]);
  });

  it('holds still and leans while thinking, and heads for the prompt while listening', () => {
    const thinking = djMotionFor('bouncy', true, 'still');
    assert.equal(thinking.mode, 'still');
    assert.ok(thinking.tilt < 0);
    const listening = djMotionFor('bouncy', true, 'listen');
    assert.equal(listening.mode, 'listen');
    assert.equal(listening.doubleHop, 0);
  });
});

describe('djTonePalette', () => {
  it('gives every tone its own darkened trio and falls back to amber', () => {
    const seen = new Set(['amber', 'violet', 'blue', 'coral'].map((tone) => djTonePalette(tone).primary));
    assert.equal(seen.size, 4);
    assert.equal(djTonePalette('unknown').primary, djTonePalette('amber').primary);
  });
});
