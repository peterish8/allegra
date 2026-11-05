import { playlistUndoOrder } from './playlistUndoOrder';
it('restores a removed song to its old place', () => expect(playlistUndoOrder(['a', 'b', 'c'], ['b', 'c', 'a'])).toEqual(['a', 'b', 'c']));
it('preserves later additions and does not resurrect other removed songs', () => expect(playlistUndoOrder(['a', 'b', 'c'], ['a', 'c', 'new'])).toEqual(['a', 'c', 'new']));
