// The notification's title/cover for the playing item. Real NativeAudioPlayer (its command chain and idle
// waiters); only the native module behind it is stood in for.
jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('../services/nativeModule', () => {
  const module = {
    skipToNext: jest.fn(),
    setQueue: jest.fn(),
    updateMetadata: jest.fn(),
  };
  return { getNativeModule: () => module, nativeAddListener: () => ({ remove: () => undefined }), EMPTY_SUB: { remove: () => undefined } };
});

import { getNativeModule } from '../services/nativeModule';
import { NativeAudioPlayer } from '../services/NativeAudioPlayer';
import { publishLockScreenMetadata } from './lockScreenMetadata';

const native = getNativeModule<Record<string, jest.Mock>>('MainPlayer') as Record<string, jest.Mock>;
const deferred = () => {
  let resolve: (value: boolean) => void = () => undefined;
  const promise = new Promise<boolean>(r => { resolve = r; });
  return { promise, resolve };
};
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

beforeEach(() => {
  for (const fn of Object.values(native)) fn.mockReset();
});

describe('the notification text for the playing song', () => {
  it('is sent at once when no queue command is in flight, with the defaults the lock screen needs', () => {
    publishLockScreenMetadata({ title: '', artist: undefined, coverImageUri: undefined });
    expect(native.updateMetadata).toHaveBeenCalledWith({ title: 'Unknown Title', artist: 'Unknown Artist', album: '', artworkUri: '' });
  });

  it('carries the song\'s own title, artist, album and cover', () => {
    publishLockScreenMetadata({ title: 'Hymn', artist: 'Ada', album: 'Live', coverImageUri: 'https://cdn/c.jpg' });
    expect(native.updateMetadata).toHaveBeenCalledWith({ title: 'Hymn', artist: 'Ada', album: 'Live', artworkUri: 'https://cdn/c.jpg' });
  });

  // The engine rewrites whatever item it is playing when the call lands. A skip lands a beat after the screen moved:
  // sent at once, the new song's title went onto the song the engine was still on.
  it('waits behind a skip that is still being applied, then names the song the engine is on', async () => {
    const skip = deferred();
    native.skipToNext.mockReturnValueOnce(skip.promise);
    const done = NativeAudioPlayer.skipToNext();
    publishLockScreenMetadata({ title: 'Next one', artist: 'Ada' });
    await tick();
    expect(native.updateMetadata).not.toHaveBeenCalled();

    skip.resolve(true);
    await done;
    await tick();
    expect(native.updateMetadata).toHaveBeenCalledTimes(1);
    expect(native.updateMetadata).toHaveBeenCalledWith(expect.objectContaining({ title: 'Next one' }));
  });

  it('drops an update for a song that was skipped past before it could be sent', async () => {
    const first = deferred();
    native.skipToNext.mockReturnValueOnce(first.promise).mockResolvedValue(true);
    const done = NativeAudioPlayer.skipToNext();
    const dropOld = publishLockScreenMetadata({ title: 'Song B' });
    // Another skip, and the effect for the next song replaces the pending one.
    dropOld();
    publishLockScreenMetadata({ title: 'Song C' });
    first.resolve(true);
    await done;
    await tick();
    expect(native.updateMetadata).toHaveBeenCalledTimes(1);
    expect(native.updateMetadata).toHaveBeenCalledWith(expect.objectContaining({ title: 'Song C' }));
  });
});
