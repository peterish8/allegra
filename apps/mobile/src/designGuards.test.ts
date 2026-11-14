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
 *   motionLiteral numeric settings inside recognized animation configuration calls
 *   reduceMotion  motion files without a reduced-motion reference or a documented exception
 *   layoutAnim    layout props driven by shared values or React Native Animated values
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
  motionLiteral: { excludedDirs: ['constants', 'ui', 'allegra'], measure: (file, text) => countMotionLiterals(file, text) },
  reduceMotion: { includeLibrary: true, measure: (file, text) => countReducedMotionViolations(file, text) },
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
const REDUCE_MOTION_ALLOWLIST: Record<string, string> = {
  // M2 explicitly preserves UpNextPanel's player sheet spring physics (K9).
  'components/player/UpNextPanel.tsx': 'The Up next panel settle spring remains identical per K9; queue row feedback is reduced separately.',
};

const LAYOUT_PROPERTIES = new Set([
  'height', 'width', 'minHeight', 'minWidth', 'maxHeight', 'maxWidth',
  'top', 'right', 'bottom', 'left',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'marginHorizontal', 'marginVertical',
  'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'paddingHorizontal', 'paddingVertical',
  'flexBasis', 'gap', 'rowGap', 'columnGap', 'borderRadius',
]);

const isLayoutProperty = (name: string | undefined) => name !== undefined && LAYOUT_PROPERTIES.has(name);

const propertyName = (name: ts.PropertyName): string | undefined => {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name) && ts.isStringLiteral(name.expression)) return name.expression.text;
  return undefined;
};

const unwrapExpression = (expression: ts.Expression): ts.Expression => {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isAwaitExpression(current)
  ) {
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

const callName = (call: ts.CallExpression): string | undefined => {
  if (ts.isIdentifier(call.expression)) return call.expression.text;
  if (ts.isPropertyAccessExpression(call.expression)) return call.expression.name.text;
  return undefined;
};

const callReceiver = (call: ts.CallExpression): string | undefined =>
  ts.isPropertyAccessExpression(call.expression) ? call.expression.expression.getText() : undefined;

const isOneOf = (value: string | undefined, names: string[]) => value !== undefined && names.includes(value);

const isMotionConfigurationCall = (call: ts.CallExpression): boolean => {
  const name = callName(call);
  const receiver = callReceiver(call);
  if (isOneOf(name, ['withTiming', 'withSpring', 'withDecay', 'withDelay', 'withRepeat', 'withSequence', 'spring', 'timing', 'decay'])) {
    return receiver === undefined || receiver === 'Animated';
  }
  if (receiver === 'Animated' && isOneOf(name, ['loop', 'sequence', 'parallel'])) return true;
  if (receiver === 'LayoutAnimation' && isOneOf(name, ['configureNext', 'create'])) return true;
  if (receiver === 'Easing') return true;
  return isAnimationTransitionDurationCall(call);
};

const isAnimationTransitionDurationCall = (call: ts.CallExpression) =>
  callName(call) === 'duration' &&
  /\b(?:Fade|Slide|Zoom|Bounce|LightSpeed|Stretch|Flip|Rotate|Pinwheel|Roll|LinearTransition|SequencedTransition|FadingTransition|withTiming|withSpring|Layout)\w*/.test(callReceiver(call) ?? '');

const isAnimationTriggerCall = (call: ts.CallExpression): boolean => {
  const name = callName(call);
  const receiver = callReceiver(call);
  if (isOneOf(name, ['withTiming', 'withSpring', 'withDecay', 'withDelay', 'withRepeat', 'withSequence'])) return receiver === undefined;
  if (receiver === 'Animated' && isOneOf(name, ['timing', 'spring', 'decay', 'loop', 'sequence', 'parallel'])) return true;
  return receiver === 'LayoutAnimation' && isOneOf(name, ['configureNext', 'create']);
};

const isReactNativeAnimatedValueCall = (call: ts.CallExpression) =>
  callReceiver(call) === 'Animated' && isOneOf(callName(call), ['timing', 'spring', 'decay']);

const collectReferences = (node: ts.Node): Set<string> => {
  const references = new Set<string>();
  const visit = (current: ts.Node) => {
    if (ts.isIdentifier(current)) {
      const parent = current.parent;
      const isMemberName = ts.isPropertyAccessExpression(parent) && parent.name === current;
      const isObjectKey = ts.isPropertyAssignment(parent) && parent.name === current;
      const isJsxName = ts.isJsxAttribute(parent) && parent.name === current;
      if (!isMemberName && !isObjectKey && !isJsxName) references.add(current.text);
    }
    current.forEachChild(visit);
  };
  visit(node);
  return references;
};

const isNumericZero = (expression: ts.Expression): boolean => {
  const value = unwrapExpression(expression);
  if (ts.isNumericLiteral(value)) return Number(value.text) === 0;
  return ts.isPrefixUnaryExpression(value) && (value.operator === ts.SyntaxKind.PlusToken || value.operator === ts.SyntaxKind.MinusToken) && ts.isNumericLiteral(value.operand) && Number(value.operand.text) === 0;
};

const isDisabledMotionValue = (expression: ts.Expression): boolean => {
  const value = unwrapExpression(expression);
  return (
    isNumericZero(value) ||
    value.kind === ts.SyntaxKind.FalseKeyword ||
    value.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(value) && value.text === 'undefined') ||
    (ts.isVoidExpression(value) && isNumericZero(value.expression))
  );
};

