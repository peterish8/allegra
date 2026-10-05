import assert from 'node:assert/strict';
import test from 'node:test';

import { paletteBrightness, relativeLuminance } from './palette';

test('relative luminance follows WCAG and tolerates bad input', () => {
  assert.equal(relativeLuminance('#000000'), 0);
  assert.ok(Math.abs(relativeLuminance('#ffffff') - 1) < 1e-9);
  assert.equal(relativeLuminance('not a colour'), 0);
});

test('a palette is as bright as its brightest stop', () => {
  // The screenshot that prompted this: ochre yellow beside deep rust.
  assert.ok(paletteBrightness({ primary: '#c9a227', secondary: '#8a3a22', tertiary: '#5a2a1a' }) > 0.3);
  assert.ok(paletteBrightness({ primary: '#1b2440', secondary: '#2a1630', tertiary: '#102030' }) < 0.05);
});
