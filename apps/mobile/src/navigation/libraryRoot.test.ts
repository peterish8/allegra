import { libraryRootMove } from './libraryRoot';

const stack = (names: string[], index?: number) => ({ routes: names.map(name => ({ name })), ...(index === undefined ? {} : { index }) });

describe('libraryRootMove', () => {
  it('does nothing on the Library home, or before the stack exists', () => {
    expect(libraryRootMove(undefined)).toBe('none');
    expect(libraryRootMove(stack([]))).toBe('none');
    expect(libraryRootMove(stack(['LibraryHome']))).toBe('none');
  });

  it('pops back to the home from Playlists or a playlist', () => {
    expect(libraryRootMove(stack(['LibraryHome', 'Playlists']))).toBe('pop');
    expect(libraryRootMove(stack(['LibraryHome', 'Playlists', 'PlaylistDetail']))).toBe('pop');
  });

  it('replaces a stack that was opened on a deeper screen with no home under it', () => {
    expect(libraryRootMove(stack(['Playlists']))).toBe('reset');
    expect(libraryRootMove(stack(['PlaylistDetail']))).toBe('reset');
  });

  it('reads the screen in front, not the last one in the list', () => {
    expect(libraryRootMove(stack(['LibraryHome', 'Playlists'], 0))).toBe('none');
  });
});
