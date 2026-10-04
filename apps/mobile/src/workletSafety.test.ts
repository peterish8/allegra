/**
 * Code that runs on the UI thread (worklets) must only use what exists there. A mistake does not fail in Jest or in
 * JavaScript: it throws on the phone's UI thread, and an error there destroys React Native's instance — the grey
 * screen with the music still playing (1.0.2–1.0.4: `glideStep`'s default parameter `GLIDE_SMOOTH_S`).
 *
 * This reads every source file with the TypeScript compiler, finds every UI-thread function — `'worklet'`
 * functions, and the callbacks of useAnimatedStyle / useDerivedValue / useAnimatedReaction / useFrameCallback /
 * useAnimatedProps / useAnimatedScrollHandler, Gesture handlers, withTiming / withSpring / withDecay / withRepeat
 * end callbacks and runOnUI — and fails on what would break there:
 *
 *   1. a call to a function that is not a worklet (a plain helper, an imported one, a state setter, another
 *      package's function). Hand JavaScript work over with runOnJS(fn)(…), or mark the helper 'worklet'.
 *   2. a default parameter naming an outside variable: the compiler copies only what the body uses.
 *   3. a React ref read (`.current`): the worklet gets a frozen copy, and calling through it throws.
 *   4. a method call on an imported module (`Haptics.impactAsync()`): JavaScript-only objects.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const SRC = path.resolve(__dirname);

/** Packages whose functions exist on the UI thread (Skia marks its helpers, `vec` and the like, as worklets). */
const UI_PACKAGES = new Set(['react-native-reanimated', 'react-native-worklets', 'react-native-gesture-handler', '@shopify/react-native-skia']);
/** Plain JavaScript functions every runtime has. */
const GLOBAL_FUNCTIONS = new Set([
  'isNaN', 'isFinite', 'parseFloat', 'parseInt', 'Number', 'String', 'Boolean', 'Array', 'Object', 'Symbol',
  'Error', 'TypeError', 'RangeError', 'Date', 'Map', 'Set', 'JSON', 'Math', 'Float32Array', 'Float64Array',
  'Int32Array', 'Uint8Array', 'requestAnimationFrame', 'console', 'BigInt',
]);
/** Calls whose function arguments run on the UI thread: the argument indexes. */
const UI_CALLBACK_ARGS: Record<string, number[]> = {
  useAnimatedStyle: [0],
  useAnimatedProps: [0],
  useDerivedValue: [0],
  useAnimatedReaction: [0, 1],
  useFrameCallback: [0],
  useAnimatedScrollHandler: [0],
  withTiming: [2],
  withSpring: [2],
  withDecay: [1],
  withRepeat: [3],
  runOnUI: [0],
};
const GESTURE_CALLBACKS = new Set([
  'onBegin', 'onStart', 'onUpdate', 'onChange', 'onEnd', 'onFinalize',
  'onTouchesDown', 'onTouchesMove', 'onTouchesUp', 'onTouchesCancelled',
]);

type FunctionLike = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration;

const isFunctionLike = (node: ts.Node): node is FunctionLike =>
  ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node);

const hasWorkletDirective = (fn: FunctionLike): boolean => {
  const body = fn.body;
  if (!body || !ts.isBlock(body)) return false;
  const first = body.statements[0];
  return !!first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === 'worklet';
};

const calleeName = (call: ts.CallExpression): string | null => {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return null;
};

/** `Gesture.Pan().activeOffsetY(12).onEnd(…)`: the chain starts at `Gesture`, and nothing asked for runOnJS(true). */
const isGestureChain = (call: ts.CallExpression): boolean => {
  let e: ts.Expression = call.expression;
  while (true) {
    if (ts.isPropertyAccessExpression(e)) {
      if (e.name.text === 'runOnJS') return false;
      e = e.expression;
    } else if (ts.isCallExpression(e)) {
      e = e.expression;
    } else if (ts.isNonNullExpression(e) || ts.isParenthesizedExpression(e)) {
      e = e.expression;
    } else {
      return ts.isIdentifier(e) && e.text === 'Gesture';
    }
  }
};

interface FileInfo {
  file: string;
  sf: ts.SourceFile;
  /** Local name → module specifier, for imports. */
  imports: Map<string, { from: string; imported: string; namespace: boolean }>;
}

const files = new Map<string, FileInfo>();

function load(file: string): FileInfo | null {
  const cached = files.get(file);
  if (cached) return cached;
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const imports = new Map<string, { from: string; imported: string; namespace: boolean }>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || !st.importClause) continue;
    const from = st.moduleSpecifier.text;
    const clause = st.importClause;
    if (clause.name) imports.set(clause.name.text, { from, imported: 'default', namespace: false });
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) imports.set(bindings.name.text, { from, imported: '*', namespace: true });
    if (bindings && ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) imports.set(el.name.text, { from, imported: (el.propertyName ?? el.name).text, namespace: false });
    }
  }
  const info = { file, sf, imports };
  files.set(file, info);
  return info;
}

