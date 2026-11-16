/**
 * The mini player ↔ Now Playing hand-over (2026-11-16): one compact bar and one thumbnail at every frame, a cover
 * that lands exactly on the mini player's cover with its corners and crop, and a Canvas that never shows over a
 * closing sheet. Pure rules from playerTransition; the hook-level lifecycle is in usePlayerSheetMotion.test.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  canvasSheetGate,
  coverFrame,
  coverPictureScale,
  ghostClipOpacity,
  ghostVisible,
  isUsableRect,
  miniRideY,
  riddenCoverRect,
  sheetOpeningStart,
  thumbnailOwner,
} from './playerTransition';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const restY = 700;
const mini = { x: 20, y: 712, width: 40, height: 40 };
const card = { x: 24, y: 120, width: 342, height: 342 };
const hero = { x: 0, y: 0, width: 390, height: 548 };
const steps = Array.from({ length: 1001 }, (_, i) => i / 1000);

describe('single ownership of the thumbnail', () => {
  it('gives the thumbnail to exactly one owner at every frame, and to the mini player at both resting ends', () => {
    for (const p of steps) {
      const owner = thumbnailOwner(p, true);
      expect(owner === 'moving').toBe(ghostVisible(p));
    }
    expect(thumbnailOwner(0, true)).toBe('mini');
    expect(thumbnailOwner(1, true)).toBe('mini');
  });

  it('keeps the mini player’s own cover when no cover flies (classic bar, Reduce Motion, missing geometry)', () => {
    for (const p of steps) expect(thumbnailOwner(p, false)).toBe('mini');
  });

  it('treats a missing or late measurement as no geometry, so it never holds the open back', () => {
    expect(isUsableRect({ x: 0, y: 0, width: 0, height: 0 })).toBe(false);
    expect(isUsableRect({ x: Number.NaN, y: 0, width: 40, height: 40 })).toBe(false);
    expect(isUsableRect(null)).toBe(false);
    expect(isUsableRect(mini)).toBe(true);
  });
});

describe('the moving cover lands on the mini player’s cover', () => {
  it('starts from the pill’s cover as the pill rides the sheet’s edge, so the last frame is the pill’s own place', () => {
    for (const p of [0, 0.0005, 0.01, 0.05, 0.1]) {
      const from = riddenCoverRect(mini, p, restY, false);
      expect(from.y).toBeCloseTo(mini.y + miniRideY(p, restY, false), 6);
      const frame = coverFrame(p, from, card);
      if (p === 0) expect(frame).toEqual(mini);
    }
  });

  it('matches the mini cover’s corners at the mini end and the player’s at the other', () => {
    expect(ghostClipOpacity(0)).toEqual({ mini: 1, player: 0 });
    expect(ghostClipOpacity(1)).toEqual({ mini: 0, player: 1 });
    // The player's clip is fully in before the mini clip starts to leave: the picture is never see-through.
    for (const p of steps) {
      const { mini: m, player: q } = ghostClipOpacity(p);
      expect(Math.max(m, q)).toBe(1);
    }
  });

  it('crops a square cover like contentFit cover at every frame, whole at the mini end and cropped in a tall hero', () => {
    const miniLayout = { x: 0, y: 0, width: 40, height: 40 };
    expect(coverPictureScale(mini, miniLayout)).toEqual({ x: 1, y: 1 });
    expect(coverPictureScale(hero, hero)).toEqual({ x: 1, y: 1 });
    for (const p of steps) {
      const frame = coverFrame(p, mini, hero);
      for (const layout of [miniLayout, hero]) {
        const scale = coverPictureScale(frame, layout);
        const side = Math.max(layout.width, layout.height);
        // Rendered picture = side × own scale × the clip's scale onto the frame; always a square covering the frame.
        const w = side * scale.x * (frame.width / layout.width);
        const h = side * scale.y * (frame.height / layout.height);
        expect(w).toBeCloseTo(h, 6);
        expect(w).toBeCloseTo(Math.max(frame.width, frame.height), 6);
      }
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

describe('one compact bar', () => {
  const sheets = ['screens/NowPlayingScreen.tsx', 'components/connect/ConnectRemotePlayer.tsx'].map(f => code(read(f)));

  it('the sheet paints a plain surface, never its own copy of the mini player', () => {
    for (const sheet of sheets) {
      expect(sheet).not.toMatch(/MiniPlayerGlow/);
      expect(sheet).not.toMatch(/surfaceSheen|sheenStyle|miniSurfaceStyle/);
    }
  });

  it('hides the closed sheet on the UI thread before the route goes, and keeps the route if it was grabbed', () => {
    for (const sheet of sheets) {
      expect(sheet).toMatch(/opacity: handedOff\.value \? 0 :/);
      expect(sheet).toMatch(/if \(holdRoute \|\| !shouldLeave\(\)\) return;/);
      expect(sheet).toMatch(/if \(isSheetSessionFree\(session\)\) setMiniPlayerHiddenSource\('NowPlaying', false\)/);
    }
  });

  it('decides the moving cover on the UI thread, never by reading a shared value during render', () => {
    for (const sheet of sheets) {
      expect(sheet).not.toMatch(/playerCoverFrom\.value\.width > 0/);
      expect(sheet).toMatch(/useDerivedValue\(\(\) => playerCoverHandoff\.value && isUsableRect\(playerCoverFrom\.value\)\)/);
    }
  });

  it('the pill hides its own cover exactly while the moving cover owns the thumbnail', () => {
    const pill = code(read('components/PillPlayer.tsx'));
    expect(pill).toMatch(/thumbnailOwner\(playerSheetProgress\.value, playerCoverHandoff\.value && isUsableRect\(playerCoverFrom\.value\)\) === 'mini' \? 1 : 0/);
    expect(pill).toMatch(/style=\{\[styles\.cover, ownCoverStyle\]\}/);
  });
});
