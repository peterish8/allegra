/**
 * The design system's guards (DESIGN.md §11). They read the source and count what screens must not do by hand:
 *
 *   pressable    a bare <Pressable> / <TouchableOpacity> (press through the library, Tactile or TactileRow)
 *   slideModal   an RN Modal with animationType="slide" (use Sheet)
 *   weight       fontWeight '500' / '800' / '900' (only 400 / 600 / 700 ship)
 *   tracking     letterSpacing (Android tracks SF Pro itself)
 *   bottomPad    paddingBottom: <number ≥ 100> in a screen (use useBottomClearance)
 *   alert        Alert.alert with buttons — a question (use ConfirmSheet)
 *   componentColor / componentTypeSize  raw visual values in components (use theme tokens)
 *   motionLiteral numeric motion settings outside the token and primitive folders
 *   reduceMotion  motion files without a reduced-motion reference or a documented exception
 *   layoutAnim    layout properties animated by Reanimated or the JS driver
 *
 * Each count is a ratchet against `designGuards.baseline.json`: a file may not go above its number, a file not
 * listed must be at zero, and when a file goes below its number the test asks for the baseline to be lowered, so
 * the lists only shrink. `src/ui/` and `components/allegra/` are the library and are not counted.
 *
 * One rule has no baseline: a `layout=` animation and an `exiting=` animation in the same file. That pair
 * crashed Reanimated 4.1 on Android (CLAUDE.md), so it is never allowed.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const SRC = path.resolve(__dirname);
const BASELINE_FILE = path.join(SRC, 'designGuards.baseline.json');
const LIBRARY = ['ui/', 'components/allegra/'];

type Rule =
  | 'pressable'
  | 'slideModal'
  | 'weight'
  | 'tracking'
  | 'bottomPad'
  | 'alert'
  | 'color'
  | 'typeSize'
  | 'componentColor'
  | 'componentTypeSize'
  | 'motionLiteral'
  | 'reduceMotion'
  | 'layoutAnim';
type RuleConfig = {
  re?: RegExp;
  screensOnly?: boolean;
  nonScreensOnly?: boolean;
  excludedDirs?: string[];
  includeLibrary?: boolean;
  measure?: (file: string, text: string) => number;
};

const PATTERNS: Record<Rule, RuleConfig> = {
  pressable: { re: /<(Pressable|TouchableOpacity|TouchableHighlight|TouchableWithoutFeedback)\b/g },
  slideModal: { re: /animationType=["']slide["']/g },
  weight: { re: /fontWeight:\s*['"](100|200|300|500|800|900)['"]/g },
  tracking: { re: /letterSpacing\s*:/g },
  bottomPad: { re: /paddingBottom:\s*([1-9]\d{2,})\b/g, screensOnly: true },
  alert: { re: /Alert\.alert\([^)]*\[/g },
  // V6 migration ratchets: preserve existing screens, prohibit new visual recipes.
  color: { re: /\b(?:color|backgroundColor|border(?:Top|Bottom|Left|Right)?Color|shadowColor|tintColor):\s*['"](?:#[\da-f]{3,8}\b|rgba?\()/gi, screensOnly: true },
  typeSize: { re: /\bfontSize:\s*\d/g, screensOnly: true },
  componentColor: { re: /#[\da-f]{3,8}\b|\brgba?\([^)]*\)/gi, nonScreensOnly: true, excludedDirs: ['constants'] },
  componentTypeSize: { re: /\bfontSize:\s*\d/g, nonScreensOnly: true, excludedDirs: ['constants'] },
  motionLiteral: { re: /\b(?:duration|stiffness|damping):\s*\d/g, excludedDirs: ['constants', 'ui', 'allegra'] },
  reduceMotion: {
    includeLibrary: true,
    measure: (file, text) => {
      if (!['withTiming', 'withSpring', 'withRepeat', 'entering', 'Animated.timing'].some(api => text.includes(api))) return 0;
      if (!/\b(?:withTiming|withSpring|withRepeat|entering|Animated\.timing)\b/.test(text)) return 0;
      if (/\b(?:useReducedMotion|useReduceMotion|isReducedMotion|reduceMotion|reducedMotion)\b/.test(text)) return 0;
      return REDUCE_MOTION_ALLOWLIST[file]?.trim() ? 0 : 1;
    },
  },
  layoutAnim: { includeLibrary: true, measure: (file, text) => countLayoutAnimationViolations(file, text) },
};

const sourceFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === 'node_modules' ? [] : sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [full] : [];
  });

const rel = (file: string) => path.relative(SRC, file).split(path.sep).join('/');
const isLibraryFile = (file: string) => LIBRARY.some(dir => file.startsWith(dir));

// Intentional exceptions require one file and one concrete reason. Existing unhandled files stay in the ratchet.
const REDUCE_MOTION_ALLOWLIST: Record<string, string> = {};

const isLayoutProperty = (name: string | undefined) =>
  name !== undefined && ['height', 'width', 'borderRadius', 'top', 'left'].includes(name);

const propertyName = (name: ts.PropertyName): string | undefined => {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name) && ts.isStringLiteral(name.expression)) return name.expression.text;
  return undefined;
};

const unwrapExpression = (expression: ts.Expression): ts.Expression => {
  let current = expression;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isTypeAssertionExpression(current) || ts.isNonNullExpression(current)) {
    current = current.expression;
  }
  return current;
};

const returnedExpressions = (body: ts.ConciseBody): ts.Expression[] => {
  if (!ts.isBlock(body)) return [body];
  const expressions: ts.Expression[] = [];
  const visit = (node: ts.Node) => {
    if (node !== body && (ts.isArrowFunction(node) || ts.isFunctionExpression(node))) return;
    if (ts.isReturnStatement(node) && node.expression) {
      expressions.push(node.expression);
      return;
    }
    node.forEachChild(visit);
  };
  visit(body);
  return expressions;
};

const isAnimatedTimingCall = (expression: ts.Expression) =>
  ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) && expression.expression.text === 'Animated' && expression.name.text === 'timing';

const countLayoutAnimationViolations = (file: string, text: string): number => {
  if (!text.includes('useAnimatedStyle') && !text.includes('Animated.timing')) return 0;
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  let violations = 0;

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'useAnimatedStyle') {
      const callback = node.arguments[0];
      if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
        for (const expression of returnedExpressions(callback.body)) {
          const returned = unwrapExpression(expression);
          if (!ts.isObjectLiteralExpression(returned)) continue;
          for (const property of returned.properties) {
            if ((ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) && isLayoutProperty(propertyName(property.name))) {
              violations += 1;
            }
          }
        }
      }
    }

    if (ts.isCallExpression(node) && isAnimatedTimingCall(node.expression)) {
      const config = node.arguments[1];
      if (config && ts.isObjectLiteralExpression(config)) {
        const usesJsDriver = config.properties.some(property =>
          ts.isPropertyAssignment(property) && propertyName(property.name) === 'useNativeDriver' && property.initializer.kind === ts.SyntaxKind.FalseKeyword,
        );
        const target = node.arguments[0]?.getText(sourceFile) ?? '';
        const toValue = config.properties.find(property => ts.isPropertyAssignment(property) && propertyName(property.name) === 'toValue');
        const animatedSize = `${target} ${toValue && ts.isPropertyAssignment(toValue) ? toValue.initializer.getText(sourceFile) : ''}`;
        if (usesJsDriver && /\b(?:height|width)\b/.test(animatedSize)) violations += 1;
      }
    }

    node.forEachChild(visit);
  };

  visit(sourceFile);
  return violations;
};

const countFileRule = (ruleName: string, file: string, text: string): number => {
  const rule = (PATTERNS as unknown as Partial<Record<string, RuleConfig>>)[ruleName];
  if (!rule) return 0;
  if (rule.screensOnly && !file.startsWith('screens/')) return 0;
  if (rule.nonScreensOnly && file.startsWith('screens/')) return 0;
  if (rule.excludedDirs?.some(dir => file.split('/').includes(dir))) return 0;
  if (!rule.includeLibrary && isLibraryFile(file)) return 0;
  if (rule.measure) return rule.measure(file, text);
  return rule.re ? (text.match(rule.re)?.length ?? 0) : 0;
};

export const countAll = (): Record<Rule, Record<string, number>> => {
  const counts = Object.fromEntries(Object.keys(PATTERNS).map(r => [r, {}])) as Record<Rule, Record<string, number>>;
  for (const file of sourceFiles(SRC)) {
    const filePath = rel(file);
    const text = fs.readFileSync(file, 'utf8');
    for (const rule of Object.keys(PATTERNS) as Rule[]) {
      const n = countFileRule(rule, filePath, text);
      if (n > 0) counts[rule][filePath] = n;
    }
  }
  return counts;
};

// After moving files onto the library: `UPDATE_DESIGN_BASELINE=1 npx jest src/designGuards.test.ts` rewrites the
// baseline from the tree. Never use it to make room for new hand-built UI — the review will see the number rise.
if (process.env.UPDATE_DESIGN_BASELINE) fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(countAll(), null, 2)}\n`);
const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')) as Record<Rule, Record<string, number>>;

describe('design guards', () => {
  let counts: ReturnType<typeof countAll>;

  beforeAll(() => {
    counts = countAll();
  });

  for (const rule of Object.keys(PATTERNS) as Rule[]) {
    it(`${rule}: no file goes above its baseline, and the baseline only shrinks`, () => {
      const allowed = baseline[rule] ?? {};
      const over: string[] = [];
      const under: string[] = [];
      for (const [file, n] of Object.entries(counts[rule])) {
        const max = allowed[file] ?? 0;
        if (n > max) over.push(`${file}: ${n} (allowed ${max})`);
      }
      for (const [file, max] of Object.entries(allowed)) {
        const n = counts[rule][file] ?? 0;
        if (n < max) under.push(`${file}: ${n} (baseline ${max}) — lower it in designGuards.baseline.json`);
      }
      expect({ rule, over }).toEqual({ rule, over: [] });
      expect({ rule, under }).toEqual({ rule, under: [] });
    });
  }

  it('never pairs a layout animation with an exiting animation in one file (crashed Reanimated 4.1)', () => {
    const pairs = sourceFiles(SRC)
      .filter(file => {
        const text = fs.readFileSync(file, 'utf8');
        return /\blayout=\{/.test(text) && /\bexiting=\{/.test(text);
      })
      .map(rel);
    expect(pairs).toEqual([]);
  });

  it('keeps MiniPlayer skip controls off layout animation and names its motion values', () => {
    const text = fs.readFileSync(path.join(SRC, 'components', 'MiniPlayer.tsx'), 'utf8');
    expect(text.match(/(?:duration|stiffness)\s*[:=]\s*(?:\d+(?:\.\d*)?|\.\d+)/g)).toEqual(null);
    expect(text).not.toMatch(/width:\s*skipProgress\.value/);
  });
});

describe('mobile guard scratch violations', () => {
  it('counts a raw colour in a component scratch file', () => {
    expect(countFileRule('componentColor', 'components/Scratch.tsx', 'const palette = ["#fff", "rgba(0,0,0,0.5)"];')).toBe(2);
    expect(countFileRule('componentColor', 'screens/Scratch.tsx', 'const style = { color: "#fff" };')).toBe(0);
  });

  it('counts a raw font size in a component scratch file', () => {
    expect(countFileRule('componentTypeSize', 'components/Scratch.tsx', 'const style = { fontSize: 16 };')).toBe(1);
  });

  it('counts a numeric motion literal outside token and primitive folders', () => {
    expect(countFileRule('motionLiteral', 'components/Scratch.tsx', 'withTiming(1, { duration: 120 });')).toBe(1);
    expect(countFileRule('motionLiteral', 'constants/Scratch.ts', 'withTiming(1, { duration: 120 });')).toBe(0);
  });

  it('flags animation in a scratch file without a reduced-motion reference', () => {
    expect(countFileRule('reduceMotion', 'components/Scratch.tsx', 'withTiming(1);')).toBe(1);
    expect(countFileRule('reduceMotion', 'components/Scratch.tsx', 'const reduce = useReducedMotion(); withTiming(1);')).toBe(0);
  });

  it('requires a non-empty reason for every reduced-motion exception', () => {
    expect(Object.entries(REDUCE_MOTION_ALLOWLIST).every(([file, reason]) => file.trim() && reason.trim())).toBe(true);
  });

  it('flags layout properties in animated-style scratch code', () => {
    expect(countFileRule('layoutAnim', 'components/Scratch.tsx', 'useAnimatedStyle(() => ({ height: value.value }));')).toBe(1);
    expect(countFileRule('layoutAnim', 'components/Scratch.tsx', 'Animated.timing(height, { useNativeDriver: false });')).toBe(1);
  });

  it('ignores static layout styles beside transform-only animated styles', () => {
    const source = fs.readFileSync(path.join(SRC, 'components', 'NowPlayingBackground.tsx'), 'utf8');
    expect(countFileRule('layoutAnim', 'components/NowPlayingBackground.tsx', source)).toBe(0);
  });
});
