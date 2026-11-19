import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import postcss from 'postcss';

import { motionTokens } from '../motion';

const tokensCss = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8');

function rootTokens(): Map<string, string> {
  const tokens = new Map<string, string>();
  postcss.parse(tokensCss).walkRules(':root', (rule) => {
    rule.walkDecls(/^--/, (decl) => void tokens.set(decl.prop, decl.value.trim()));
  });
  return tokens;
}

const css = rootTokens();
const kebab = (name: string): string => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
const camel = (name: string): string => name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());

/** `240ms` or `0.24s` as milliseconds. */
function milliseconds(value: string): number {
  const match = /^(\d*\.?\d+)(ms|s)$/.exec(value);
  assert.ok(match, `${value} is not a plain duration`);
  return Math.round(Number(match[1]) * (match[2] === 's' ? 1000 : 1));
}

/** `cubic-bezier(.4, 0, .2, 1)` as its four numbers; `var(--x)` follows the alias. */
function bezier(value: string): number[] {
  const alias = /^var\((--[\w-]+)\)$/.exec(value);
  if (alias) return bezier(css.get(alias[1]!)!);
  const match = /^cubic-bezier\(([^)]+)\)$/.exec(value);
  assert.ok(match, `${value} is not a plain cubic-bezier`);
  return match[1]!.split(',').map(Number);
}

/** The CSS token that carries each JS duration the two sides share. */
const SHARED_DURATIONS = ['instant', 'fast', 'base', 'panel', 'slow', 'songChange'] as const;
/** JS ease name -> CSS token. `emphasis` is the press curve in CSS. */
const SHARED_EASES = { standard: '--ease-standard', decelerate: '--ease-decelerate', accelerate: '--ease-accelerate', tactile: '--ease-tactile', emphasis: '--ease-press', inOut: '--ease-in-out' } as const;

describe('motion tokens: motion/index.ts and tokens.css agree', () => {
  for (const name of SHARED_DURATIONS) {
    it(`duration ${name} is the same length in JS and CSS`, () => {
      const token = `--d-${kebab(name)}`;
      assert.ok(css.has(token), `${token} is missing from tokens.css`);
      assert.equal(milliseconds(css.get(token)!), Math.round(motionTokens.duration[name] * 1000));
    });
  }

  for (const [name, token] of Object.entries(SHARED_EASES)) {
    it(`ease ${name} is the same curve in JS and CSS`, () => {
      assert.ok(css.has(token), `${token} is missing from tokens.css`);
      assert.deepEqual(bezier(css.get(token)!), [...motionTokens.ease[name as keyof typeof SHARED_EASES]]);
    });
  }

  it('any other --d-* token that has a JS twin of the same name agrees with it', () => {
    const durations = motionTokens.duration as unknown as Record<string, unknown>;
    for (const [token, value] of css) {
      const match = /^--d-(.+)$/.exec(token);
      const twin = match ? durations[camel(match[1]!)] : undefined;
      if (typeof twin !== 'number') continue;
      assert.equal(milliseconds(value), Math.round(twin * 1000), `${token} differs from motionTokens.duration.${camel(match![1]!)}`);
    }
  });

  it('--delay-scene is the same wait in JS and CSS', () => {
    assert.equal(milliseconds(css.get('--delay-scene')!), Math.round(motionTokens.delay.scene * 1000));
  });

  it('has no ease keyword where a curve belongs', () => {
    for (const [token, value] of css) {
      if (token.startsWith('--ease-')) assert.match(value, /^(cubic-bezier\(|var\(--ease-)/, `${token} is ${value}`);
    }
  });
});
