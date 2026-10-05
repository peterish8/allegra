import { useCallback, useEffect, useRef, useState } from 'react';

import type { BlendSummary } from '@shared/blendView';

import { fetchBlends } from '../lib/api';
import { flags } from '../lib/flags';

export interface BlendsState {
  readonly blends: readonly BlendSummary[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly reload: () => Promise<void>;
}

/** The listener's Blends. Loads only for a signed-in account with Blends switched on. */
export function useBlends(signedIn: boolean): BlendsState {
  const [blends, setBlends] = useState<readonly BlendSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    if (!signedIn || !flags.blend) {
      setBlends([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await fetchBlends(controller.signal);
      if (!controller.signal.aborted) setBlends(next);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Your Blends could not be loaded.');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [signedIn]);

  useEffect(() => {
    void reload();
    return () => pending.current?.abort();
  }, [reload]);

  // A Blend made, joined or left anywhere in the app refreshes every list showing them.
  useEffect(() => {
    const onChange = (): void => { void reload(); };
    window.addEventListener('allegra:blends-changed', onChange);
    return () => window.removeEventListener('allegra:blends-changed', onChange);
  }, [reload]);

  return { blends, loading, error, reload };
}

/** Tells every `useBlends` that the list changed. */
export function announceBlendsChanged(): void {
  window.dispatchEvent(new CustomEvent('allegra:blends-changed'));
}
