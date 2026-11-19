import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { BRAND } from './colors';

const tokens = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8');
const token = (name: string): string | undefined => new RegExp(`${name}:\\s*(#[0-9a-f]{6})\\s*;`, 'i').exec(tokens)?.[1]?.toLowerCase();

describe('colors.ts mirrors tokens.css', () => {
  it('holds the same product colours', () => {
    assert.equal(BRAND.wave, token('--wave'));
    assert.equal(BRAND.accent, token('--accent'));
    assert.equal(BRAND.accentBright, token('--accent-bright'));
    assert.equal(BRAND.accentDeep, token('--accent-deep'));
  });
});
