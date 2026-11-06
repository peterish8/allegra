import * as fs from 'fs';
import * as path from 'path';

// Owner report, 2026-11-06 (UI-04): the Now Playing title showed as clipped fragments ("Day Of Sun   An") beside the
// song actions: a scrolling marquee in a lane narrowed by three buttons. 1.38.0 wrapped it to two lines, which on a
// 360dp emulator grew the title up into the cover; it now stays one line that shrinks to fit, then ellipsizes.
const controls = fs.readFileSync(path.join(__dirname, 'NowPlayingControls.tsx'), 'utf8');
const marquee = fs.readFileSync(path.join(__dirname, 'allegra', 'Marquee.tsx'), 'utf8');

// Owner, 1.41.0: the title stays its normal size (no shrinking to fit) on one line and scrolls slowly right to left
// with a 5 s rest; the smaller artist line scrolls the same way with a 3 s rest. Never two lines into the cover.
it('scrolls the full-size player title with a 5 s rest and the artist with a 3 s rest', () => {
  expect(controls).toMatch(/<SwapMarquee style=\{styles\.title\}[^>]*speed=\{PLAYER_TITLE_SPEED\}\s+restMs=\{PLAYER_TITLE_REST_MS\}>/);
  expect(controls).toMatch(/<SwapMarquee style=\{styles\.artist\}[^>]*restMs=\{PLAYER_ARTIST_REST_MS\}>/);
  expect(controls).not.toMatch(/<SwapMarquee style=\{styles\.title\}[^>]*\bstill\b/);
  expect(controls).not.toMatch(/<SwapMarquee style=\{styles\.title\}[^>]*lines=\{2\}/);
  expect(marquee).toMatch(/const overflow = distance > 0 && !wraps;/);
});

it('lets the title and artist lines grow with large text instead of clipping it', () => {
  expect(controls).toMatch(/swapLine: \{ minHeight: 30, overflow: 'hidden' \}/);
  expect(controls).not.toMatch(/swapLine: \{ height:/);
});
