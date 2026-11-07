import * as fs from 'fs';
import * as path from 'path';
import { miniSurfacePlan } from './miniPlayerSurface';

// Owner, 1.41.3: the mini player is opaque with the cover's glow (never see-through), its scrubber sits on the very
// top edge with no gap, and the controls feel right (Next shows the tap, tabs read as tabs to TalkBack).
const read = (...parts: string[]): string => fs.readFileSync(path.join(__dirname, ...parts), 'utf8');
const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

describe('miniSurfacePlan', () => {
  it('draws the cover glow whenever there is a cover, animated on capable phones', () => {
    expect(miniSurfacePlan({ uri: 'file://cover.jpg', lowEnd: false, batterySaver: false })).toEqual({ kind: 'glow', animate: true });
  });

  it('keeps the glow but holds it still on low-end phones and under Battery Saver', () => {
    expect(miniSurfacePlan({ uri: 'file://cover.jpg', lowEnd: true, batterySaver: false })).toEqual({ kind: 'glow', animate: false });
    expect(miniSurfacePlan({ uri: 'file://cover.jpg', lowEnd: false, batterySaver: true })).toEqual({ kind: 'glow', animate: false });
  });

  it('falls back to the plain solid surface only with no cover', () => {
    expect(miniSurfacePlan({ uri: undefined, lowEnd: false, batterySaver: false })).toEqual({ kind: 'solid' });
    expect(miniSurfacePlan({ uri: '', lowEnd: false, batterySaver: false })).toEqual({ kind: 'solid' });
    expect(miniSurfacePlan({ uri: null, lowEnd: true, batterySaver: true })).toEqual({ kind: 'solid' });
  });
});

describe('mini player surface is opaque', () => {
  const glow = code(read('MiniPlayerGlow.tsx'));
  const theme = read('..', 'constants', 'allegraTheme.ts');

  it('paints an opaque base under the glow and draws the glow at full strength', () => {
    expect(glow).toMatch(/base: \{ overflow: 'hidden', backgroundColor: ShellFrost\.miniBase \}/);
    expect(glow).toMatch(/miniSurfacePlan\(\{ uri, lowEnd, batterySaver \}\)/);
    expect(glow).toMatch(/active=\{active && plan\.animate\}/);
    expect(theme).toMatch(/miniBase: '#050505'/);
    expect(theme).toMatch(/miniGlowOpacity: 1,/);
    // An opaque hex base, and a scrim light enough to keep the glow's colour.
    const tint = theme.match(/miniTint: 'rgba\(\d+, \d+, \d+, ([\d.]+)\)'/);
    expect(tint).not.toBeNull();
    expect(Number(tint?.[1])).toBeLessThanOrEqual(0.4);
  });

  it('no longer turns the mini player see-through or grey for Reduce Transparency', () => {
    expect(glow).not.toMatch(/useReduceTransparency/);
    expect(glow).not.toMatch(/shellIsSolid/);
  });
});

describe('mini player scrubber sits on the top edge', () => {
  const scrubber = code(read('MiniScrubber.tsx'));

  it('has no gap above or beside the line, and thickens downward', () => {
    expect(scrubber).toMatch(/band: \{ justifyContent: 'flex-start', paddingHorizontal: 0, paddingTop: 0 \}/);
    expect(scrubber).toMatch(/transformOrigin: 'top'/);
    expect(scrubber).not.toMatch(/paddingTop: Space/);
  });

  it('can be grabbed a little above the edge', () => {
    expect(scrubber).toMatch(/const SCRUB_HIT_SLOP = \{ top: 10 \} as const;/);
    expect(scrubber).toMatch(/Gesture\.Pan\(\)\.enabled\(enabled\)\.hitSlop\(SCRUB_HIT_SLOP\)/);
    expect(scrubber).toMatch(/Gesture\.Tap\(\)\.enabled\(enabled\)\.hitSlop\(SCRUB_HIT_SLOP\)/);
  });
});

describe('mini player and navigation controls', () => {
  it('a tap on Next moves the song like a swipe does, with a light haptic', () => {
    expect(code(read('PillPlayer.tsx'))).toMatch(/<IconButton icon="play-skip-forward" label="Next song" haptic="light" onPress=\{\(\) => skip\('next', -1\)\} \/>/);
  });

  it('the native navigation tabs read as tabs to TalkBack', () => {
    const tabBar = read('..', '..', 'android', 'app', 'src', 'main', 'java', 'com', 'lyricflow', 'app', 'views', 'NativeTabBarView.kt');
    expect(tabBar).toMatch(/if \(variant == "v6" && !create\) info\.roleDescription = "Tab"/);
    expect(tabBar).toMatch(/info\.isSelected = host\.isSelected/);
  });
});
