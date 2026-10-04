import type { AppStateStatus } from 'react-native';
import { createAppActivitySource } from '../utils/appActivity';
import type { AppStatePort } from '../utils/appActivity';

const createFakeAppState = (initialState: AppStateStatus | null) => {
  let currentState = initialState;
  const listeners = new Set<(state: AppStateStatus) => void>();
  let subscriptions = 0;
  let removals = 0;

  const port: AppStatePort = {
    get currentState() {
      return currentState;
    },
    addEventListener: (_event, listener) => {
      subscriptions += 1;
      listeners.add(listener);
      return {
        remove: () => {
          removals += 1;
          listeners.delete(listener);
        },
      };
    },
  };

  return {
    port,
    emit: (state: AppStateStatus) => {
      currentState = state;
      listeners.forEach(listener => listener(state));
    },
    get subscriptions() {
      return subscriptions;
    },
    get removals() {
      return removals;
    },
  };
};

describe('useAppActive source', () => {
  it('starts inactive when AppState is backgrounded and follows foreground transitions', () => {
    const native = createFakeAppState('background');
    const source = createAppActivitySource(native.port);
    const listener = jest.fn();

    expect(source.getSnapshot()).toBe(false);
    const unsubscribe = source.subscribe(listener);
    native.emit('inactive');
    expect(source.getSnapshot()).toBe(false);
    expect(listener).not.toHaveBeenCalled();

    native.emit('active');
    expect(source.getSnapshot()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    native.emit('background');
    expect(source.getSnapshot()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    expect(native.removals).toBe(1);
  });

  it('shares one native listener and reconciles AppState after the last subscriber leaves', () => {
    const native = createFakeAppState('active');
    const source = createAppActivitySource(native.port);
    const first = jest.fn();
    const second = jest.fn();
    const unsubscribeFirst = source.subscribe(first);
    const unsubscribeSecond = source.subscribe(second);

    expect(native.subscriptions).toBe(1);
    native.emit('inactive');
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    unsubscribeFirst();
    unsubscribeSecond();
    expect(native.removals).toBe(1);

    // No listener observes this transition; the next subscriber must read the
    // current native state rather than trust the source's last cached value.
    native.emit('active');
    expect(source.getSnapshot()).toBe(false);
    const resumed = jest.fn();
    const unsubscribeResumed = source.subscribe(resumed);
    expect(source.getSnapshot()).toBe(true);
    expect(resumed).toHaveBeenCalledTimes(1);
    expect(native.subscriptions).toBe(2);
    unsubscribeResumed();
  });

  it('treats an unknown startup state as inactive until AppState reports active', () => {
    const native = createFakeAppState(null);
    const source = createAppActivitySource(native.port);
    const listener = jest.fn();
    const unsubscribe = source.subscribe(listener);

    expect(source.getSnapshot()).toBe(false);
    native.emit('active');
    expect(source.getSnapshot()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
