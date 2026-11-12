/**
 * Repo rule 5: transitions animate `transform` and `opacity` only. The cover that travels from the mini player to the
 * player is laid out once at its final size; the move is a translate and scale. This reads the component's source with
 * the TypeScript compiler and fails if an animated style returns a layout key (width, height, top, left, borderRadius…).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const FILE = path.join(__dirname, 'CoverGhost.tsx');
const ALLOWED = new Set(['opacity', 'transform']);

/** Property names of every object literal returned by a `useAnimatedStyle` callback in the file. */
function animatedStyleKeys(): { keys: string[]; callbacks: number } {
  const text = fs.readFileSync(FILE, 'utf8');
  const sf = ts.createSourceFile(FILE, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const keys: string[] = [];
  let callbacks = 0;
  const literalKeys = (node: ts.Expression) => {
    let e = node;
    while (ts.isAsExpression(e) || ts.isParenthesizedExpression(e)) e = e.expression;
    if (!ts.isObjectLiteralExpression(e)) return;
    for (const prop of e.properties) {
      if (ts.isShorthandPropertyAssignment(prop)) keys.push(prop.name.text);
      else if (ts.isPropertyAssignment(prop) && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))) keys.push(prop.name.text);
      else keys.push('<spread or computed>');
    }
  };
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'useAnimatedStyle') {
      const fn = node.arguments[0];
      if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) {
        callbacks += 1;
        const visitReturns = (n: ts.Node) => {
          if (ts.isReturnStatement(n) && n.expression) literalKeys(n.expression);
          if (n !== fn && (ts.isArrowFunction(n) || ts.isFunctionExpression(n))) return;
          ts.forEachChild(n, visitReturns);
        };
        if (ts.isBlock(fn.body)) ts.forEachChild(fn.body, visitReturns);
        else literalKeys(fn.body);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { keys, callbacks };
}

describe('CoverGhost', () => {
  it('animates transform and opacity only', () => {
    const { keys, callbacks } = animatedStyleKeys();
    expect(callbacks).toBeGreaterThan(0);
    expect(keys.filter(key => !ALLOWED.has(key))).toEqual([]);
  });

  it('is laid out at its final size, not resized by the animation', () => {
    const text = fs.readFileSync(FILE, 'utf8');
    expect(text).toMatch(/style=\{\[styles\.ghost, \{ width: to\.width, height: to\.height, borderRadius: toRadius \}, style\]\}/);
  });
});
