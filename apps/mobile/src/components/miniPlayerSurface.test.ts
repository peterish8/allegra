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
  // The mini player: the heart, then play, on a floating rounded card. Song options are a long press on the song
  // (owner, 2026-11-13: no ••• on the mini player), also a TalkBack action. Next is the swipe, and TalkBack keeps
  // its "Next song" action.
  it('shows the heart and play, opens song options on a long press, and Next stays reachable', () => {
    const pill = code(read('PillPlayer.tsx'));
    const heart = pill.indexOf("'Remove from Liked songs' : 'Add to Liked songs'");
    const play = pill.indexOf('<PlaybackButton size={48}');
    expect(pill).not.toMatch(/ellipsis-horizontal/);
    expect(pill).toMatch(/onLongPress=\{onMore\}/);
    expect(pill).toMatch(/\{ name: 'longpress', label: 'Song options' \}/);
    expect(heart).toBeGreaterThan(0);
    expect(play).toBeGreaterThan(heart);
    expect(pill).not.toMatch(/label="Next song"/);
    expect(pill).toMatch(/\{ name: 'next', label: 'Next song' \}/);
    expect(pill).toMatch(/const which = miniSwipe\(/);
  });

  // 1.44.0 (owner): edge to edge, no border and no grey line of its own.
  it('spans the full width with no border, and its progress track is a faint white, not a grey line', () => {
    const pill = code(read('PillPlayer.tsx'));
    expect(pill).toMatch(/shell: \{ position: 'absolute', left: 0, right: 0, zIndex: 15, borderRadius: Radius\.panel, overflow: 'hidden' \}/);
    expect(pill).not.toMatch(/border(Width|Color)/);
    const scrubber = code(read('MiniScrubber.tsx'));
    expect(scrubber).toMatch(/height: SCRUB_LINE, overflow: 'hidden', backgroundColor: Glass\.selected/);
    expect(scrubber).not.toMatch(/Surface\.control/);
  });

  // 1.44.0 (owner: "place neatly like Spotify"): one glyph size, even 44dp slots, each a 48dp touch.
  it('sets song options, the saved mark and play on one rhythm and one size', () => {
    const pill = code(read('PillPlayer.tsx'));
    expect(pill).toMatch(/const ACTION_GLYPH = 26;/);
    expect(pill).toMatch(/const ACTION_SLOT = 48;/);
    expect(pill).toMatch(/action: \{ width: ACTION_SLOT, height: Control\.target/);
    // Every control occupies the same 48dp slot.
    expect(pill).toMatch(/const ACTION_SLOP = \{ left: 0, right: 0, top: 0, bottom: 0 \}/);
    expect(code(read('..', 'ui', 'PlaybackButton.tsx'))).toMatch(/const glyph = plain \? 26 :/);
    expect(pill).toMatch(/name=\{liked \? 'checkmark-circle' : 'add-circle-outline'\} size=\{ACTION_GLYPH\}/);
  });

  it('the local mini player passes song options and the heart; the Connect one passes song options', () => {
    const mini = code(read('MiniPlayer.tsx'));
    expect(mini).toMatch(/onMore=\{\(\) => setSongMenuOpen\(true\)\}\s*\n\s*liked=\{isLiked\}\s*\n\s*onToggleLike=/);
    expect(code(read('connect', 'ConnectMiniPlayer.tsx'))).toMatch(/onMore=\{\(\) => setMenuOpen\(true\)\}/);
  });

  it('the native navigation tabs read as tabs to TalkBack', () => {
    const tabBar = read('..', '..', 'android', 'app', 'src', 'main', 'java', 'com', 'lyricflow', 'app', 'views', 'NativeTabBarView.kt');
    expect(tabBar).toMatch(/if \(variant == "v6" && !create\) info\.roleDescription = "Tab"/);
    expect(tabBar).toMatch(/info\.isSelected = host\.isSelected/);
  });
});
