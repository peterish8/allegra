jest.mock('react-native', () => ({ AppState: undefined }));
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import { createDebouncedStorage } from './debouncedStorage';

const backing = () => {
  const store = new Map<string, string>();
  return {
    store,
    getItem: jest.fn(async (key: string) => store.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { store.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { store.delete(key); }),
  };
};

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('createDebouncedStorage', () => {
  it('writes a burst of changes once, with the last value', async () => {
    const disk = backing();
    const storage = createDebouncedStorage(1000, disk, () => undefined);
    storage.setItem('settings', '{"song":"a"}');
    storage.setItem('settings', '{"song":"b"}');
    storage.setItem('settings', '{"song":"c"}');
    expect(disk.setItem).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1000);
    await Promise.resolve();
    expect(disk.setItem).toHaveBeenCalledTimes(1);
    expect(disk.store.get('settings')).toBe('{"song":"c"}');
  });

  it('reads the newest value before it is written', async () => {
    const disk = backing();
    const storage = createDebouncedStorage(1000, disk, () => undefined);
    storage.setItem('settings', 'new');
    expect(await storage.getItem('settings')).toBe('new');
    expect(disk.getItem).not.toHaveBeenCalled();
  });

  it('writes what is pending at once when the app leaves the foreground', async () => {
    const disk = backing();
    let toBackground = () => undefined as void;
    const storage = createDebouncedStorage(60_000, disk, flush => { toBackground = flush; });
    storage.setItem('settings', 'kept');
    toBackground();
    await Promise.resolve();
    expect(disk.store.get('settings')).toBe('kept');
  });
});
