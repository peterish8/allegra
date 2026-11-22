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

it('animates itself: grows out of the mark, scales only without Reduce Motion', () => {
  expect(source).toContain('animationType="none"');
  expect(source).toContain("transformOrigin: 'top right'");
  expect(source).toContain('scale: reduceMotion ? 1 : ENTER_SCALE');
  expect(source).toContain('else shown.value = withSpring(1, Motion.spring.open)');
});

it('follows a finger on its grabber and is thrown away like the sheets', () => {
  // 1:1 up, rubber-banded down, dismissal projected from the release speed.
  expect(source).toContain('<GestureDetector gesture={pull}>');
  expect(source).toContain('drag.value = y < 0 ? y : rubberBand(y, STRETCH)');
  expect(source).toContain('projectMomentum(e.velocityY)');
  expect(source).toContain('releaseSpring(e.velocityY, e.velocityY)');
});
