/**
 * The design system's guards (DESIGN.md §11). They read the source and count what screens must not do by hand:
 *
 *   pressable    a bare <Pressable> / <TouchableOpacity> (press through the library, Tactile or TactileRow)
 *   slideModal   an RN Modal with animationType="slide" (use Sheet)
 *   weight       fontWeight '500' / '800' / '900' (only 400 / 600 / 700 ship)
 *   tracking     letterSpacing (Android tracks SF Pro itself)
 *   bottomPad    paddingBottom: <number ≥ 100> in a screen (use useBottomClearance)
 *   alert        Alert.alert with buttons — a question (use ConfirmSheet)
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

const SRC = path.resolve(__dirname);
const BASELINE_FILE = path.join(SRC, 'designGuards.baseline.json');
const LIBRARY = [`ui${path.sep}`, `components${path.sep}allegra${path.sep}`];

type Rule = 'pressable' | 'slideModal' | 'weight' | 'tracking' | 'bottomPad' | 'alert' | 'color' | 'typeSize';

const PATTERNS: Record<Rule, { re: RegExp; screensOnly?: boolean }> = {
  pressable: { re: /<(Pressable|TouchableOpacity|TouchableHighlight|TouchableWithoutFeedback)\b/g },
  slideModal: { re: /animationType=["']slide["']/g },
  weight: { re: /fontWeight:\s*['"](100|200|300|500|800|900)['"]/g },
  tracking: { re: /letterSpacing\s*:/g },
  bottomPad: { re: /paddingBottom:\s*([1-9]\d{2,})\b/g, screensOnly: true },
  alert: { re: /Alert\.alert\([^)]*\[/g },
  // V6 migration ratchets: preserve existing screens, prohibit new visual recipes.
  color: { re: /\b(?:color|backgroundColor|border(?:Top|Bottom|Left|Right)?Color|shadowColor|tintColor):\s*['"](?:#[\da-f]{3,8}\b|rgba?\()/gi, screensOnly: true },
  typeSize: { re: /\bfontSize:\s*\d/g, screensOnly: true },
};

const sourceFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === 'node_modules' ? [] : sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [full] : [];
  });

const rel = (file: string) => path.relative(SRC, file).split(path.sep).join('/');
const inLibrary = (file: string) => LIBRARY.some(dir => path.relative(SRC, file).startsWith(dir));

export const countAll = (): Record<Rule, Record<string, number>> => {
  const counts = Object.fromEntries(Object.keys(PATTERNS).map(r => [r, {}])) as Record<Rule, Record<string, number>>;
  for (const file of sourceFiles(SRC)) {
    if (inLibrary(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const [rule, { re, screensOnly }] of Object.entries(PATTERNS) as [Rule, { re: RegExp; screensOnly?: boolean }][]) {
      if (screensOnly && !rel(file).startsWith('screens/')) continue;
      const n = text.match(re)?.length ?? 0;
      if (n > 0) counts[rule][rel(file)] = n;
    }
  }
  return counts;
};

const counts = countAll();
// After moving files onto the library: `UPDATE_DESIGN_BASELINE=1 npx jest src/designGuards.test.ts` rewrites the
// baseline from the tree. Never use it to make room for new hand-built UI — the review will see the number rise.
if (process.env.UPDATE_DESIGN_BASELINE) fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(counts, null, 2)}\n`);
const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')) as Record<Rule, Record<string, number>>;

describe('design guards', () => {
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
});
