jest.mock('../services/NativeAudioPlayer', () => ({
  NativeAudioPlayer: {
    hasQueue: () => true,
    setQueue: jest.fn(async () => true),
    replaceQueue: jest.fn(async () => true),
    playNext: jest.fn(async () => true),
    addToQueue: jest.fn(async () => true),
    removeFromQueue: jest.fn(async () => true),
    load: jest.fn(async () => undefined),
  },
}));

import { NativeAudioPlayer } from '../services/NativeAudioPlayer';
import {
  MAX_NATIVE_QUEUE,
  currentQueueTag,
  engineHolds,
  forgetEngineQueue,
  isRunningLow,
  mirrorOf,
  nativeQueue,
  noteEngineQueue,
  playlistIdOf,
  previousWillRestart,
  queueTag,
  sameIds,
  songFromNative,
  toNativeItem,
  toNativeItems,
  windowAround,
} from './nativeQueue';
import type { Song } from '../types/song';

// `null` is a song with nowhere to play from (a default of `undefined` would be filled in).
const song = (id: string, audioUri: string | null = `file:///${id}.mp3`): Song =>
  ({ id, title: id.toUpperCase(), artist: 'Artist', gradientId: 'g', duration: 0, dateCreated: '', dateModified: '', playCount: 0, lyrics: [], audioUri: audioUri ?? undefined }) as Song;
const ids = (songs: readonly Song[]) => songs.map(s => s.id);
const native = NativeAudioPlayer as unknown as Record<string, jest.Mock>;

beforeEach(() => {
  for (const key of ['setQueue', 'replaceQueue', 'playNext', 'addToQueue', 'removeFromQueue', 'load']) native[key].mockClear();
  forgetEngineQueue();
});

describe('what the engine is given', () => {
  it('leaves out a song with nowhere to play from', () => {
    expect(toNativeItem(song('a', null))).toBeNull();
    expect(toNativeItems([song('a'), song('b', null), song('c')]).map(i => i.id)).toEqual(['a', 'c']);
  });

  it('fills in plain defaults for missing details', () => {
    const item = toNativeItem({ ...song('a'), title: '', artist: undefined })!;
    expect(item).toMatchObject({ id: 'a', uri: 'file:///a.mp3', title: 'Unknown Title', artist: 'Unknown Artist', album: '', artworkUri: '' });
  });

  it('turns what only the engine knows back into a usable song', () => {
    const back = songFromNative({ id: 'x', uri: 'https://cdn/x.m4a', title: 'X', artist: 'Y', album: '', artworkUri: 'https://img/x.jpg' });
    expect(back).toMatchObject({ id: 'x', title: 'X', artist: 'Y', audioUri: 'https://cdn/x.m4a', coverImageUri: 'https://img/x.jpg', lyrics: [] });
    expect(back.album).toBeUndefined();
  });
});

describe('windowAround', () => {
  it('points the start at the tapped song even when songs before it cannot play', () => {
    const songs = [song('a', null), song('b'), song('c', null), song('d'), song('e')];
    const { songs: kept, start } = windowAround(songs, 3);
    expect(ids(kept)).toEqual(['b', 'd', 'e']);
    expect(kept[start].id).toBe('d');
  });

  it('cuts a huge queue to a window that still holds the start song', () => {
    const songs = Array.from({ length: 5_000 }, (_, i) => song(`s${i}`));
    for (const tapped of [0, 10, 2_500, 4_999]) {
      const { songs: kept, start } = windowAround(songs, tapped);
      expect(kept.length).toBe(MAX_NATIVE_QUEUE);
      expect(kept[start].id).toBe(`s${tapped}`);
    }
  });

  it('keeps a short queue whole', () => {
    expect(windowAround([song('a'), song('b')], 1)).toMatchObject({ start: 1 });
  });
});

describe('queue tags', () => {
  it('carry the playlist id in front of the session', () => {
    expect(queueTag('library', 7)).toBe('library#7');
    expect(playlistIdOf('library#7')).toBe('library');
    expect(playlistIdOf('stream#12')).toBe('stream');
    expect(playlistIdOf(null)).toBeNull();
    expect(playlistIdOf('plain')).toBe('plain');
  });
});

