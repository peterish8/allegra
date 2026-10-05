import assert from 'node:assert/strict';
import test from 'node:test';

import { hexToOklab, mixPalettes, oklabToHex } from './blendPalette.ts';

test('OKLab conversion matches known values and round-trips', () => {
  const white = hexToOklab('#ffffff');
  assert.ok(Math.abs(white[0] - 1) < 1e-3 && Math.abs(white[1]) < 1e-3 && Math.abs(white[2]) < 1e-3);
  const black = hexToOklab('#000000');
  assert.ok(Math.abs(black[0]) < 1e-9);
  const red = hexToOklab('#ff0000');
  assert.ok(Math.abs(red[0] - 0.628) < 0.002 && Math.abs(red[1] - 0.2249) < 0.002 && Math.abs(red[2] - 0.1258) < 0.002);
  for (const hex of ['#5b9dff', '#7f6bff', '#41d8ff', '#ee6b5f', '#123456']) assert.equal(oklabToHex(hexToOklab(hex)), hex);
});

test('mixing a palette with itself returns it; black and white meet at a mid grey', () => {
  const palette = { primary: '#5b9dff', secondary: '#7f6bff', tertiary: '#41d8ff' };
  assert.deepEqual(mixPalettes(palette, palette), palette);
  const grey = mixPalettes({ primary: '#000000', secondary: '#000', tertiary: '#000000' }, { primary: '#ffffff', secondary: '#fff', tertiary: '#ffffff' });
  assert.ok(Math.abs(hexToOklab(grey.primary)[0] - 0.5) < 0.01);
  for (const value of Object.values(grey)) assert.match(value, /^#[0-9a-f]{6}$/);
});
