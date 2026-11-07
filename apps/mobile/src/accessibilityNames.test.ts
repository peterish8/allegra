import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

/**
 * Every control a finger can press has a name TalkBack can read (1.41.2).
 *
 * The audit found the classic mini player's cover, previous, play/pause, next, like and video buttons, the video
 * player's buttons and the lyrics search's close button announced as a bare "Button", and dialog scrims announced as
 * nameless buttons. This walks every screen and component with the TypeScript compiler and fails on a pressable with
 * an onPress / onLongPress but no accessible name: an `accessibilityLabel` (or `aria-label`), visible text inside it,
 * spread props that carry one, or being deliberately hidden from TalkBack (scrims, which Back closes).
 */
const SRC = __dirname;
const PRESSABLES = new Set(['Pressable', 'Tactile', 'TouchableOpacity', 'TouchableHighlight', 'TouchableWithoutFeedback', 'RectButton', 'BorderlessButton']);
const TEXT_TAGS = /^(Text|SwapText|Marquee|SwapMarquee|WordRow|Animated\.Text)$/;
const NAMED = new Set(['accessibilityLabel', 'aria-label', 'accessible', 'importantForAccessibility', 'accessibilityElementsHidden', 'aria-hidden']);

const files = (dir: string): string[] => fs.readdirSync(dir).flatMap(name => {
  const p = path.join(dir, name);
  if (fs.statSync(p).isDirectory()) return name === '__tests__' ? [] : files(p);
  return p.endsWith('.tsx') && !p.includes('.test.') ? [p] : [];
});

const unnamed = (file: string): string[] => {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const hasText = (node: ts.Node): boolean => {
    let found = false;
    const visit = (n: ts.Node) => {
      if (found) return;
      if (ts.isJsxText(n) && n.text.trim()) found = true;
      else if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && TEXT_TAGS.test(n.tagName.getText())) found = true;
      else ts.forEachChild(n, visit);
    };
    ts.forEachChild(node, visit);
    return found;
  };
  const visit = (n: ts.Node) => {
    const open = ts.isJsxElement(n) ? n.openingElement : ts.isJsxSelfClosingElement(n) ? n : null;
    if (open && PRESSABLES.has(open.tagName.getText())) {
      const attrs = open.attributes.properties.map(a => (ts.isJsxSpreadAttribute(a) ? '...' : a.name.getText()));
      const pressable = attrs.some(a => a === 'onPress' || a === 'onLongPress');
      const named = attrs.some(a => a === '...' || NAMED.has(a));
      if (pressable && !named && !(ts.isJsxElement(n) && hasText(n))) {
        const { line } = source.getLineAndCharacterOfPosition(open.getStart());
        out.push(`${path.relative(SRC, file)}:${line + 1} <${open.tagName.getText()}>`);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(source);
  return out;
};

it('every pressable control has a name TalkBack can read, or is deliberately hidden from it', () => {
  const missing = files(SRC).flatMap(unnamed);
  expect(missing).toEqual([]);
});

it('the classic mini player names its transport and like buttons', () => {
  const mini = fs.readFileSync(path.join(SRC, 'components', 'MiniPlayer.tsx'), 'utf8');
  for (const label of ['"Previous song"', '"Next song"', "playing ? 'Pause' : 'Play'", "'Remove from liked songs' : 'Add to liked songs'", '"Watch the video"']) {
    expect(mini).toContain(label);
  }
});
