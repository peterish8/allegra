import { styleUpdates } from './styleLink';

describe('styleUpdates', () => {
  it('reads every look it knows', () => {
    expect(styleUpdates({
      playerBackground: 'aura',
      miniPlayerBackground: 'glass',
      appBackground: 'glow',
      fps: '0',
    })).toEqual({
      playerBackground: 'aura',
      miniPlayerBackground: 'glass',
      appBackground: 'glow',
      showPerformanceHUD: false,
    });
  });

  it('ignores values it does not know, so a link cannot write anything else', () => {
    expect(styleUpdates({ playerBackground: 'neon', miniPlayerBackground: '', appBackground: 'x', vinyl: 'yes', canvasEnabled: '0' })).toEqual({});
  });

  it('switches the looping cover video on and off, and only with 1 or 0', () => {
    expect(styleUpdates({ canvas: '0' })).toEqual({ canvasEnabled: false });
    expect(styleUpdates({ canvas: '1' })).toEqual({ canvasEnabled: true });
    expect(styleUpdates({ canvas: 'maybe' })).toEqual({});
  });

  it('leaves what it was not asked about alone', () => {
    expect(styleUpdates({ miniPlayerBackground: 'black' })).toEqual({ miniPlayerBackground: 'black' });
  });
});
