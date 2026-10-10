import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createMascotDriver, createOnsetDetector, djDanceVibe, type DjMascotInput, type DjMascotPose } from './djMascotMotion';

const FRAME = 1 / 60;

/** A fixed sequence instead of Math.random, so every run is the same. */
function seeded(seed = 7): () => number {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

function input(overrides: Partial<DjMascotInput> = {}): DjMascotInput {
  return { mode: 'idle', vibe: 'steady', onset: 0, look: null, ...overrides };
}

function run(seconds: number, step: (dt: number) => DjMascotPose): DjMascotPose[] {
  const poses: DjMascotPose[] = [];
  for (let t = 0; t < seconds; t += FRAME) poses.push(step(FRAME));
  return poses;
}

describe('createMascotDriver', () => {
  it('settles down by the prompt while listening, and looks at it', () => {
    const driver = createMascotDriver(seeded());
    const poses = run(4, (dt) => driver.step(dt, input({ mode: 'listen' })));
    const last = poses.at(-1)!;
    assert.ok(Math.abs(last.x) < 0.05, `x ${last.x}`);
    assert.ok(last.y > 0.7, `y ${last.y}`);
    assert.ok(last.lookY > 0.7, `lookY ${last.lookY}`);
  });

  it('comes to the middle and leans while thinking', () => {
    const driver = createMascotDriver(seeded());
    run(3, (dt) => driver.step(dt, input({ mode: 'idle' })));
    const last = run(4, (dt) => driver.step(dt, input({ mode: 'think' }))).at(-1)!;
    assert.ok(Math.hypot(last.x, last.y + 0.08) < 0.05);
    assert.ok(last.tilt < -5);
  });

  it('drifts smoothly: no frame moves it more than a sliver of its box', () => {
    const driver = createMascotDriver(seeded());
    const poses = run(20, (dt) => driver.step(dt, input({ mode: 'groove', vibe: 'bouncy' })));
    for (let i = 1; i < poses.length; i += 1) {
      assert.ok(Math.abs(poses[i]!.x - poses[i - 1]!.x) < 0.03);
      assert.ok(Math.abs(poses[i]!.y - poses[i - 1]!.y) < 0.03);
    }
  });

  it('nods its head on a beat and springs back upright', () => {
    const driver = createMascotDriver(seeded());
    run(1, (dt) => driver.step(dt, input({ mode: 'groove' })));
    driver.step(FRAME, input({ mode: 'groove', onset: 0.8 }));
    const nod = run(0.15, (dt) => driver.step(dt, input({ mode: 'groove', onset: 0.5 })));
    assert.ok(Math.max(...nod.map((pose) => pose.nod)) > 0.12, `nod ${Math.max(...nod.map((pose) => pose.nod))}`);
    const after = run(0.6, (dt) => driver.step(dt, input({ mode: 'groove' }))).at(-1)!;
    assert.ok(Math.abs(after.nod) < 0.06, `settles ${after.nod}`);
  });

  it('sways gently while grooving, never wildly', () => {
    const driver = createMascotDriver(seeded());
    const tilts = run(6, (dt) => driver.step(dt, input({ mode: 'groove', vibe: 'bouncy' }))).map((pose) => pose.tilt);
    assert.ok(Math.max(...tilts.map(Math.abs)) < 6);
    assert.ok(Math.max(...tilts) > 1 && Math.min(...tilts) < -1);
  });

  it('does not dance to beats when it is not grooving', () => {
    const driver = createMascotDriver(seeded());
    run(1, (dt) => driver.step(dt, input()));
    driver.step(FRAME, input({ onset: 0.8 }));
    const poses = run(0.3, (dt) => driver.step(dt, input()));
    assert.ok(Math.min(...poses.map((pose) => pose.squash)) > -0.02);
    assert.ok(Math.max(...poses.map((pose) => pose.nod)) < 0.02);
  });

  it('blinks every few seconds and keeps its eyes shut asleep', () => {
    const driver = createMascotDriver(seeded());
    const poses = run(12, (dt) => driver.step(dt, input()));
    const shut = poses.filter((pose) => pose.blink > 0.9).length;
    assert.ok(shut > 0 && shut < poses.length * 0.1, `${shut} shut frames`);
    const asleep = run(1, (dt) => driver.step(dt, input({ mode: 'sleep' })));
    assert.ok(asleep.every((pose) => pose.blink === 1));
  });

  it('follows the pointer with its eyes', () => {
    const driver = createMascotDriver(seeded());
    const last = run(1, (dt) => driver.step(dt, input({ look: { x: -1, y: 0.5 } }))).at(-1)!;
    assert.ok(last.lookX < -0.9 && last.lookY > 0.4);
  });

  it('hops for joy and shakes its head', () => {
    const driver = createMascotDriver(seeded());
    run(1, (dt) => driver.step(dt, input({ mode: 'think' })));
    driver.react('joy');
    const hop = run(0.6, (dt) => driver.step(dt, input({ mode: 'think' })));
    assert.ok(Math.max(...hop.map((pose) => pose.lift)) > 0.08);
    driver.react('shake');
    const shake = run(0.5, (dt) => driver.step(dt, input({ mode: 'think' }))).map((pose) => pose.tilt + 7);
    assert.ok(Math.max(...shake) > 4 && Math.min(...shake) < -4);
  });
});

describe('createOnsetDetector', () => {
  it('fires on a loud frame after quiet ones, then decays', () => {
    const detector = createOnsetDetector();
    for (let t = 0; t < 1000; t += 16) detector.next(0.03, t);
    const hit = detector.next(0.4, 1000);
    assert.ok(hit > 0.5);
    assert.ok(detector.next(0.03, 1016) < hit);
  });

  it('counts two hits closer than the gap as one', () => {
    const detector = createOnsetDetector();
    for (let t = 0; t < 1000; t += 16) detector.next(0.03, t);
    detector.next(0.3, 1000);
    for (let t = 1016; t < 1200; t += 16) detector.next(0.03, t);
    const early = detector.next(0.3, 1200);
    assert.ok(early < 0.5);
  });
});

describe('djDanceVibe', () => {
  it('bounces for coral or high energy, dreams for violet, floats for blue or low energy', () => {
    assert.equal(djDanceVibe('coral', 2), 'bouncy');
    assert.equal(djDanceVibe('amber', 4), 'bouncy');
    assert.equal(djDanceVibe('violet', 3), 'dreamy');
    assert.equal(djDanceVibe('blue', 3), 'calm');
    assert.equal(djDanceVibe('amber', 2), 'calm');
    assert.equal(djDanceVibe('amber', 3), 'steady');
  });
});
