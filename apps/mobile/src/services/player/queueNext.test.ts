jest.mock('../../store/playerStore', () => ({ usePlayerStore: { getState: () => ({}) }, usesNativeQueue: () => false, prepareNextInQueue: () => undefined }));
jest.mock('../../playback/nativeQueue', () => ({ fire: () => undefined, nativeQueue: {} }));

import { withSongNext } from './queueNext';
import type { Song } from '../../types/song';

const song = (id: string) => ({ id, title: id }) as Song;

describe('withSongNext', () => {
  it('puts the song right after the playing one', () => {
    expect(withSongNext([song('a'), song('b'), song('c')], 'a', song('x')).map(s => s.id)).toEqual(['a', 'x', 'b', 'c']);
  });

  it('moves a song already in the queue instead of adding it twice', () => {
    expect(withSongNext([song('a'), song('b'), song('c')], 'a', song('c')).map(s => s.id)).toEqual(['a', 'c', 'b']);
  });

  it('keeps earlier songs where they are, for Previous', () => {
    expect(withSongNext([song('a'), song('b'), song('c')], 'b', song('x')).map(s => s.id)).toEqual(['a', 'b', 'x', 'c']);
  });
});
