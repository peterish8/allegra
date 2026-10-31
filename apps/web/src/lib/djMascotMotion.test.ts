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

  it('lets a reaction outrank the beat: no beat nods right after a hop of joy', () => {
    const driver = createMascotDriver(seeded());
    run(1, (dt) => driver.step(dt, input({ mode: 'groove' })));
    driver.react('joy');
    driver.step(FRAME, input({ mode: 'groove', onset: 0.8 }));
    const during = run(0.2, (dt) => driver.step(dt, input({ mode: 'groove', onset: 0.5 })));
    assert.ok(Math.max(...during.map((pose) => pose.nod)) < 0.05, `nod during reaction ${Math.max(...during.map((pose) => pose.nod))}`);
    run(1, (dt) => driver.step(dt, input({ mode: 'groove' })));
    driver.step(FRAME, input({ mode: 'groove', onset: 0.8 }));
    const after = run(0.15, (dt) => driver.step(dt, input({ mode: 'groove', onset: 0.5 })));
    assert.ok(Math.max(...after.map((pose) => pose.nod)) > 0.12, 'beats count again once the reaction is over');
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

/** Plays a beat every `gap` seconds for `count` beats (a one-frame onset spike each time). */
function playBeats(driver: ReturnType<typeof createMascotDriver>, count: number, gap: number, extra: Partial<DjMascotInput> = {}): DjMascotPose[] {
  const poses: DjMascotPose[] = [];
  for (let beatIndex = 0; beatIndex < count; beatIndex += 1) {
    poses.push(driver.step(FRAME, input({ mode: 'groove', onset: 0.8, ...extra })));
    poses.push(...run(gap - FRAME, (dt) => driver.step(dt, input({ mode: 'groove', onset: 0, ...extra }))));
  }
  return poses;
}

describe('createMascotDriver: song and everyday reactions', () => {
  it('says hello on arrival: springs up, waves and smiles, then settles', () => {
    const driver = createMascotDriver(seeded());
    driver.react('hello');
    const hello = run(1.2, (dt) => driver.step(dt, input()));
    assert.ok(Math.max(...hello.map((pose) => pose.squint)) > 0.8, 'happy squint');
    assert.ok(Math.max(...hello.map((pose) => pose.lift)) > 0.05, 'springs up');
    const tilts = hello.map((pose) => pose.tilt);
    assert.ok(Math.max(...tilts) > 3 && Math.min(...tilts) < -3, 'waves side to side');
    const after = run(3, (dt) => driver.step(dt, input())).at(-1)!;
    assert.ok(after.squint < 0.1 && Math.abs(after.lift) < 0.03, 'back to rest');
  });

  it('tips its head left and right on alternate beats', () => {
    const driver = createMascotDriver(seeded());
    run(1, (dt) => driver.step(dt, input({ mode: 'groove', vibe: 'bouncy' })));
    const signs: number[] = [];
    for (let beatIndex = 0; beatIndex < 4; beatIndex += 1) {
      const before = driver.step(FRAME, input({ mode: 'groove', vibe: 'bouncy', onset: 0.8 })).tilt;
      const window = run(0.12, (dt) => driver.step(dt, input({ mode: 'groove', vibe: 'bouncy' })));
      const swing = window.map((pose) => pose.tilt - before);
      signs.push(Math.sign(swing.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0)));
      run(0.5 - 0.12 - FRAME, (dt) => driver.step(dt, input({ mode: 'groove', vibe: 'bouncy' })));
    }
    for (let i = 1; i < signs.length; i += 1) assert.notEqual(signs[i], signs[i - 1], `signs ${signs.join(',')}`);
  });

  it('keeps time: after steady beats it nods on the beat the detector missed, then stops guessing', () => {
    const driver = createMascotDriver(seeded());
    run(1, (dt) => driver.step(dt, input({ mode: 'groove' })));
    playBeats(driver, 7, 0.5);
    // Silence from here. The next beat was due 0.5 s after the last one.
    const quiet = run(4, (dt) => driver.step(dt, input({ mode: 'groove' })));
    const nodAt = (from: number, to: number): number => Math.max(...quiet.slice(Math.round(from / FRAME), Math.round(to / FRAME)).map((pose) => pose.nod));
    assert.ok(nodAt(0.05, 0.3) > 0.08, `predicted nod near the missed beat (${nodAt(0.05, 0.3)})`);
    assert.ok(nodAt(2.6, 4) < 0.08, `stops after a few guesses (${nodAt(2.6, 4)})`);
  });

  it('hops on a drop from quiet to loud, but not twice in a row', () => {
    const driver = createMascotDriver(seeded());
    run(6, (dt) => driver.step(dt, input({ mode: 'groove', energy: 0.1 })));
    const drop = run(0.6, (dt) => driver.step(dt, input({ mode: 'groove', energy: 0.75 })));
    assert.ok(Math.max(...drop.map((pose) => pose.lift)) > 0.05, 'a hop on the drop');
    assert.ok(Math.max(...drop.map((pose) => pose.squint)) > 0.4, 'and a happy squint');
    run(1, (dt) => driver.step(dt, input({ mode: 'groove', energy: 0.1 })));
    const again = run(0.6, (dt) => driver.step(dt, input({ mode: 'groove', energy: 0.75 })));
    assert.ok(Math.max(...again.map((pose) => pose.lift)) < 0.03, 'no second hop within the cooldown');
  });

  it('squints in bliss now and then through a long loud stretch, never while quiet', () => {
    const quietDriver = createMascotDriver(seeded());
    const quiet = playBeats(quietDriver, 20, 0.5, { energy: 0.2 });
    assert.ok(Math.max(...quiet.map((pose) => pose.squint)) < 0.1);
    const loudDriver = createMascotDriver(seeded());
    run(6, (dt) => loudDriver.step(dt, input({ mode: 'groove', energy: 0.8 })));
    const loud = playBeats(loudDriver, 20, 0.5, { energy: 0.8 });
    assert.ok(Math.max(...loud.map((pose) => pose.squint)) > 0.3);
  });

  it('a tap squishes it happily; three taps spin it once round and back to rest', () => {
    const driver = createMascotDriver(seeded());
    run(1, (dt) => driver.step(dt, input()));
    driver.react('boop');
    const boop = run(0.5, (dt) => driver.step(dt, input()));
    assert.ok(Math.min(...boop.map((pose) => pose.squash)) < -0.1, 'squished');
    assert.ok(Math.max(...boop.map((pose) => pose.squint)) > 0.5, 'happy');
    driver.react('spin');
    const spin = run(1.2, (dt) => driver.step(dt, input()));
    assert.ok(Math.max(...spin.map((pose) => pose.spin)) > 300, 'nearly a whole turn');
    assert.equal(spin.at(-1)!.spin, 0, 'back to rest');
    for (let i = 1; i < spin.length; i += 1) {
      if (spin[i]!.spin === 0 || spin[i - 1]!.spin === 0) continue;
      assert.ok(spin[i]!.spin >= spin[i - 1]!.spin, 'always turns the same way');
    }
  });

  it('a spin outranks the beat', () => {
    const driver = createMascotDriver(seeded());
    run(1, (dt) => driver.step(dt, input({ mode: 'groove' })));
    driver.react('spin');
    driver.step(FRAME, input({ mode: 'groove', onset: 0.8 }));
    const during = run(0.3, (dt) => driver.step(dt, input({ mode: 'groove', onset: 0.5 })));
    assert.ok(Math.max(...during.map((pose) => pose.nod)) < 0.05);
  });

  it('a like makes it blush, stroking it warms the blush, and both fade', () => {
    const driver = createMascotDriver(seeded());
    driver.react('love');
    assert.ok(driver.step(FRAME, input()).blush > 0.9);
    const faded = run(3, (dt) => driver.step(dt, input())).at(-1)!;
    assert.ok(faded.blush < 0.05);
    for (let stroke = 0; stroke < 4; stroke += 1) {
      driver.react('purr');
      run(0.1, (dt) => driver.step(dt, input()));
    }
    assert.ok(driver.step(FRAME, input()).blush > 0.6);
  });

  it('perks up and looks up for a new song; droops and looks down on a pause', () => {
    const driver = createMascotDriver(seeded());
    run(1, (dt) => driver.step(dt, input()));
    driver.react('perk');
    const perk = run(0.5, (dt) => driver.step(dt, input()));
    assert.ok(Math.min(...perk.map((pose) => pose.lookY)) < -0.3);
    assert.ok(Math.max(...perk.map((pose) => pose.lift)) > 0.02);
    run(1, (dt) => driver.step(dt, input()));
    driver.react('droop');
    const droop = run(0.7, (dt) => driver.step(dt, input()));
    assert.ok(Math.max(...droop.map((pose) => pose.lookY)) > 0.3);
  });

  it('leans toward the pointer as well as looking', () => {
    const driver = createMascotDriver(seeded());
    const right = run(2, (dt) => driver.step(dt, input({ look: { x: 1, y: 0 } }))).at(-1)!;
    assert.ok(right.tilt > 2, `tilt ${right.tilt}`);
    const left = run(2, (dt) => driver.step(dt, input({ look: { x: -1, y: 0 } }))).at(-1)!;
    assert.ok(left.tilt < -2, `tilt ${left.tilt}`);
  });

  it('yawns before sleep and stretches awake', () => {
    const driver = createMascotDriver(seeded());
    run(1, (dt) => driver.step(dt, input()));
    driver.react('yawn');
    const yawn = run(1.4, (dt) => driver.step(dt, input({ mode: 'sleep' })));
    assert.ok(Math.max(...yawn.map((pose) => pose.squash)) > 0.08, 'stretches tall');
    assert.ok(Math.min(...yawn.map((pose) => pose.tilt)) < -3, 'leans back');
    driver.react('stretch');
    const wake = run(1, (dt) => driver.step(dt, input()));
    assert.ok(Math.max(...wake.map((pose) => pose.lift)) > 0.03);
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
