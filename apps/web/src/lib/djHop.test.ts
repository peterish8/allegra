import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { djMotionFor } from './djDance';
import { createHopper, type HopPose } from './djHop';

/** A seeded generator, so a failing run can be replayed. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FRAME = 1 / 60;

function run(seconds: number, motion: ReturnType<typeof djMotionFor>, seed = 7): HopPose[] {
  const hopper = createHopper(seeded(seed));
  const poses: HopPose[] = [];
  for (let t = 0; t < seconds; t += FRAME) poses.push(hopper.step(FRAME, motion));
  return poses;
}

/** Hops: times it leaves the ground (a double hop counts twice). */
function hops(poses: readonly HopPose[]): number {
  let count = 0;
  for (let i = 1; i < poses.length; i += 1) if (poses[i]!.airborne && !poses[i - 1]!.airborne) count += 1;
  return count;
}

/** Floating moves: stretches of travel with no squash at all. */
function moved(poses: readonly HopPose[]): number {
  return Math.max(...poses.map((p) => p.x)) - Math.min(...poses.map((p) => p.x));
}

describe('createHopper', () => {
  it('floats across the stage within eight seconds, bobbing as it goes', () => {
    const poses = run(8, djMotionFor('steady', true, 'roam'));
    assert.ok(moved(poses) > 0.2, 'it drifted sideways');
    const lifts = poses.map((p) => p.lift);
    assert.ok(Math.max(...lifts) > 0.02, 'it bobs');
  });

  it('hops only sometimes: most moves are floats', () => {
    const poses = run(120, djMotionFor('bouncy', true, 'roam'));
    const count = hops(poses);
    assert.ok(count >= 1, 'it does hop now and then');
    assert.ok(count <= 20, `not always hopping: ${count} hops in two minutes`);
  });

  it('squashes on landing and stretches in the air when it does hop', () => {
    const always = { ...djMotionFor('bouncy', true, 'roam'), hopChance: 1 };
    const squash = run(6, always).map((p) => p.squash);
    assert.ok(Math.min(...squash) < -0.15, 'crushed against the floor');
    assert.ok(Math.max(...squash) > 0.1, 'stretched in flight');
  });

  it('stays inside its box and never goes below the floor', () => {
    for (const vibe of ['calm', 'steady', 'bouncy', 'dreamy'] as const) {
      for (const pose of run(30, djMotionFor(vibe, true, 'roam'), 3)) {
        assert.ok(Math.abs(pose.x) <= 1 && pose.y >= -1 && pose.y <= 1, `${vibe} stays in the box`);
        assert.ok(pose.lift >= 0, `${vibe} never sinks below the floor`);
      }
    }
  });

  it('hops more often for bouncy than for calm', () => {
    const bouncy = hops(run(120, djMotionFor('bouncy', true, 'roam')));
    const calm = hops(run(120, djMotionFor('calm', true, 'roam')));
    assert.ok(bouncy > calm, `bouncy ${bouncy} vs calm ${calm}`);
  });

  it('wobbles when it lands and settles again', () => {
    const poses = run(12, { ...djMotionFor('steady', true, 'roam'), hopChance: 1 });
    assert.ok(Math.max(...poses.map((p) => Math.abs(p.sway))) > 2, 'a wobble');
    const hopper = createHopper(seeded(1));
    const quiet = djMotionFor('calm', false, 'still');
    let last: HopPose = hopper.step(FRAME, quiet);
    for (let t = 0; t < 5; t += FRAME) last = hopper.step(FRAME, quiet);
    assert.ok(Math.abs(last.squash) < 0.01, 'no squash at rest');
  });

  it('holds still and leans while thinking', () => {
    const hopper = createHopper(seeded(5));
    const thinking = djMotionFor('bouncy', true, 'still');
    let pose = hopper.step(FRAME, thinking);
    const first = pose;
    for (let t = 0; t < 8; t += FRAME) {
      pose = hopper.step(FRAME, thinking);
      assert.equal(pose.lift, 0);
    }
    assert.equal(pose.x, first.x);
    assert.equal(pose.y, first.y);
    assert.ok(pose.sway < -5, 'leaning');
  });

  it('floats down to the prompt when listening and stays there', () => {
    const hopper = createHopper(seeded(9));
    const listening = djMotionFor('bouncy', true, 'listen');
    let pose = hopper.step(FRAME, listening);
    for (let t = 0; t < 10; t += FRAME) pose = hopper.step(FRAME, listening);
    assert.ok(Math.abs(pose.x) < 0.01 && Math.abs(pose.y - 0.9) < 0.01, 'at the prompt');
    for (let t = 0; t < 3; t += FRAME) assert.equal(hopper.step(FRAME, listening).lift, 0);
  });
});
