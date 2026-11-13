import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import postcss, { type Rule } from 'postcss';

const styles = join(fileURLToPath(new URL('../', import.meta.url)), 'styles');
const FILES = ['app.css', 'dj.css', 'blend.css'];
const MIN_TARGET = 44;

function pixels(rule: Rule, props: readonly string[]): number | undefined {
  let found: number | undefined;
  rule.each((node) => {
    if (node.type !== 'decl' || !props.includes(node.prop)) return;
    const match = node.value.trim().match(/^(\d+(?:\.\d+)?)px$/);
    if (match) found = Number(match[1]);
  });
  return found;
}

/** Selectors that already carry the 44px extension, taken from the `::before` rule in app.css. */
function extendedSelectors(): string[] {
  const root = postcss.parse(readFileSync(join(styles, 'app.css'), 'utf8'));
  const selectors: string[] = [];
  root.walkRules((rule) => {
    if (!rule.selectors.every((selector) => selector.endsWith('::before'))) return;
    if (!/max\(100%,\s*44px\)/.test(rule.toString())) return;
    for (const selector of rule.selectors) selectors.push(selector.replace(/::before$/, '').replace(/\s+/g, ' ').trim());
  });
  return selectors;
}

/** A rule under 44px in both directions on a selector that ends in an icon control. */
function shrunkIconControls(): Array<{ file: string; line: number; selector: string }> {
  const found: Array<{ file: string; line: number; selector: string }> = [];
  for (const file of FILES) {
    postcss.parse(readFileSync(join(styles, file), 'utf8')).walkRules((rule) => {
      if (rule.parent?.type === 'atrule' && (rule.parent as { name: string }).name === 'keyframes') return;
      const width = pixels(rule, ['width']);
      const height = pixels(rule, ['height']);
      if (width === undefined || height === undefined || (width >= MIN_TARGET && height >= MIN_TARGET)) return;
      for (const selector of rule.selectors) {
        const clean = selector.replace(/\s+/g, ' ').trim();
        if (/\.(?:tactile-icon-control|icon-button)$/.test(clean) && !/luvlink/.test(clean)) {
          found.push({ file, line: rule.source?.start?.line ?? 0, selector: clean });
        }
      }
    });
  }
  return found;
}

describe('hit areas', () => {
  it('extends the touch target of every .tactile-icon-control or .icon-button drawn under 44px', () => {
    const extended = extendedSelectors();
    assert.ok(extended.length > 20, 'the .hit-44 extension list in app.css is missing');
    const missing = shrunkIconControls().filter(
      ({ selector }) => !extended.some((hit) => selector === hit || selector.endsWith(` ${hit}`)),
    );
    assert.deepEqual(
      missing.map(({ file, line, selector }) => `${file}:${line} ${selector}`),
      [],
      'add the selector to the hit-area list in app.css, or give the element .hit-44',
    );
  });

  it('keeps the .hit-44 utility', () => {
    const css = readFileSync(join(styles, 'app.css'), 'utf8');
    assert.match(css, /\.hit-44::before/);
    assert.match(css, /:where\(\.hit-44\)\s*\{\s*position:\s*relative/);
  });
});
