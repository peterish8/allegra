jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) },
}));

import * as appUpdate from './appUpdate';
import { availableFrom, checkInBackground, checkNow } from './updateCheck';
import { useUpdateStore } from '../store/updateStore';

const build = (patch: Partial<appUpdate.LatestBuild> = {}): appUpdate.LatestBuild => ({
  publishedAt: new Date('2026-10-02T09:00:00Z'),
  downloadUrl: appUpdate.LATEST_APK_URL,
  commit: 'c'.repeat(40),
  sizeBytes: 64_800_000,
  version: '0.2.0',
  changelogUrl: null,
  notes: appUpdate.NO_NOTES,
  ...patch,
});

const reset = () => useUpdateStore.setState({ autoCheck: true, lastCheckedAt: null, available: null });

afterEach(() => { jest.restoreAllMocks(); reset(); });
beforeEach(reset);

describe('availableFrom', () => {
  it('keeps a build newer than this phone', () => {
    expect(availableFrom(build())).toEqual({ commit: 'c'.repeat(40), version: '0.2.0', publishedAt: '2026-10-02T09:00:00.000Z' });
  });

  it('keeps nothing when there is no release', () => {
    expect(availableFrom(null)).toBeNull();
  });
});

describe('checkNow', () => {
  it('remembers what it found and when', async () => {
    jest.spyOn(appUpdate, 'fetchLatestBuild').mockResolvedValue(build());
    await checkNow();
    const { available, lastCheckedAt } = useUpdateStore.getState();
    expect(available?.version).toBe('0.2.0');
    expect(lastCheckedAt).not.toBeNull();
  });

  it('does not call a failed look a check, or forget an update it already found', async () => {
    useUpdateStore.setState({ available: { commit: null, version: '0.2.0', publishedAt: '2026-10-02T09:00:00.000Z' } });
    jest.spyOn(appUpdate, 'fetchLatestBuild').mockResolvedValue(null);
    expect(await checkNow()).toBeNull();
    expect(useUpdateStore.getState().lastCheckedAt).toBeNull();
    expect(useUpdateStore.getState().available?.version).toBe('0.2.0');
  });
});

describe('checkInBackground', () => {
  it('stays quiet when automatic checks are off', async () => {
    const fetch = jest.spyOn(appUpdate, 'fetchLatestBuild').mockResolvedValue(build());
    useUpdateStore.getState().setAutoCheck(false);
    await checkInBackground();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('stays quiet when it looked a moment ago, and looks when it has not for hours', async () => {
    const fetch = jest.spyOn(appUpdate, 'fetchLatestBuild').mockResolvedValue(build());
    const now = new Date('2026-10-02T12:00:00Z');
    useUpdateStore.setState({ lastCheckedAt: '2026-10-02T11:00:00Z' });
    await checkInBackground(now);
    expect(fetch).not.toHaveBeenCalled();
    useUpdateStore.setState({ lastCheckedAt: '2026-10-02T02:00:00Z' });
    await checkInBackground(now);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('clears the badge when automatic checks are turned off', () => {
    useUpdateStore.setState({ available: { commit: null, version: '0.2.0', publishedAt: '2026-10-02T09:00:00.000Z' } });
    useUpdateStore.getState().setAutoCheck(false);
    expect(useUpdateStore.getState().available).toBeNull();
  });
});
