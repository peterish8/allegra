import * as fs from 'fs';
import * as path from 'path';

// Owner report, 2026-11-06 (UI-04): the Now Playing title showed as clipped fragments ("Day Of Sun   An") beside the
// song actions: a scrolling marquee in a lane narrowed by three buttons. 1.38.0 wrapped it to two lines, which on a
// 360dp emulator grew the title up into the cover; it now stays one line that shrinks to fit, then ellipsizes.
const controls = fs.readFileSync(path.join(__dirname, 'NowPlayingControls.tsx'), 'utf8');
const marquee = fs.readFileSync(path.join(__dirname, 'allegra', 'Marquee.tsx'), 'utf8');

it('keeps the player title still on one line that shrinks to fit', () => {
  expect(controls).toMatch(/<SwapMarquee style=\{styles\.title\}[^>]*\bstill>/);
  expect(controls).not.toMatch(/<SwapMarquee style=\{styles\.title\}[^>]*lines=\{2\}/);
  expect(marquee).toMatch(/const wraps = lines > 1 \|\| still;/);
  expect(marquee).toMatch(/const overflow = distance > 0 && !wraps;/);
  expect(marquee).toMatch(/adjustsFontSizeToFit=\{still\} minimumFontScale=\{0\.8\}/);
});

it('lets the title and artist lines grow with large text instead of clipping it', () => {
  expect(controls).toMatch(/swapLine: \{ minHeight: 30, overflow: 'hidden' \}/);
  expect(controls).not.toMatch(/swapLine: \{ height:/);
});
