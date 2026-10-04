/**
 * A worklet's default parameter must never name a variable from outside it. The worklet compiler copies to the UI
 * thread only what the body uses, so `function f(x, k = SOME_CONSTANT) { 'worklet'; … }` runs fine in Jest and in
 * JavaScript, then throws "Property 'SOME_CONSTANT' doesn't exist" on the UI thread. `glideStep` did that: the first
 * lyric glide killed the whole screen (React Native's instance) while the music played on. Read the value in the
 * body instead (`k ?? SOME_CONSTANT`).
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '..');
const WORKLET_HEAD = /(function\s+\w+\s*\(([^)]*)\)[^{]*\{|\(([^()]*)\)\s*(?::[^=]+)?=>\s*\{)\s*'worklet'/g;
const IDENTIFIER_DEFAULT = /[=]\s*([A-Za-z_$][\w$.]*)/g;
const LITERALS = new Set(['true', 'false', 'null', 'undefined']);

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe('worklets', () => {
  it('take no default parameter that names an outside variable', () => {
    const found: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const text = fs.readFileSync(file, 'utf8');
      for (const head of text.matchAll(WORKLET_HEAD)) {
        const params = head[2] ?? head[3] ?? '';
        for (const value of params.matchAll(IDENTIFIER_DEFAULT)) {
          if (!LITERALS.has(value[1])) {
            const line = text.slice(0, head.index ?? 0).split('\n').length;
            found.push(`${path.relative(SRC, file)}:${line} defaults to ${value[1]}`);
          }
        }
      }
    }
    expect(found).toEqual([]);
  });

  it('would catch the glideStep bug', () => {
    const bad = "export function glideStep(a: number, s: number = GLIDE_SMOOTH_S) {\n  'worklet';\n  return a / s;\n}";
    const heads = [...bad.matchAll(WORKLET_HEAD)];
    expect(heads).toHaveLength(1);
    expect([...(heads[0][2] ?? '').matchAll(IDENTIFIER_DEFAULT)].map(m => m[1])).toEqual(['GLIDE_SMOOTH_S']);
  });
});
