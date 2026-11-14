import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const source = fs.readFileSync(path.join(__dirname, 'StreamScreen.tsx'), 'utf8');
const file = ts.createSourceFile('StreamScreen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nodes: ts.Node[] = [];
const visit = (node: ts.Node) => { nodes.push(node); ts.forEachChild(node, visit); };
visit(file);

// Stream's Devices and Updates controls stay reachable while feed sections hydrate or scroll.
it('keeps the Stream Connect entry outside the scrolling or recycled feed', () => {
  const devices = nodes.find(node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === 'ConnectDropdown');
  expect(devices).toBeDefined();
  const ancestors: string[] = [];
  for (let node = devices?.parent; node; node = node.parent) {
    if (ts.isJsxElement(node)) ancestors.push(node.openingElement.tagName.getText(file));
    if (ts.isJsxAttribute(node)) ancestors.push(node.name.getText(file));
  }
  expect(ancestors).toContain('AppScreen');
  expect(ancestors).not.toContain('ListHeaderComponent');
  expect(ancestors).not.toContain('FlashList');
});

it('replaces the Stream explanation with the LuvLyrics updates dropdown', () => {
  expect(source).toContain('<StreamUpdatesDropdown');
  expect(source).not.toContain('About Stream');
  expect(source).not.toContain('STREAM_TOUR');
  expect(source.indexOf('<ConnectDropdown />')).toBeLessThan(source.indexOf('<StreamUpdatesDropdown'));
});

const flashList = () => nodes.find(node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === 'FlashList') as ts.JsxSelfClosingElement;
const listProp = (name: string) => flashList().attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.getText(file) === name);

it('does not let asynchronously restored home sections anchor the initial view below the header', () => {
  expect(listProp('maintainVisibleContentPosition')?.getText(file)).toMatch(/disabled:\s*true/);
});

// Owner report, 2026-11-06 (UI-01 / UI-03): "Jump back in" drew over the mood chips and a tall blank gap followed a
// short grid. FlashList placed the first section from a stale header offset and kept stale section sizes.
describe('feed measurement', () => {
  it('puts the mood chips in the feed as its first item, not in ListHeaderComponent', () => {
    expect(listProp('ListHeaderComponent')).toBeUndefined();
    expect(source).toMatch(/\[moodsSection, [^\n]*\.\.\.homeSections\]/);
  });

  it('keeps Reanimated layout animations out of the recycled feed cells', () => {
    const render = nodes.find(node => ts.isVariableDeclaration(node) && node.name.getText(file) === 'renderSection');
    expect(render?.getText(file)).not.toMatch(/RiseIn|entering=/);
  });
});

it('binds the header glow to the feed scroll and draws it instead of the static glow', () => {
  expect(source).toMatch(/<AppScreen[^>]*staticGlow=\{false\}/);
  expect(source).toMatch(/<HeaderGlow \{\.\.\.glow\.props\} \/>/);
  expect(source).toMatch(/glowScrolled\(contentOffset\.y\)/);
  expect(listProp('onScroll')?.getText(file)).toBe('onScroll={onScroll}');
});
