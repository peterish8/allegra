import * as fs from 'fs';
import * as path from 'path';

// Owner report, 2026-11-06 (UI-04): the Now Playing title showed as clipped fragments ("Day Of Sun   An") beside the
// song actions: a scrolling marquee in a lane narrowed by three buttons, inside a fixed 30dp box.
const controls = fs.readFileSync(path.join(__dirname, 'NowPlayingControls.tsx'), 'utf8');
const marquee = fs.readFileSync(path.join(__dirname, 'allegra', 'Marquee.tsx'), 'utf8');

it('wraps the player title to two lines instead of scrolling it', () => {
  expect(controls).toMatch(/<SwapMarquee style=\{styles\.title\}[^>]*lines=\{2\}/);
  expect(marquee).toMatch(/const overflow = distance > 0 && !wraps;/);
  expect(marquee).toMatch(/numberOfLines=\{lines\} ellipsizeMode="tail"/);
});

it('lets the title and artist lines grow with the text instead of clipping it', () => {
  expect(controls).toMatch(/swapLine: \{ minHeight: 30, overflow: 'hidden' \}/);
  expect(controls).not.toMatch(/swapLine: \{ height:/);
});