const isPreferenceGate = (expression: ts.Expression, preferences: Set<string>): boolean => {
  const value = unwrapExpression(expression);
  if (!ts.isConditionalExpression(value)) return false;
  const reducedWhenTrue = isReducedPreferenceCondition(value.condition, preferences);
  if (reducedWhenTrue === undefined) return false;
  return reducedWhenTrue ? isDisabledMotionValue(value.whenTrue) : isDisabledMotionValue(value.whenFalse);
};

const hasPreferenceGate = (node: ts.Node, preferences: Set<string>): boolean => {
  let found = false;
  const visit = (current: ts.Node) => {
    if (found) return;
    if (ts.isExpression(current) && isPreferenceGate(current, preferences)) {
      found = true;
      return;
    }
    current.forEachChild(visit);
  };
  visit(node);
  return found;
};

const isReducedMotionPreferenceCall = (expression: ts.Expression): boolean => {
  const value = unwrapExpression(expression);
  if (!ts.isCallExpression(value)) return false;
  const name = callName(value);
  if (isOneOf(name, ['useReducedMotion', 'useReduceMotion'])) return true;
  return name === 'isReduceMotionEnabled' && callReceiver(value)?.endsWith('AccessibilityInfo') === true;
};

const reducedMotionPreferences = (sourceFile: ts.SourceFile): Set<string> => {
  const preferences = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.initializer && isReducedMotionPreferenceCall(node.initializer)) {
      if (ts.isIdentifier(node.name)) preferences.add(node.name.text);
      if (ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          if (ts.isIdentifier(element.name) && isOneOf(element.name.text, ['reduceMotion', 'isReducedMotion', 'isReduceMotionEnabled'])) {
            preferences.add(element.name.text);
          }
        }
      }
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return preferences;
};

const isInside = (node: ts.Node, ancestor: ts.Node) => {
  let current: ts.Node | undefined = node;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
};

const alwaysReturns = (statement: ts.Statement): boolean => {
  if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) return true;
  if (ts.isBlock(statement)) return statement.statements.length > 0 && alwaysReturns(statement.statements[statement.statements.length - 1]);
  return ts.isIfStatement(statement) && statement.elseStatement !== undefined && alwaysReturns(statement.thenStatement) && alwaysReturns(statement.elseStatement);
};

