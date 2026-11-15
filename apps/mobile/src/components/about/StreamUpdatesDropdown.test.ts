import * as fs from 'fs';
import * as path from 'path';

const source = fs.readFileSync(path.join(__dirname, 'StreamUpdatesDropdown.tsx'), 'utf8');

it('uses the branded button and keeps the updates-only dropdown accessible and dismissible', () => {
  // Owner, 1.69.0: the black-and-white mark, not the colour logo.
  expect(source).toContain("require('../../../assets/luvlyrics-icon-monochrome.png')");
  expect(source).not.toContain('luvlyrics_logo_med.png');
  expect(source).toContain('logo: { width: 40, height: 40 }');
  expect(source).toContain('accessibilityLabel="LuvLyrics updates"');
  expect(source).toContain('accessibilityState={{ expanded: open }}');
  expect(source).toContain('onRequestClose={close}');
  expect(source).toContain('accessibilityLabel="Dismiss updates"');
  expect(source).toContain('nestedScrollEnabled');
  expect(source).toContain('<UpdatePanel visible={open} dropdown onClose={close} />');
  expect(source).toContain('backgroundColor: Surface.deep');
  expect(source).toContain('backgroundColor: Glass.scrim');
  expect(source).not.toContain('Frosted');
});

it('avoids a modal fade when Reduce Motion is enabled', () => {
  expect(source).toContain("animationType={reduceMotion ? 'none' : 'fade'}");
});
