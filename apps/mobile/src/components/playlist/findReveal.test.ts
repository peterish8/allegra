import { FIND_BAR_HEIGHT, findFiller, settleFind } from './playlistPage';

describe('the find bar hides above the cover and a pull reveals it', () => {
  test('a list resting at the bar’s height stays put', () => {
    expect(settleFind(FIND_BAR_HEIGHT, 0)).toBe('rest');
    expect(settleFind(FIND_BAR_HEIGHT + 300, -2)).toBe('rest');
  });
  test('a full pull (offset 0 or the rubber band above it) reveals', () => {
    expect(settleFind(0, 0)).toBe('reveal');
    expect(settleFind(-20, 0)).toBe('reveal');
  });
  test('part way, the nearer end wins', () => {
    expect(settleFind(FIND_BAR_HEIGHT * 0.25, 0)).toBe('reveal');
    expect(settleFind(FIND_BAR_HEIGHT * 0.75, 0)).toBe('hide');
  });
  test('a fling decides: down reveals, up hides', () => {
    expect(settleFind(FIND_BAR_HEIGHT * 0.9, -0.8)).toBe('reveal');
    expect(settleFind(FIND_BAR_HEIGHT * 0.1, 0.8)).toBe('hide');
  });
  test('a bad number never reveals by accident', () => {
    expect(settleFind(Number.NaN, 0)).toBe('rest');
  });
});

describe('a short playlist can still rest past the bar', () => {
  test('pads the content up to the viewport plus the bar', () => {
    expect(findFiller(800, 500)).toBe(800 + FIND_BAR_HEIGHT - 500);
  });
  test('adds nothing to a long playlist', () => {
    expect(findFiller(800, 5000)).toBe(0);
  });
  test('adds nothing before the list is measured', () => {
    expect(findFiller(0, 100)).toBe(0);
    expect(findFiller(Number.NaN, 100)).toBe(0);
  });
});

describe('the playlist page', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const screen = (require('fs') as typeof import('fs')).readFileSync(require('path').join(__dirname, '..', '..', 'screens', 'PlaylistDetailScreen.tsx'), 'utf8');
  test('rests past the find bar and settles a pull with settleFind', () => {
    expect(screen).toMatch(/scrollToOffset\(\{ offset: FIND_BAR_HEIGHT, animated: false \}\)/);
    expect(screen).toMatch(/onScrollEndDrag/);
    expect(screen).toMatch(/settleFind\(offset, velocity\)/);
  });
  test('draws the back arrow and the options button without a disc', () => {
    expect(screen).toMatch(/icon="arrow-back" label="Back" variant="plain"/);
    expect(screen).toMatch(/icon="ellipsis-vertical" label="Playlist options" variant="plain"/);
    expect(screen).not.toMatch(/shape="disc"/);
  });
});
