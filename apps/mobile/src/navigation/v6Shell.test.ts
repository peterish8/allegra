import { shellNavHeight, shellHeight } from './v6Shell';
it('uses the compact navigation below 700 while preserving larger safe areas', () => {
  expect(shellNavHeight(699, 0)).toBe(72);
  expect(shellNavHeight(700, 16)).toBe(80);
  expect(shellNavHeight(699, 24)).toBe(88);
});
it('reserves seek, mini row and navigation, with room for large text', () => {
  expect(shellHeight(800, 16, false, 1)).toBe(80);
  expect(shellHeight(800, 16, true, 1)).toBe(160);
  expect(shellHeight(800, 16, true, 2)).toBe(176);
});
