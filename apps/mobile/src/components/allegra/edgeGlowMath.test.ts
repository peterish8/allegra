import { EdgeLight, PLAYER_LIGHTS, ROOM_LIGHTS, lightPose, maxReach, swing } from './edgeGlowMath';

// A typical phone and a short one, in points.
const SCREENS = [{ width: 411, height: 891 }, { width: 360, height: 640 }];

describe('cover glow geometry', () => {
  it('keeps the middle of the player black: no light reaches the centre band', () => {
    for (const { width, height } of SCREENS) {
      for (const light of PLAYER_LIGHTS) expect(maxReach(light, width, height)).toBeLessThan(0.38);
    }
  });

  it('pours one tone from the top and the other up from the bottom', () => {
    const top = PLAYER_LIGHTS.filter(light => light.edge === 'top');
    const bottom = PLAYER_LIGHTS.filter(light => light.edge === 'bottom');
    expect(top[0]?.tone).toBe('primary');
    expect(bottom[0]?.tone).toBe('secondary');
  });

  it('puts the app glow in two tones across the top only', () => {
    expect(new Set(ROOM_LIGHTS.map(light => light.tone))).toEqual(new Set(['primary', 'secondary']));
    expect(ROOM_LIGHTS.every(light => light.edge === 'top')).toBe(true);
  });

  it('centres every light just outside its own edge', () => {
    const { width, height } = SCREENS[0];
    for (const light of [...PLAYER_LIGHTS, ...ROOM_LIGHTS]) {
      const { cy } = lightPose(light, 7, width, height);
      if (light.edge === 'top') expect(cy).toBeLessThanOrEqual(0);
      else expect(cy).toBeGreaterThanOrEqual(height);
    }
  });

  it('never stalls: in any four seconds of a loop each light moves its edge at least 10pt', () => {
    const { width, height } = SCREENS[0];
    for (const light of [...PLAYER_LIGHTS, ...ROOM_LIGHTS]) {
      for (let t = 0; t < light.period; t += 0.5) {
        const a = lightPose(light, t, width, height);
        const b = lightPose(light, t + 4, width, height);
        // Centre, size, and the rim's sweep from the tilt.
        expect(Math.hypot(a.cx - b.cx, a.rx - b.rx, (a.rotate - b.rotate) * a.rx)).toBeGreaterThan(10);
      }
    }
  });

  it('gives every light its own period, so the room never repeats a pose', () => {
    const periods = PLAYER_LIGHTS.map(light => light.period);
    expect(new Set(periods).size).toBe(periods.length);
  });

  it('loops without a seam', () => {
    const light: EdgeLight = PLAYER_LIGHTS[0];
    expect(swing(light.x, 0, light.period)).toBeCloseTo(swing(light.x, light.period, light.period), 6);
  });
});