function resolveModule(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
  else if (spec.startsWith('@shared/')) base = path.resolve(SRC, '../../../packages', spec.slice('@shared/'.length));
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Names bound directly by a declaration list or a parameter (destructuring included). */
function bindingNames(name: ts.BindingName, out: Set<string>): void {
  if (ts.isIdentifier(name)) out.add(name.text);
  else for (const el of name.elements) if (!ts.isOmittedExpression(el)) bindingNames(el.name, out);
}

/** Every name declared anywhere inside `root` (its parameters, locals and nested functions). */
function declaredWithin(root: ts.Node): Set<string> {
  const out = new Set<string>();
  const visit = (node: ts.Node) => {
    if (isFunctionLike(node)) {
      for (const p of node.parameters) bindingNames(p.name, out);
      if (ts.isFunctionDeclaration(node) && node.name) out.add(node.name.text);
    }
    if (ts.isVariableDeclaration(node)) bindingNames(node.name, out);
    if (ts.isCatchClause(node) && node.variableDeclaration) bindingNames(node.variableDeclaration.name, out);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return out;
}

/** The declaration `name` refers to from `from`, looking outwards through the enclosing blocks and functions. */
function findDeclaration(name: string, from: ts.Node): ts.Node | null {
  for (let scope: ts.Node | undefined = from.parent; scope; scope = scope.parent) {
    if (isFunctionLike(scope)) {
      for (const p of scope.parameters) {
        const names = new Set<string>();
        bindingNames(p.name, names);
        if (names.has(name)) return p;
      }
    }
    const statements = ts.isBlock(scope) || ts.isSourceFile(scope) || ts.isModuleBlock(scope) ? scope.statements : null;
    if (!statements) continue;
    for (const st of statements) {
      if (ts.isFunctionDeclaration(st) && st.name?.text === name) return st;
      if (ts.isVariableStatement(st)) {
        for (const decl of st.declarationList.declarations) {
          const names = new Set<string>();
          bindingNames(decl.name, names);
          if (names.has(name)) return decl;
        }
      }
    }
  }
  return null;
}

/** Whether a declaration is a function that may be called from the UI thread. */
function isWorkletDeclaration(decl: ts.Node, info: FileInfo, seen = new Set<string>()): boolean {
  if (isFunctionLike(decl)) return hasWorkletDirective(decl);
  if (ts.isVariableDeclaration(decl) && decl.initializer) {
    let init: ts.Expression = decl.initializer;
    while (ts.isAsExpression(init) || ts.isParenthesizedExpression(init) || ts.isSatisfiesExpression(init)) init = init.expression;
    if (isFunctionLike(init)) return hasWorkletDirective(init);
    if (ts.isCallExpression(init)) {
      const callee = calleeName(init);
      // useCallback(() => { 'worklet'; … }, deps) and React.useCallback.
      if (callee === 'useCallback' && init.arguments[0] && isFunctionLike(init.arguments[0])) return hasWorkletDirective(init.arguments[0]);
      if (callee === 'useWorkletCallback') return true;
    }
    // const f = otherWorklet;
    if (ts.isIdentifier(init)) {
      const target = findDeclaration(init.text, decl);
      if (target) return isWorkletDeclaration(target, info, seen);
      return isImportedWorklet(init.text, info, seen) === true;
    }
  }
  return false;
}

/** For an imported name: true/false when the module is ours and readable, null when it is a package. */
function isImportedWorklet(name: string, info: FileInfo, seen: Set<string>): boolean | null {
  const imp = info.imports.get(name);
  if (!imp) return false;
  if (UI_PACKAGES.has(imp.from) || [...UI_PACKAGES].some(p => imp.from.startsWith(`${p}/`))) return true;
  const target = resolveModule(info.file, imp.from);
  if (!target) return null;
  const key = `${target}#${imp.imported}`;
  if (seen.has(key)) return false;
  seen.add(key);
  const mod = load(target);
  if (!mod) return null;
  for (const st of mod.sf.statements) {
    const exported = ts.canHaveModifiers(st) && (ts.getModifiers(st) ?? []).some(m => m.kind === ts.SyntaxKind.ExportKeyword);
    if (ts.isFunctionDeclaration(st) && exported && st.name?.text === imp.imported) return hasWorkletDirective(st);
    if (ts.isVariableStatement(st) && exported) {
      for (const decl of st.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === imp.imported) return isWorkletDeclaration(decl, mod, seen);
      }
    }
    // export { a as b } and export { a } from './x'
    if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const el of st.exportClause.elements) {
        if (el.name.text !== imp.imported) continue;
        const local = (el.propertyName ?? el.name).text;
        if (st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)) {
          const proxy: FileInfo = { ...mod, imports: new Map([[local, { from: st.moduleSpecifier.text, imported: local, namespace: false }]]) };
          return isImportedWorklet(local, proxy, seen);
        }
        const decl = findDeclaration(local, mod.sf.statements[0] ?? mod.sf);
        return decl ? isWorkletDeclaration(decl, mod, seen) : isImportedWorklet(local, mod, seen) === true;
      }
    }
  }
  return false;
}

