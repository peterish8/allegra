/**
 * The mini player ↔ Now Playing hand-over (1.69.3, owner: "one continuous fade, neat and simple"): one sheet carries
 * the player's own artwork, the mini player rides its edge and fades, and nothing else flies between them. One bar,
 * one cover at every frame. Pure rules from playerTransition plus source checks; the hook lifecycle (session, close
 * callback, release before mount) is in usePlayerSheetMotion.test.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { canvasSheetGate, miniContentOpacity, playerContentOpacity, sheetOpeningStart } from './playerTransition';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const restY = 700;
const steps = Array.from({ length: 1001 }, (_, i) => i / 1000);
const sheets = ['screens/NowPlayingScreen.tsx', 'components/connect/ConnectRemotePlayer.tsx'];

// Regression (emulator, 2026-11-16): a second cover flew between the mini player and the player. It doubled the
// artwork in the full-bleed view, and when its styles stopped following the sheet it froze over the page.
describe('one cover', () => {
  it('has no separate moving cover anywhere', () => {
    expect(existsSync(join(__dirname, '..', 'components/player/CoverGhost.tsx'))).toBe(false);
    for (const sheet of sheets) {
      const text = code(read(sheet));
      expect(text).not.toMatch(/CoverGhost|playerCoverFrom|transitionProgress/);
    }
    expect(code(read('components/PillPlayer.tsx'))).not.toMatch(/measureInWindow|playerCoverFrom/);
    expect(code(read('components/NowPlayingLyricsArea.tsx'))).not.toMatch(/transitionProgress/);
  });

  it('hands over in one continuous fade: one of the two players is fully gone at every point', () => {
    for (const p of steps) expect(Math.min(miniContentOpacity(p), playerContentOpacity(p))).toBe(0);
    expect(miniContentOpacity(0)).toBe(1);
    expect(playerContentOpacity(1)).toBe(1);
  });

  it('fades the player in and out on the shared rule, local and Connect alike', () => {
    for (const sheet of sheets) {
      expect(code(read(sheet))).toMatch(/opacity: reduceMotion \? 1 : playerContentOpacity\(progress\.value\)/);
    }
  });
});

describe('one compact bar', () => {
  it('the sheet paints a plain surface, never its own copy of the mini player', () => {
    for (const sheet of sheets) {
      const text = code(read(sheet));
      expect(text).not.toMatch(/MiniPlayerGlow/);
      expect(text).not.toMatch(/surfaceSheen|sheenStyle|miniSurfaceStyle/);
    }
  });

  it('hides the closed sheet on the UI thread before the route goes, and keeps the route if it was grabbed', () => {
    for (const sheet of sheets) {
      const text = code(read(sheet));
      expect(text).toMatch(/opacity: handedOff\.value \? 0 :/);
      expect(text).toMatch(/if \(holdRoute \|\| !shouldLeave\(\)\) return;/);
      expect(text).toMatch(/if \(isSheetSessionFree\(session\)\) setMiniPlayerHiddenSource\('NowPlaying', false\)/);
    }
  });
});

describe('Canvas over the sheet', () => {
  it('shows only near the open end, fading on the first tenth of a close and back on a reopen', () => {
    expect(canvasSheetGate(1)).toBe(1);
    expect(canvasSheetGate(0.95)).toBeCloseTo(0.5, 6);
    for (const p of steps.filter(s => s <= 0.9)) expect(canvasSheetGate(p)).toBe(0);
  });

  it('is gated by opacity only, so a ready video keeps its decoder through a reversal', () => {
    const bg = code(read('components/NowPlayingBackground.tsx'));
    expect(bg).toMatch(/const gate = sheetProgress \? canvasSheetGate\(sheetProgress\.value\) : 1;/);
    expect(bg).toMatch(/canvas=\{canvasAllowed \? canvas : null\}/);
    expect(code(read('screens/NowPlayingScreen.tsx'))).toMatch(/sheetProgress=\{progress\}/);
  });
});

// Regression: a flick from the mini player that lifted before the route mounted used to open from rest, losing
// where the finger left the sheet and which way it was going.
describe('a drag released before the route mounts', () => {
  it('starts the sheet where the finger left it and settles from there', () => {
    expect(sheetOpeningStart(false, true, 420, restY)).toEqual({ y: 420, tracked: true });
    expect(sheetOpeningStart(false, true, 900, restY)).toEqual({ y: restY, tracked: true });
    expect(sheetOpeningStart(false, true, Number.NaN, restY)).toEqual({ y: restY, tracked: true });
  });

  it('opens a tap from rest and an instant open already open', () => {
    expect(sheetOpeningStart(false, false, 420, restY)).toEqual({ y: restY, tracked: false });
    expect(sheetOpeningStart(true, true, 420, restY)).toEqual({ y: 0, tracked: false });
  });
});
