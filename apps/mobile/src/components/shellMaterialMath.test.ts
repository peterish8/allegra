import { shellCoverFrame, shellIsSolid } from './shellMaterialMath';

const frosted = { lowEnd: false, reduceTransparency: false, batterySaver: false, uri: 'file://cover.jpg' };

describe('the shell material (Round 7 item 8)', () => {
  it('is frosted with a cover on a capable phone', () => {
    expect(shellIsSolid(frosted)).toBe(false);
  });

  it.each([
    ['Reduce Transparency', { reduceTransparency: true }],
    ['Battery Saver', { batterySaver: true }],
    ['a low-end phone', { lowEnd: true }],
    ['no cover', { uri: undefined }],
  ])('falls back to the opaque surface under %s', (_name, change) => {
    expect(shellIsSolid({ ...frosted, ...change })).toBe(true);
  });

  it('stretches one cover across the mini player and the navigation bar so they meet without a seam', () => {
    const mini = 16 + 48;
    const nav = 56 + 24;
    // The mini player's frame: the cover runs on under the navigation bar.
    expect(shellCoverFrame(0, nav)).toEqual({ top: -0, bottom: -nav });
    // The navigation bar's frame: the same cover starts above it, at the mini player's top.
    expect(shellCoverFrame(mini, 0)).toEqual({ top: -mini, bottom: -0 });
  });

  it('never extends the cover inward for a negative span', () => {
    expect(shellCoverFrame(-10, -4)).toEqual({ top: -0, bottom: -0 });
  });
});