interface Problem {
  where: string;
  what: string;
}

function checkWorklet(root: FunctionLike, info: FileInfo, problems: Problem[]): void {
  const where = (node: ts.Node) => {
    const { line } = info.sf.getLineAndCharacterOfPosition(node.getStart());
    return `${path.relative(SRC, info.file)}:${line + 1}`;
  };
  const local = declaredWithin(root);

  // 2. Default parameters that name an outside variable (in the root and in functions nested in it).
  const checkDefaults = (fn: FunctionLike) => {
    for (const p of fn.parameters) {
      if (!p.initializer) continue;
      const names: string[] = [];
      const collect = (n: ts.Node) => {
        if (ts.isIdentifier(n) && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n)) names.push(n.text);
        ts.forEachChild(n, collect);
      };
      collect(p.initializer);
      for (const n of names) {
        if (!['undefined', 'NaN', 'Infinity'].includes(n)) problems.push({ where: where(p), what: `default parameter names '${n}', which does not exist on the UI thread` });
      }
    }
  };
  checkDefaults(root);

  const visit = (node: ts.Node) => {
    if (node !== root && isFunctionLike(node)) checkDefaults(node);

    // 3. React refs.
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'current') {
      problems.push({ where: where(node), what: `reads a React ref ('${node.getText(info.sf)}'): mirror it into a shared value` });
    }

    if (ts.isCallExpression(node)) {
      const e = node.expression;
      // 1. A plain call: the function must be a worklet.
      if (ts.isIdentifier(e)) {
        const name = e.text;
        if (!local.has(name) && !GLOBAL_FUNCTIONS.has(name)) {
          const decl = findDeclaration(name, root);
          let ok: boolean | null;
          if (decl) ok = isWorkletDeclaration(decl, info);
          else ok = isImportedWorklet(name, info, new Set());
          if (ok !== true) {
            const imp = info.imports.get(name);
            const from = imp ? ` (from '${imp.from}')` : '';
            problems.push({ where: where(node), what: `calls '${name}'${from}, which is not a worklet: mark it 'worklet' or call it through runOnJS` });
          }
        }
      }
      // 4. A method of an imported module (Haptics.impactAsync()).
      if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression)) {
        const owner = e.expression.text;
        const imp = info.imports.get(owner);
        if (imp && !local.has(owner) && !UI_PACKAGES.has(imp.from)) {
          problems.push({ where: where(node), what: `calls '${owner}.${e.name.text}' from '${imp.from}', a JavaScript-only module` });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  if (root.body) visit(root.body);
}

/** Every UI-thread function in a file, and an identifier passed where one belongs (useFrameCallback(tick)). */
function uiThreadFunctions(info: FileInfo, problems: Problem[]): FunctionLike[] {
  const roots = new Set<FunctionLike>();
  const asRoot = (arg: ts.Expression | undefined, call: ts.CallExpression) => {
    if (!arg) return;
    if (isFunctionLike(arg)) {
      roots.add(arg);
    } else if (ts.isObjectLiteralExpression(arg)) {
      // useAnimatedScrollHandler({ onScroll: e => …, onBeginDrag() {…} })
      for (const prop of arg.properties) {
        if (ts.isMethodDeclaration(prop)) roots.add(prop);
        if (ts.isPropertyAssignment(prop) && isFunctionLike(prop.initializer)) roots.add(prop.initializer);
      }
    } else if (ts.isIdentifier(arg)) {
      const decl = findDeclaration(arg.text, arg);
      const ok = decl ? isWorkletDeclaration(decl, info) : isImportedWorklet(arg.text, info, new Set());
      if (ok !== true) {
        const { line } = info.sf.getLineAndCharacterOfPosition(arg.getStart());
        problems.push({
          where: `${path.relative(SRC, info.file)}:${line + 1}`,
          what: `passes '${arg.text}' to ${calleeName(call)}, which runs it on the UI thread, but it is not a worklet`,
        });
      }
    }
  };
  const visit = (node: ts.Node) => {
    if (isFunctionLike(node) && hasWorkletDirective(node)) roots.add(node);
    if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      const direct = ts.isIdentifier(node.expression) ? node.expression.text : null;
      const indexes = direct ? UI_CALLBACK_ARGS[direct] : undefined;
      if (indexes) for (const i of indexes) asRoot(node.arguments[i], node);
      if (name && GESTURE_CALLBACKS.has(name) && isGestureChain(node)) asRoot(node.arguments[0], node);
    }
    ts.forEachChild(node, visit);
  };
  visit(info.sf);
  // A worklet nested in another is checked as part of its parent.
  return [...roots].filter(fn => {
    for (let p = fn.parent; p; p = p.parent) if (isFunctionLike(p) && roots.has(p)) return false;
    return true;
  });
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [full] : [];
  });
}

