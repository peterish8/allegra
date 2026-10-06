import assert from 'node:assert/strict';
import test from 'node:test';

import { orbApart, orbReach, orbSeat } from './blendOrbs.ts';

test('a closer match puts the orbs closer together', () => {
  assert.ok(orbReach(90) < orbReach(40));
  assert.equal(orbApart(100), orbApart(99));
  assert.equal(orbApart(-5), 1);
  assert.equal(orbReach(undefined), 0.16 + 0.5 * 0.6);
});

test('a pair sits side by side, mirrored about the centre', () => {
  const reach = orbReach(72);
  assert.deepEqual(orbSeat(0, 2, reach), { x: -reach, y: 0 });
  assert.deepEqual(orbSeat(1, 2, reach), { x: reach, y: 0 });
});

test('a group starts at the top and goes round', () => {
  const top = orbSeat(0, 3, 1);
  assert.ok(Math.abs(top.x) < 1e-9);
  assert.ok(Math.abs(top.y + 0.8) < 1e-9);
  assert.ok(orbSeat(1, 3, 1).x > 0);
  assert.ok(orbSeat(2, 3, 1).x < 0);
});
