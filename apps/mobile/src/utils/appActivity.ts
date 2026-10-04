import type { AppStateStatus } from 'react-native';

export interface AppStatePort {
  readonly currentState: AppStateStatus | null;
  addEventListener: (
    event: 'change',
    listener: (state: AppStateStatus) => void,
  ) => { remove: () => void };
}

interface AppActivitySource {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => boolean;
  getServerSnapshot: () => boolean;
}

/**
 * One shared foreground subscription for visuals that should rest with the UI.
 * Read currentState before subscribing, then reconcile again after the listener
 * is attached so a transition during mount cannot leave a stale snapshot.
 */
export const createAppActivitySource = (appState: AppStatePort): AppActivitySource => {
  const listeners = new Set<() => void>();
  let active = appState.currentState === 'active';
  let subscription: { remove: () => void } | null = null;

  const update = (state: AppStateStatus | null): void => {
    const next = state === 'active';
    if (next === active) return;
    active = next;
    listeners.forEach(listener => listener());
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    if (!subscription) {
      subscription = appState.addEventListener('change', update);
      update(appState.currentState);
    }

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0 && subscription) {
        subscription.remove();
        subscription = null;
      }
    };
  };

  return {
    subscribe,
    getSnapshot: () => active,
    getServerSnapshot: () => false,
  };
};