function problemsIn(file: string): Problem[] {
  const info = load(file);
  if (!info) return [];
  const problems: Problem[] = [];
  for (const fn of uiThreadFunctions(info, problems)) checkWorklet(fn, info, problems);
  return problems;
}

/** Checks source text as if it were a file in src/ (for the tests of the checker itself). */
function problemsInText(name: string, text: string): string[] {
  const tmp = path.join(SRC, `.worklet-check-${process.pid}-${name}`);
  fs.writeFileSync(tmp, text);
  try {
    return problemsIn(tmp).map(p => p.what);
  } finally {
    fs.unlinkSync(tmp);
    files.delete(tmp);
  }
}

describe('UI-thread code (worklets)', () => {
  it('only uses what exists on the UI thread', () => {
    const found = sourceFiles(SRC).flatMap(file => problemsIn(file).map(p => `${p.where} ${p.what}`));
    expect(found).toEqual([]);
  });

  describe('the checker catches', () => {
    it("a default parameter naming a constant (glideStep's GLIDE_SMOOTH_S)", () => {
      expect(problemsInText('a.ts', `
        const K = 0.4;
        export function step(a: number, s: number = K) { 'worklet'; return a / s; }
      `)).toEqual([expect.stringContaining("default parameter names 'K'")]);
    });

    it('a call to a plain function from a worklet', () => {
      expect(problemsInText('b.ts', `
        const helper = (x: number) => x * 2;
        export function step(a: number) { 'worklet'; return helper(a); }
      `)).toEqual([expect.stringContaining("calls 'helper'")]);
    });

    it('a state setter called from an animated reaction', () => {
      expect(problemsInText('c.tsx', `
        import { useState } from 'react';
        import { useAnimatedReaction } from 'react-native-reanimated';
        export function C({ sv }: any) {
          const [, setOn] = useState(false);
          useAnimatedReaction(() => sv.value > 1, on => { setOn(on); });
          return null;
        }
      `)).toEqual([expect.stringContaining("calls 'setOn'")]);
    });

    it('a React ref and a JavaScript module inside a gesture callback', () => {
      const found = problemsInText('d.tsx', `
        import * as Haptics from 'expo-haptics';
        import { Gesture } from 'react-native-gesture-handler';
        export function D({ ref }: any) {
          return Gesture.Pan().onEnd(() => { ref.current.close(); Haptics.impactAsync(); });
        }
      `);
      expect(found).toEqual(expect.arrayContaining([
        expect.stringContaining('reads a React ref'),
        expect.stringContaining("'Haptics.impactAsync'"),
      ]));
    });

    it('a plain function handed to useFrameCallback', () => {
      expect(problemsInText('e.tsx', `
        import { useFrameCallback } from 'react-native-reanimated';
        export function E() {
          const tick = () => {};
          useFrameCallback(tick, false);
          return null;
        }
      `)).toEqual([expect.stringContaining("passes 'tick' to useFrameCallback")]);
    });

    it('and lets the right patterns through', () => {
      expect(problemsInText('f.tsx', `
        import { useCallback, useState } from 'react';
        import { runOnJS, useAnimatedStyle, useFrameCallback, withTiming } from 'react-native-reanimated';
        const clamp01 = (v: number) => { 'worklet'; return Math.min(1, Math.max(0, v)); };
        export function F({ sv }: any) {
          const [, setOn] = useState(false);
          const tick = useCallback(() => { 'worklet'; sv.value = clamp01(sv.value + 0.1); }, [sv]);
          useFrameCallback(tick, false);
          const style = useAnimatedStyle(() => {
            const k = sv.value > 1 ? 1 : 0;
            if (k) runOnJS(setOn)(true);
            return { opacity: withTiming(clamp01(k), { duration: 200 }, done => { 'worklet'; if (done) runOnJS(setOn)(false); }) };
          });
          return style;
        }
      `)).toEqual([]);
    });
  });
});