const isReducedPreferenceCondition = (expression: ts.Expression, preferences: Set<string>): boolean | undefined => {
  const condition = unwrapExpression(expression);
  if (ts.isIdentifier(condition) && preferences.has(condition.text)) return true;
  if (ts.isPrefixUnaryExpression(condition) && condition.operator === ts.SyntaxKind.ExclamationToken && ts.isIdentifier(condition.operand) && preferences.has(condition.operand.text)) return false;
  if (ts.isBinaryExpression(condition) && (condition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken || condition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken || condition.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken || condition.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken)) {
    const left = unwrapExpression(condition.left);
    const right = unwrapExpression(condition.right);
    const preference = ts.isIdentifier(left) && preferences.has(left.text) ? left : ts.isIdentifier(right) && preferences.has(right.text) ? right : undefined;
    const boolean = left.kind === ts.SyntaxKind.TrueKeyword || right.kind === ts.SyntaxKind.TrueKeyword ? true : left.kind === ts.SyntaxKind.FalseKeyword || right.kind === ts.SyntaxKind.FalseKeyword ? false : undefined;
    if (preference && boolean !== undefined) {
      const equality = condition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken || condition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken;
      return equality ? boolean : !boolean;
    }
  }
  return undefined;
};

const hasReducedMotionEarlyReturnGate = (node: ts.Node, preferences: Set<string>): boolean => {
  let ancestor: ts.Node | undefined = node.parent;
  while (ancestor) {
    if (ts.isBlock(ancestor)) {
      const containing = ancestor.statements.find(statement => isInside(node, statement));
      const index = containing ? ancestor.statements.indexOf(containing) : -1;
      if (index > 0) {
        for (const statement of ancestor.statements.slice(0, index)) {
          if (ts.isIfStatement(statement) && isReducedPreferenceCondition(statement.expression, preferences) === true && alwaysReturns(statement.thenStatement)) {
            return true;
          }
        }
      }
    }
    if (ts.isFunctionLike(ancestor)) return false;
    ancestor = ancestor.parent;
  }
  return false;
};

const hasReducedMotionAncestorGate = (node: ts.Node, preferences: Set<string>): boolean => {
  if (hasReducedMotionEarlyReturnGate(node, preferences)) return true;
  let ancestor: ts.Node | undefined = node.parent;
  while (ancestor) {
    if (ts.isConditionalExpression(ancestor) && isPreferenceGate(ancestor, preferences)) {
      const disabledTrue = isDisabledMotionValue(ancestor.whenTrue);
      const disabledFalse = isDisabledMotionValue(ancestor.whenFalse);
      if ((isInside(node, ancestor.whenTrue) && !disabledTrue) || (isInside(node, ancestor.whenFalse) && !disabledFalse)) return true;
    }
    if (ts.isIfStatement(ancestor)) {
      const reducedWhenTrue = isReducedPreferenceCondition(ancestor.expression, preferences);
      if (reducedWhenTrue === false && isInside(node, ancestor.thenStatement)) return true;
      if (reducedWhenTrue === true && ancestor.elseStatement && isInside(node, ancestor.elseStatement)) return true;
    }
    ancestor = ancestor.parent;
  }
  return false;
};

const hasZeroDurationPreferenceGate = (call: ts.CallExpression, preferences: Set<string>): boolean => {
  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (ts.isPropertyAssignment(node) && propertyName(node.name) === 'duration' && isPreferenceGate(node.initializer, preferences)) {
      found = true;
      return;
    }
    node.forEachChild(visit);
  };
  for (const argument of call.arguments) visit(argument);
  return found;
};

const isTransitionAttribute = (node: ts.Node): node is ts.JsxAttribute =>
  ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && isOneOf(node.name.text, ['entering', 'exiting', 'layout']) && node.initializer !== undefined;

