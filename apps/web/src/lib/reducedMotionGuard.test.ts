import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import postcss, { type AtRule, type Rule } from 'postcss';

const styles = join(fileURLToPath(new URL('../', import.meta.url)), 'styles');

function parse(file: string) {
  return postcss.parse(readFileSync(join(styles, file), 'utf8'));
}

function isReducedMotion(node: AtRule): boolean {
  return node.name === 'media' && /prefers-reduced-motion:\s*reduce/.test(node.params);
}

/** The site-wide collapse: a `*` rule inside a top-level reduce media query. */
function findBlanket(file: string): { rule: Rule; layered: boolean } | undefined {
  let found: { rule: Rule; layered: boolean } | undefined;
  parse(file).walkRules((rule) => {
    if (!rule.selectors.includes('*')) return;
    const parent = rule.parent;
    if (parent?.type !== 'atrule' || !isReducedMotion(parent as AtRule)) return;
    let layered = false;
    for (let up = parent.parent; up && up.type !== 'root'; up = up.parent) {
      if (up.type === 'atrule' && (up as AtRule).name === 'layer') layered = true;
    }
    found = { rule, layered };
  });
  return found;
}

describe('reduced-motion blanket', () => {
  it('lives in app.css, outside every @layer, and no layered file keeps a copy', () => {
    const blanket = findBlanket('app.css');
    assert.ok(blanket, 'app.css must hold the site-wide prefers-reduced-motion rule');
    assert.ok(!blanket.layered, 'a layered blanket loses to every unlayered stylesheet');
    for (const file of ['global.css', 'components.css', 'dj.css', 'blend.css']) {
      assert.ok(findBlanket(file) === undefined, `${file} must not carry a second blanket`);
    }
  });

  it('marks each collapsing declaration !important so class rules with `animation:` cannot beat it', () => {
    const blanket = findBlanket('app.css');
    assert.ok(blanket);
    const important = new Map<string, boolean>();
    blanket.rule.walkDecls((decl) => important.set(decl.prop, decl.important === true));
    for (const prop of ['animation-duration', 'animation-iteration-count', 'transition-duration', 'scroll-behavior']) {
      assert.ok(important.get(prop) === true, `${prop} must be !important`);
    }
  });

  it('comes after every rule that declares an infinite animation in app.css', () => {
    const root = parse('app.css');
    const blanket = findBlanket('app.css');
    assert.ok(blanket);
    const blanketLine = blanket.rule.source?.start?.line ?? 0;
    let lastInfinite = 0;
    root.walkDecls((decl) => {
      // The reduced-motion block itself restores `infinite` for spinners; those are meant to be last.
      const parent = decl.parent?.parent;
      if (parent?.type === 'atrule' && isReducedMotion(parent as AtRule)) return;
      if (/\binfinite\b/.test(decl.value) && (decl.prop === 'animation' || decl.prop === 'animation-iteration-count')) {
        lastInfinite = Math.max(lastInfinite, decl.source?.start?.line ?? 0);
      }
    });
    assert.ok(blanketLine > lastInfinite, 'keep the blanket at the end of app.css');
  });
});
