import { catalogShelfTitle } from './shelfTitles';

test('YouTube Music’s "Quick picks" no longer repeats ours', () => {
  expect(catalogShelfTitle('Quick picks', ['Jump back in', 'Quick picks'])).toBe('More picks for you');
  expect(catalogShelfTitle(' quick PICKS ', ['Quick picks'])).toBe('More picks for you');
});

test('a catalog title keeps its name when ours does not use it', () => {
  expect(catalogShelfTitle('Quick picks', ['Jump back in'])).toBe('Quick picks');
  expect(catalogShelfTitle('Trending in Hindi', ['Quick picks'])).toBe('Trending in Hindi');
});

test('any other repeated title still reads differently', () => {
  expect(catalogShelfTitle('Made for you', ['Made for you'])).toBe('More made for you');
});
