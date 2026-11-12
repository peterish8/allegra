import { createUpdateWatcher, FAST_MS, KNOWN_MS, MAX_BACKOFF_MS, NORMAL_MS, nextDelayMs, parseStamp, SAVER_MS, stampNeedsCheck, type BuildStamp, type WatcherDeps } from './updateWatcher';

jest.mock('react-native', () => ({ AppState: { currentState: 'active', addEventListener: jest.fn() } }));
jest.mock('../store/updateStore', () => ({ useUpdateStore: { getState: () => ({ autoCheck: true, available: null }), subscribe: jest.fn() } }));
jest.mock('./updateCheck', () => ({ checkNow: jest.fn() }));
jest.mock('../utils/batterySaver', () => ({ isBatterySaverOn: () => false }));

const NEW: BuildStamp = { commit: 'b'.repeat(40), version: '1.49.0' };
const INSTALLED = { commit: 'a'.repeat(40), builtAt: null };

describe('parseStamp', () => {
  it('reads the commit and version of a changelog.json', () => {
    expect(parseStamp({ version: '1.49.0', commit: 'ABCDEF1234567' })).toEqual({ commit: 'abcdef1234567', version: '1.49.0' });
  });
  it('rejects anything that is not one', () => {
    expect(parseStamp(null)).toBeNull();
    expect(parseStamp({ commit: 'zzz', version: 'x' })).toBeNull();
  });
});

describe('stampNeedsCheck', () => {
  it('wants a check for a new commit, not for the installed one, not twice for the same one', () => {
    expect(stampNeedsCheck(NEW, INSTALLED, null)).toBe(true);
    expect(stampNeedsCheck({ commit: INSTALLED.commit, version: '1.48.0' }, INSTALLED, null)).toBe(false);
    expect(stampNeedsCheck(NEW, INSTALLED, NEW.commit)).toBe(false);
    expect(stampNeedsCheck({ commit: null, version: '1.49.0' }, INSTALLED, null)).toBe(false);
  });
  it('checks a build with no known installed commit (a local build) once', () => {
    expect(stampNeedsCheck(NEW, { commit: null, builtAt: null }, null)).toBe(true);
  });
});

describe('nextDelayMs', () => {
  it('looks often in front, faster with the Updates panel open, slower once an update is known or on Battery Saver', () => {
    const base = { failures: 0, saver: false, updateKnown: false, panelOpen: false };
    expect(nextDelayMs(base)).toBe(NORMAL_MS);
    expect(nextDelayMs({ ...base, panelOpen: true })).toBe(FAST_MS);
    expect(nextDelayMs({ ...base, updateKnown: true })).toBe(KNOWN_MS);
    expect(nextDelayMs({ ...base, saver: true })).toBe(SAVER_MS);
  });
  it('backs off on failures and stops at ten minutes', () => {
    const base = { failures: 0, saver: false, updateKnown: false, panelOpen: false };
    expect(nextDelayMs({ ...base, failures: 1 })).toBe(NORMAL_MS * 2);
    expect(nextDelayMs({ ...base, failures: 9 })).toBe(MAX_BACKOFF_MS);
  });
});

describe('the watcher', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const make = (over: Partial<WatcherDeps> = {}) => {
    let active = true;
    let listener: ((a: boolean) => void) | null = null;
    const deps: WatcherDeps = {
      fetchStamp: jest.fn().mockResolvedValue(NEW),
      check: jest.fn().mockResolvedValue(true),
      installed: INSTALLED,
      autoCheck: () => true,
      updateKnown: () => false,
      saver: () => false,
      isActive: () => active,
      onActiveChange: l => { listener = l; return () => { listener = null; }; },
      ...over,
    };
    return { deps, watcher: createUpdateWatcher(deps), setActive: (a: boolean) => { active = a; listener?.(a); } };
  };
  const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

  it('looks at once, makes the full check for a new build, and does not repeat it for the same build', async () => {
    const { deps, watcher } = make();
    watcher.start();
    await flush();
    expect(deps.check).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(NORMAL_MS);
    await flush();
    expect(deps.fetchStamp).toHaveBeenCalledTimes(2);
    expect(deps.check).toHaveBeenCalledTimes(1);
    watcher.stop();
  });

  it('notices a build that is published while the app stays open', async () => {
    const fetchStamp = jest.fn().mockResolvedValueOnce({ commit: INSTALLED.commit, version: '1.48.0' }).mockResolvedValue(NEW);
    const { deps, watcher } = make({ fetchStamp });
    watcher.start();
    await flush();
    expect(deps.check).not.toHaveBeenCalled();
    jest.advanceTimersByTime(NORMAL_MS);
    await flush();
    expect(deps.check).toHaveBeenCalledTimes(1);
    watcher.stop();
  });

  it('tries the full check again when it failed', async () => {
    const check = jest.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const { watcher } = make({ check });
    watcher.start();
    await flush();
    jest.advanceTimersByTime(NORMAL_MS * 2);
    await flush();
    expect(check).toHaveBeenCalledTimes(2);
    watcher.stop();
  });

  it('stops looking while the app is away and looks straight away when it comes back', async () => {
    const { deps, watcher, setActive } = make();
    watcher.start();
    await flush();
    setActive(false);
    jest.advanceTimersByTime(NORMAL_MS * 4);
    await flush();
    expect(deps.fetchStamp).toHaveBeenCalledTimes(1);
    setActive(true);
    await flush();
    expect(deps.fetchStamp).toHaveBeenCalledTimes(2);
    watcher.stop();
  });

  it('does nothing when automatic checks are off', async () => {
    const { deps, watcher } = make({ autoCheck: () => false });
    watcher.start();
    await flush();
    jest.advanceTimersByTime(NORMAL_MS * 3);
    await flush();
    expect(deps.check).not.toHaveBeenCalled();
    expect(deps.fetchStamp).not.toHaveBeenCalled();
    watcher.stop();
  });

  it('looks sooner while the Updates panel is open', async () => {
    const { deps, watcher } = make({ fetchStamp: jest.fn().mockResolvedValue({ commit: INSTALLED.commit, version: '1.48.0' }) });
    watcher.start();
    await flush();
    watcher.setPanelOpen(true);
    await flush();
    const afterOpen = (deps.fetchStamp as jest.Mock).mock.calls.length;
    jest.advanceTimersByTime(FAST_MS);
    await flush();
    expect((deps.fetchStamp as jest.Mock).mock.calls.length).toBe(afterOpen + 1);
    watcher.stop();
  });
});