describe('rules the engine also applies', () => {
  it('previous starts the song over past 3 s or with nothing before it', () => {
    expect(previousWillRestart(3.5, 4, 'all')).toBe(true);
    expect(previousWillRestart(1, 4, 'off')).toBe(false);
    expect(previousWillRestart(1, 0, 'off')).toBe(true);
    expect(previousWillRestart(1, 0, 'one')).toBe(true);
    expect(previousWillRestart(1, 0, 'all')).toBe(false);
  });

  it('knows when the queue is running low (the playing song plus four)', () => {
    expect(isRunningLow(10, 5)).toBe(true);
    expect(isRunningLow(10, 4)).toBe(false);
    expect(isRunningLow(3, 0)).toBe(true);
    expect(isRunningLow(3, -1)).toBe(false);
  });

  it('compares id lists', () => {
    expect(sameIds(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameIds(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(sameIds(['a'], ['a', 'b'])).toBe(false);
  });

  it('builds the screen queue from ids, or says an id is unknown', () => {
    const have = new Map([['a', song('a')], ['b', song('b')]]);
    expect(ids(mirrorOf(['b', 'a', 'b'], id => have.get(id))!)).toEqual(['b', 'a', 'b']);
    expect(mirrorOf(['a', 'zzz'], id => have.get(id))).toBeNull();
  });
});

describe('setQueue', () => {
  it('names the queue and makes later edits carry that name, even before the engine answers', async () => {
    let answer: (ok: boolean) => void = () => undefined;
    native.setQueue.mockReturnValueOnce(new Promise<boolean>(r => { answer = r; }));
    const pending = nativeQueue.setQueue([song('a'), song('b')], 1, 'library', true);

    const tag = currentQueueTag()!;
    expect(playlistIdOf(tag)).toBe('library');
    expect(engineHolds('a')).toBe(true);
    await nativeQueue.insert([song('c')], 'end');
    expect(native.addToQueue.mock.calls[0][2]).toBe(tag);

    answer(true);
    expect(await pending).toBe(true);
    expect(native.setQueue).toHaveBeenCalledWith(expect.any(Array), 1, 0, true, tag);
  });

  it('forgets what it believed when the engine does not take the queue', async () => {
    native.setQueue.mockResolvedValueOnce(false);
    expect(await nativeQueue.setQueue([song('a')], 0, 'library', true)).toBe(false);
    expect(currentQueueTag()).toBeNull();
    expect(engineHolds('a')).toBe(false);
  });

  it('numbers every queue it sets, so an older answer can be told from the newest queue', async () => {
    await nativeQueue.setQueue([song('a')], 0, 'stream', true);
    const first = currentQueueTag();
    await nativeQueue.setQueue([song('b')], 0, 'stream', true);
    expect(currentQueueTag()).not.toBe(first);
    expect(playlistIdOf(currentQueueTag())).toBe('stream');
  });

  it('refuses a queue with nothing playable', async () => {
    expect(await nativeQueue.setQueue([song('a', null)], 0, 'library', true)).toBe(false);
    expect(native.setQueue).not.toHaveBeenCalled();
  });
});

describe('replace', () => {
  it('does nothing natively when only the details changed (lyrics landed)', async () => {
    noteEngineQueue({ ids: ['a', 'b'], tag: 'library#1' });
    expect(await nativeQueue.replace([{ ...song('a'), lyrics: [{ timestamp: 0, text: 'x', lineOrder: 0 }] }, song('b')])).toBe(true);
    expect(native.replaceQueue).not.toHaveBeenCalled();
  });

  it('reorders around the playing song, for the queue the screen believes the engine holds', async () => {
    noteEngineQueue({ ids: ['a', 'b', 'c'], tag: 'library#1' });
    await nativeQueue.replace([song('a'), song('c'), song('b')]);
    expect(native.replaceQueue).toHaveBeenCalledWith(expect.any(Array), 'library#1', null);
    expect(engineHolds('c')).toBe(true);
  });

  it('can turn the queue into another list while the song plays on (Radio)', async () => {
    noteEngineQueue({ ids: ['a'], tag: 'library#1' });
    await nativeQueue.replace([song('a'), song('r1')], 'stream');
    const [, expected, renamed] = native.replaceQueue.mock.calls[0];
    expect(expected).toBe('library#1');
    expect(playlistIdOf(renamed)).toBe('stream');
    expect(currentQueueTag()).toBe(renamed);
  });
});

describe('insert', () => {
  it('sends the tag of the queue the songs were found for, so a late answer is refused natively', async () => {
    noteEngineQueue({ ids: ['a'], tag: 'stream#9' });
    await nativeQueue.insert([song('r')], 'end', 'stream#8');
    expect(native.addToQueue).toHaveBeenCalledWith(expect.any(Array), true, 'stream#8');
  });

  it('puts songs right after the playing one', async () => {
    noteEngineQueue({ ids: ['a'], tag: 'stream#9' });
    await nativeQueue.insert([song('n')], 'next');
    expect(native.playNext).toHaveBeenCalledWith(expect.any(Array), true, 'stream#9');
  });

  it('sends nothing for songs with no address', async () => {
    expect(await nativeQueue.insert([song('x', null)], 'end')).toBe(false);
    expect(native.addToQueue).not.toHaveBeenCalled();
  });
});

describe('load', () => {
  it('replaces the song in place when the engine holds it (a fresh link), keeping the queue', async () => {
    noteEngineQueue({ ids: ['a', 'b'], tag: 'library#1' });
    await nativeQueue.load(song('b'), 'https://fresh/b.m4a', [song('a'), song('b')], 'library');
    expect(native.load).toHaveBeenCalledWith('https://fresh/b.m4a', expect.objectContaining({ mediaId: 'b' }));
    expect(native.setQueue).not.toHaveBeenCalled();
  });

  it('hands the engine the whole queue again when it lost it (the service restarted)', async () => {
    await nativeQueue.load(song('b'), 'https://fresh/b.m4a', [song('a'), song('b'), song('c')], 'library');
    expect(native.load).not.toHaveBeenCalled();
    const [items, start, , play] = native.setQueue.mock.calls[0];
    expect(items.map((i: { id: string }) => i.id)).toEqual(['a', 'b', 'c']);
    expect(items[1].uri).toBe('https://fresh/b.m4a');
    expect(start).toBe(1);
    expect(play).toBe(false);
  });

  it('loads a lone song as a queue of one', async () => {
    await nativeQueue.load(song('a'), 'file:///a.mp3', null, null);
    expect(native.load).toHaveBeenCalledWith('file:///a.mp3', expect.objectContaining({ mediaId: 'a' }));
  });
});
