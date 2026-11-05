import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const source = fs.readFileSync(path.join(__dirname, 'StreamScreen.tsx'), 'utf8');
const file = ts.createSourceFile('StreamScreen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nodes: ts.Node[] = [];
const visit = (node: ts.Node) => { nodes.push(node); ts.forEachChild(node, visit); };
visit(file);

it('keeps the Stream update entry outside the scrolling or recycled feed', () => {
  const about = nodes.find(node => ts.isJsxAttribute(node) && node.name.getText(file) === 'accessibilityLabel' && node.getText(file).includes('About LuvLyrics'));
  expect(about).toBeDefined();
  const ancestors: string[] = [];
  for (let node = about?.parent; node; node = node.parent) {
    if (ts.isJsxElement(node)) ancestors.push(node.openingElement.tagName.getText(file));
    if (ts.isJsxAttribute(node)) ancestors.push(node.name.getText(file));
  }
  expect(ancestors).toContain('AppScreen');
  expect(ancestors).not.toContain('ListHeaderComponent');
  expect(ancestors).not.toContain('FlashList');
});

it('does not let asynchronously restored home sections anchor the initial view below the header', () => {
  const list = nodes.find(node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === 'FlashList') as ts.JsxSelfClosingElement;
  const policy = list.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.getText(file) === 'maintainVisibleContentPosition');
  expect(policy?.getText(file)).toMatch(/disabled:\s*true/);
});
