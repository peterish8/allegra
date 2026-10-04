// Queue commands run one after another, in the order they were made, and say "applied" only when they were.
jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('./nativeModule', () => {
  const module = {
    load: jest.fn(),
    play: jest.fn(() => true),
    pause: jest.fn(),
    seekTo: jest.fn(),
    setQueue: jest.fn(),
    replaceQueue: jest.fn(),
    playNextItems: jest.fn(),
    addToQueueItems: jest.fn(),
    removeQueueItem: jest.fn(),
    clearQueue: jest.fn(),
    skipToNext: jest.fn(),
    skipToPrevious: jest.fn(),
    skipToIndex: jest.fn(),
    setShuffle: jest.fn(),
    setRepeatMode: jest.fn(),
    getQueueState: jest.fn(),
    hasSavedQueue: jest.fn(),
    restoreQueue: jest.fn(),
  };
  return { getNativeModule: () => module, nativeAddListener: () => ({ remove: () => undefined }), EMPTY_SUB: { remove: () => undefined } };
});

import { getNativeModule } from './nativeModule';
import { NativeAudioPlayer, isQueueBusy, whenQueueIdle } from './NativeAudioPlayer';

const native = getNativeModule<Record<string, jest.Mock>>('MainPlayer') as Record<string, jest.Mock>;
const item = (id: string) => ({ id, uri: `file:///${id}.mp3`, title: id, artist: '', album: '', artworkUri: '' });

/** A native call whose answer the test releases by hand. */
const deferred = () => {
  let resolve: (value: boolean) => void = () => undefined;
  const promise = new Promise<boolean>(r => { resolve = r; });
  return { promise, resolve };
};

beforeEach(() => {
  for (const fn of Object.values(native)) fn.mockReset();
  native.play.mockReturnValue(true);
});

describe('queue commands', () => {
  it('only reach the native side once the one before has been applied', async () => {
    const first = deferred();
    native.setQueue.mockReturnValueOnce(first.promise);
    native.addToQueueItems.mockResolvedValue(true);

    const set = NativeAudioPlayer.setQueue([item('a')], 0, 0, true, 'x#1');
    const add = NativeAudioPlayer.addToQueue([item('b')], true, 'x#1');
    await Promise.resolve();
    expect(native.setQueue).toHaveBeenCalledTimes(1);
    expect(native.addToQueueItems).not.toHaveBeenCalled();

    first.resolve(true);
    expect(await set).toBe(true);
    expect(await add).toBe(true);
    expect(native.addToQueueItems).toHaveBeenCalledWith([item('b')], true, 'x#1');
  });

  it('answer false when the native side did not apply them, and the chain carries on', async () => {
    native.skipToNext.mockResolvedValueOnce(false).mockResolvedValue(true);
    expect(await NativeAudioPlayer.skipToNext()).toBe(false);
    expect(await NativeAudioPlayer.skipToNext()).toBe(true);
  });

  it('survive a native call that throws', async () => {
    native.setShuffle.mockRejectedValueOnce(new Error('boom'));
    native.setRepeatMode.mockResolvedValue(true);
    expect(await NativeAudioPlayer.setShuffle(true)).toBe(false);
    expect(await NativeAudioPlayer.setRepeatMode('all')).toBe(true);
  });

  it('report busy while one is in flight and call back once idle', async () => {
    const pending = deferred();
    native.clearQueue.mockReturnValue(pending.promise);
    const done = NativeAudioPlayer.clearQueue();
    expect(isQueueBusy()).toBe(true);
    const idle = jest.fn();
    whenQueueIdle(idle);
    expect(idle).not.toHaveBeenCalled();
    pending.resolve(true);
    await done;
    await Promise.resolve();
    expect(isQueueBusy()).toBe(false);
    expect(idle).toHaveBeenCalledTimes(1);
  });

  it('run a waiting callback at once when nothing is in flight', () => {
    const idle = jest.fn();
    whenQueueIdle(idle);
    expect(idle).toHaveBeenCalledTimes(1);
  });
});

describe('transport commands', () => {
  it('go straight through when no queue command is in flight', () => {
    NativeAudioPlayer.seekTo(42);
    NativeAudioPlayer.pause();
    expect(native.seekTo).toHaveBeenCalledWith(42);
    expect(native.pause).toHaveBeenCalledTimes(1);
    expect(NativeAudioPlayer.play()).toBe(true);
  });

  it('wait behind a queue command still being applied (a seek into the song it is loading)', async () => {
    const pending = deferred();
    native.setQueue.mockReturnValue(pending.promise);
    const set = NativeAudioPlayer.setQueue([item('a')], 0, 0, false, 'x#1');
    NativeAudioPlayer.seekTo(30);
    await Promise.resolve();
    expect(native.seekTo).not.toHaveBeenCalled();
    pending.resolve(true);
    await set;
    await new Promise(r => setTimeout(r, 0));
    expect(native.seekTo).toHaveBeenCalledWith(30);
  });
});

describe('without the queue engine', () => {
  it('answers false instead of throwing', async () => {
    const original = native.setQueue;
    (native as Record<string, unknown>).setQueue = undefined;
    expect(NativeAudioPlayer.hasQueue()).toBe(false);
    expect(await NativeAudioPlayer.setQueue([item('a')], 0, 0, true, 'x#1')).toBe(false);
    expect(await NativeAudioPlayer.getQueueState()).toBeNull();
    native.setQueue = original;
  });
});
