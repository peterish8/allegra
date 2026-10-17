import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../styles/app.css', import.meta.url), 'utf8');

test('the now playing title and credits drift right to left', () => {
  const keyframes = css.match(/@keyframes np-marquee\s*\{\s*from\s*\{([^}]*)\}\s*to\s*\{([^}]*)\}/);
  assert.ok(keyframes, 'np-marquee keyframes are missing');
  const [, from, to] = keyframes;
  // The text starts in place and moves left by one lap; reversed it reads as scrolling backwards.
  assert.match(from ?? '', /translateX\(0\)/);
  assert.match(to ?? '', /translateX\(calc\(var\(--marquee-shift, 50%\) \* -1\)\)/);
});
