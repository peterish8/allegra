import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import postcss from 'postcss';

import { relativeLuminance } from './palette';

const tokensCss = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8');

/** Every custom property declared in `:root`. */
function rootTokens(): Map<string, string> {
  const tokens = new Map<string, string>();
  postcss.parse(tokensCss).walkRules(':root', (rule) => {
    rule.walkDecls(/^--/, (decl) => void tokens.set(decl.prop, decl.value.trim()));
  });
  return tokens;
}

type Rgba = readonly [number, number, number, number];

function toRgba(value: string, tokens: Map<string, string>): Rgba {
  const alias = /^var\((--[\w-]+)\)$/.exec(value);
  if (alias) return toRgba(tokens.get(alias[1]!)!, tokens);
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgba = /^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)$/.exec(value);
  if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), rgba[4] === undefined ? 1 : Number(rgba[4])];
  throw new Error(`tokens.css value is not a plain colour: ${value}`);
}

/** `top` laid over the opaque `under`, as a #rrggbb string. */
function over(top: Rgba, under: Rgba): string {
  const [r, g, b, a] = top;
  const channel = (t: number, u: number): string => Math.round(t * a + u * (1 - a)).toString(16).padStart(2, '0');
  return `#${channel(r, under[0])}${channel(g, under[1])}${channel(b, under[2])}`;
}

function contrast(foreground: string, background: string): number {
  const [a, b] = [relativeLuminance(foreground), relativeLuminance(background)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const tokens = rootTokens();
const bg = toRgba('var(--bg)', tokens);
const surfaces = { '--bg': over(bg, bg), '--surface-raised': over(toRgba('var(--surface-raised)', tokens), bg) };

function check(names: readonly string[], minimum: number): void {
  for (const name of names) {
    const colour = over(toRgba(`var(${name})`, tokens), bg);
    for (const [surface, hex] of Object.entries(surfaces)) {
      const ratio = contrast(colour, hex);
      assert.ok(ratio >= minimum, `${name} on ${surface} is ${ratio.toFixed(2)}:1, needs ${minimum}:1`);
    }
  }
}

describe('token contrast (WCAG 2.1 AA)', () => {
  it('text tokens reach 4.5:1 on the page and on raised surfaces', () => {
    check(['--ink', '--ink-soft', '--ink-muted', '--ink-faint', '--danger'], 4.5);
  });

  it('icon and state colours reach 3:1 on the page and on raised surfaces', () => {
    check(['--icon-active', '--accent', '--accent-bright', '--wave'], 3);
  });

  it('keeps the faint text step visibly weaker than the muted one', () => {
    const muted = relativeLuminance(over(toRgba('var(--ink-muted)', tokens), bg));
    const faint = relativeLuminance(over(toRgba('var(--ink-faint)', tokens), bg));
    assert.ok(muted - faint >= 0.03, 'ink-faint and ink-muted are too close to read as two steps');
  });

  it('keeps the active icon colour out of the deep accent, which is only 2:1 on a raised surface', () => {
    assert.notEqual(tokens.get('--icon-active'), tokens.get('--accent-deep'));
  });
});