const countReducedMotionViolations = (file: string, text: string): number => {
  if (!/withTiming|withSpring|withDecay|withRepeat|withDelay|withSequence|Animated\.(?:timing|spring|decay|loop)|LayoutAnimation\.(?:configureNext|create)|\b(?:entering|exiting|layout)\s*=/.test(text)) return 0;
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const triggers: ts.Node[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isCallExpression(node) && isAnimationTriggerCall(node)) || isTransitionAttribute(node)) triggers.push(node);
    node.forEachChild(visit);
  };
  visit(sourceFile);
  if (triggers.length === 0) return 0;

  const preferences = reducedMotionPreferences(sourceFile);
  const everyTriggerIsGated = preferences.size > 0 && triggers.every(trigger => {
    if (isTransitionAttribute(trigger)) {
      const expression = ts.isJsxExpression(trigger.initializer) ? trigger.initializer.expression : undefined;
      return (expression !== undefined && hasPreferenceGate(expression, preferences)) || hasReducedMotionAncestorGate(trigger, preferences);
    }
    return (
      (isAnimationTriggerCall(trigger as ts.CallExpression) && hasZeroDurationPreferenceGate(trigger as ts.CallExpression, preferences)) ||
      hasReducedMotionAncestorGate(trigger, preferences)
    );
  });
  return everyTriggerIsGated || REDUCE_MOTION_ALLOWLIST[file]?.trim() ? 0 : 1;
};

const isNumericLiteral = (expression: ts.Expression): boolean => {
  const value = unwrapExpression(expression);
  return ts.isNumericLiteral(value) || (ts.isPrefixUnaryExpression(value) && ts.isNumericLiteral(value.operand));
};

const hasMotionConfigurationAncestor = (node: ts.Node): boolean => {
  let ancestor: ts.Node | undefined = node.parent;
  while (ancestor && !ts.isSourceFile(ancestor)) {
    if (ts.isCallExpression(ancestor) && isMotionConfigurationCall(ancestor)) return true;
    if (ts.isFunctionLike(ancestor)) return false;
    ancestor = ancestor.parent;
  }
  return false;
};

