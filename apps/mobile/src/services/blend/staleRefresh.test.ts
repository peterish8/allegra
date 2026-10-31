const appState = { currentState: 'active', listeners: [] as ((next: string) => void)[] };
jest.mock('react-native', () => ({
  AppState: {
    get currentState() { return appState.currentState; },
    addEventListener: (_: string, listener: (next: string) => void) => {
      appState.listeners.push(listener);
      return { remove: () => { appState.listeners = appState.listeners.filter((item) => item !== listener); } };
    },
  },
}));

import { STALE_REFRESH, watchStaleBlend } from './staleRefresh';

describe('stale Blend refresh', () => {
  beforeEach(() => { jest.useFakeTimers(); appState.currentState = 'active'; appState.listeners = []; });
  afterEach(() => jest.useRealTimers());

  it('re-reads a stale Blend until a fresh build arrives, then stops', async () => {
    const answers = [false, false, true];
    const refresh = jest.fn(async () => answers.shift() ?? true);
    const stop = watchStaleBlend(refresh, () => true);
    await jest.advanceTimersByTimeAsync(STALE_REFRESH.everyMs * 10);
    expect(refresh).toHaveBeenCalledTimes(3);
    stop();
  });

  it('gives up after six tries so a Blend that never rebuilds does not poll forever', async () => {
    const refresh = jest.fn(async () => false);
    const stop = watchStaleBlend(refresh, () => true);
    await jest.advanceTimersByTimeAsync(STALE_REFRESH.everyMs * 20);
    expect(refresh).toHaveBeenCalledTimes(STALE_REFRESH.tries);
    stop();
  });

  it('keeps trying after a failed read, and waits while the app is in the background', async () => {
    const refresh = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(false);
    const stop = watchStaleBlend(refresh, () => true);
    await jest.advanceTimersByTimeAsync(STALE_REFRESH.everyMs);
    expect(refresh).toHaveBeenCalledTimes(1);
    appState.currentState = 'background';
    await jest.advanceTimersByTimeAsync(STALE_REFRESH.everyMs * 5);
    expect(refresh).toHaveBeenCalledTimes(1);
    appState.currentState = 'active';
    appState.listeners.forEach((listener) => listener('active'));
    await jest.advanceTimersByTimeAsync(STALE_REFRESH.everyMs);
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
  });

  it('does nothing after it is stopped or while the screen is hidden', async () => {
    const refresh = jest.fn(async () => false);
    let visible = false;
    const stop = watchStaleBlend(refresh, () => visible);
    await jest.advanceTimersByTimeAsync(STALE_REFRESH.everyMs * 3);
    expect(refresh).not.toHaveBeenCalled();
    visible = true;
    stop();
    appState.listeners.forEach((listener) => listener('active'));
    await jest.advanceTimersByTimeAsync(STALE_REFRESH.everyMs * 3);
    expect(refresh).not.toHaveBeenCalled();
  });
});