const countMotionLiterals = (_file: string, text: string): number => {
  if (!/withTiming|withSpring|withDecay|Animated\.|LayoutAnimation\.|Easing\.|\bspring\s*\(|\bduration\s*\(/.test(text)) return 0;
  const sourceFile = ts.createSourceFile('motion.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let count = 0;
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && isOneOf(propertyName(node.name), ['duration', 'stiffness', 'damping']) && isNumericLiteral(node.initializer) && hasMotionConfigurationAncestor(node)) {
      count += 1;
    }
    if (ts.isCallExpression(node)) {
      const receiver = callReceiver(node);
      if (receiver === 'Easing' || isAnimationTransitionDurationCall(node)) {
        count += node.arguments.filter(argument => isNumericLiteral(argument)).length;
      }
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return count;
};

const isAnimatedValueDerivation = (expression: ts.Expression, animatedNames: Set<string>): boolean => {
  const value = unwrapExpression(expression);
  if (ts.isIdentifier(value)) return animatedNames.has(value.text);
  if (ts.isPropertyAccessExpression(value) && value.name.text === 'interpolate') return [...collectReferences(value.expression)].some(reference => animatedNames.has(reference));
  if (hasAnimatedStyleValue(value, animatedNames)) return true;
  if (ts.isCallExpression(value)) {
    const name = callName(value);
    const receiver = callReceiver(value);
    const isDerivation = name === 'interpolate' || (receiver === 'Animated' && isOneOf(name, ['add', 'subtract', 'multiply', 'divide', 'modulo', 'diffClamp', 'interpolate']));
    return isDerivation && [...collectReferences(value)].some(reference => animatedNames.has(reference));
  }
  return false;
};

const hasAnimatedStyleValue = (expression: ts.Expression, animatedNames: Set<string>): boolean => {
  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (
      (ts.isPropertyAccessExpression(node) && node.name.text === 'value') ||
      (ts.isCallExpression(node) && callName(node) === 'interpolate') ||
      (ts.isIdentifier(node) && animatedNames.has(node.text))
    ) {
      found = true;
      return;
    }
    node.forEachChild(visit);
  };
  visit(expression);
  return found;
};

const countAnimatedLayoutProperties = (
  expression: ts.Expression,
  animatedNames: Set<string>,
  declarations: Map<string, ts.Expression>,
  visited = new Set<string>(),
): number => {
  const value = unwrapExpression(expression);
  if (ts.isArrayLiteralExpression(value)) return value.elements.reduce((sum, element) => ts.isExpression(element) ? sum + countAnimatedLayoutProperties(element, animatedNames, declarations, visited) : sum, 0);
  if (ts.isIdentifier(value)) {
    if (visited.has(value.text)) return 0;
    const initializer = declarations.get(value.text);
    if (!initializer) return 0;
    const nextVisited = new Set(visited).add(value.text);
    return countAnimatedLayoutProperties(initializer, animatedNames, declarations, nextVisited);
  }
  if (ts.isCallExpression(value)) return value.arguments.reduce((sum, argument) => sum + countAnimatedLayoutProperties(argument, animatedNames, declarations, visited), 0);
  if (!ts.isObjectLiteralExpression(value)) return 0;

  let count = 0;
  for (const property of value.properties) {
    if (ts.isPropertyAssignment(property)) {
      const initializer = property.initializer;
      if (isLayoutProperty(propertyName(property.name)) && hasAnimatedStyleValue(initializer, animatedNames)) count += 1;
      else if (ts.isObjectLiteralExpression(unwrapExpression(initializer)) || ts.isArrayLiteralExpression(unwrapExpression(initializer)) || ts.isIdentifier(unwrapExpression(initializer))) {
        count += countAnimatedLayoutProperties(initializer, animatedNames, declarations, visited);
      }
    } else if (ts.isShorthandPropertyAssignment(property) && isLayoutProperty(property.name.text) && animatedNames.has(property.name.text)) {
      count += 1;
    } else if (ts.isSpreadAssignment(property)) {
      count += countAnimatedLayoutProperties(property.expression, animatedNames, declarations, visited);
    }
  }
  return count;
};

const countLayoutAnimationViolations = (file: string, text: string): number => {
  if (!/useAnimatedStyle|Animated\.(?:timing|spring|decay)/.test(text)) return 0;
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  let violations = 0;
  const animatedNames = new Set<string>();
  const declarations = new Map<string, ts.Expression>();

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && isReactNativeAnimatedValueCall(node) && node.arguments[0]) {
      for (const name of collectReferences(node.arguments[0])) animatedNames.add(name);
    }

    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      declarations.set(node.name.text, node.initializer);
      if (ts.isCallExpression(node.initializer) && isOneOf(callName(node.initializer), ['useSharedValue', 'useDerivedValue', 'makeMutable'])) {
        animatedNames.add(node.name.text);
      }
    }

    node.forEachChild(visit);
  };

  visit(sourceFile);

  let aliasesChanged = true;
  while (aliasesChanged) {
    aliasesChanged = false;
    for (const [name, initializer] of declarations) {
      if (!animatedNames.has(name) && isAnimatedValueDerivation(initializer, animatedNames)) {
        animatedNames.add(name);
        aliasesChanged = true;
      }
    }
  }

  const countStyles = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'useAnimatedStyle') {
      const callback = node.arguments[0];
      if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
        for (const expression of returnedExpressions(callback.body)) {
          const returned = unwrapExpression(expression);
          if (!ts.isObjectLiteralExpression(returned)) continue;
          for (const property of returned.properties) {
            if (
              (ts.isPropertyAssignment(property) && isLayoutProperty(propertyName(property.name)) && hasAnimatedStyleValue(property.initializer, animatedNames)) ||
              (ts.isShorthandPropertyAssignment(property) && isLayoutProperty(property.name.text) && animatedNames.has(property.name.text))
            ) {
              violations += 1;
            }
          }
        }
      }
    }
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.name.text === 'style' && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression) {
      violations += countAnimatedLayoutProperties(node.initializer.expression, animatedNames, declarations);
    }
    node.forEachChild(countStyles);
  };
  countStyles(sourceFile);
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
    expect(countFileRule('motionLiteral', 'components/Scratch.tsx', 'withTiming(1, { duration: 300 });')).toBe(1);
    expect(countFileRule('motionLiteral', 'store/positionStore.ts', 'const metadata = { duration: 0 };')).toBe(0);
    expect(countFileRule('motionLiteral', 'components/Scratch.tsx', 'Animated.spring(value, { stiffness: 100, damping: 20 }); LayoutAnimation.configureNext({ duration: 180 }); Easing.bezier(0.1, 0.2, 0.3, 0.4);')).toBe(7);
    expect(countFileRule('motionLiteral', 'constants/Scratch.ts', 'withTiming(1, { duration: 120 });')).toBe(0);
  });

  it('requires the reduced-motion preference to gate animation', () => {
    expect(countFileRule('reduceMotion', 'components/Scratch.tsx', 'withTiming(1);')).toBe(1);
    expect(countFileRule('reduceMotion', 'components/Scratch.tsx', 'const reduce = useReducedMotion(); withTiming(1);')).toBe(1);
    expect(countFileRule('reduceMotion', 'components/Scratch.tsx', '// useReducedMotion()\nwithTiming(1);')).toBe(1);
    expect(countFileRule('reduceMotion', 'components/Scratch.tsx', 'const reduce = useReducedMotion(); withTiming(1, { duration: reduce ? 0 : 300 });')).toBe(0);
    expect(countFileRule('reduceMotion', 'components/Scratch.tsx', 'const reduce = useReducedMotion(); withTiming(1, { duration: reduce ? 300 : 0 });')).toBe(1);
    expect(countFileRule('reduceMotion', 'components/Scratch.tsx', 'async function animate() { const reduce = await AccessibilityInfo.isReduceMotionEnabled(); withTiming(1, { duration: reduce ? 0 : 300 }); }')).toBe(0);
    expect(countFileRule('reduceMotion', 'components/Scratch.tsx', 'function animate() { const reduce = useReducedMotion(); if (reduce) return; withTiming(1); }')).toBe(0);
    expect(countFileRule('reduceMotion', 'components/Scratch.tsx', 'const view = <Animated.View exiting={FadeOut} />;')).toBe(1);
    expect(countFileRule('reduceMotion', 'components/Scratch.tsx', 'const view = <Animated.View entering={FadeIn} />;')).toBe(1);
    expect(countFileRule('reduceMotion', 'components/Scratch.tsx', 'const view = <Animated.View layout={LinearTransition} />;')).toBe(1);
  });

  it('requires a non-empty reason for every reduced-motion exception', () => {
    expect(Object.entries(REDUCE_MOTION_ALLOWLIST).every(([file, reason]) => file.trim() && reason.trim())).toBe(true);
  });

  it('flags layout properties in animated-style scratch code', () => {
    expect(countFileRule('layoutAnim', 'components/Scratch.tsx', 'useAnimatedStyle(() => ({ height: value.value }));')).toBe(1);
    expect(
      countFileRule(
        'layoutAnim',
        'components/Scratch.tsx',
        'const size = new Animated.Value(0); Animated.timing(size, { toValue: 1 }); const view = <Animated.View style={{ height: size }} />;',
      ),
    ).toBe(1);
    expect(
      countFileRule(
        'layoutAnim',
        'components/Scratch.tsx',
        'const width = new Animated.Value(0); Animated.timing(width, { toValue: 1 }); const view = <Animated.View style={{ opacity: width }} />;',
      ),
    ).toBe(0);
    expect(
      countFileRule(
        'layoutAnim',
        'components/Scratch.tsx',
        'const progress = useSharedValue(0); const height = interpolate(progress.value, [0, 1], [10, 20]); const style = useAnimatedStyle(() => ({ height }));',
      ),
    ).toBe(1);
  });

  it('ignores static layout styles beside transform-only animated styles', () => {
    const source = fs.readFileSync(path.join(SRC, 'components', 'NowPlayingBackground.tsx'), 'utf8');
    expect(countFileRule('layoutAnim', 'components/NowPlayingBackground.tsx', source)).toBe(0);
  });
});
