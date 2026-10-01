import { useCallback, useEffect, useRef, useState } from 'react';

import type { AccountProfile, TasteSummary, UnifiedSong } from '@shared/types';

import { ensureSession, fetchProfile, fetchTaste, seedTaste, sendListenSignal, startGuestSession, updateDisplayName } from '../lib/api';

export interface AccountApi {
  readonly profile: AccountProfile | null;
  readonly taste: TasteSummary | null;
  /** The first profile/taste load has finished (successfully or not). */
  readonly ready: boolean;
  readonly refresh: () => Promise<AccountProfile | null>;
  /** Drops back to a fresh guest session. Called after Convex Auth signs the listener out. */
  readonly startGuest: () => Promise<void>;
  readonly rename: (displayName: string) => Promise<void>;
  readonly seed: (artists: readonly string[], languages: readonly string[]) => Promise<void>;
}

/**
 * The listener behind this browser: a guest until they make an account, then that account. It also owns the
 * taste profile the server learns from their behaviour, which is what makes Home theirs.
 *
 * `onSessionChange` fires after any change of who is signed in, so the rest of the app can reload likes and playlists.
 *
 * `signedIn` is Convex Auth's own view of whether this browser has a Google session. Convex resolves that
 * asynchronously (a redirect round trip, then a token), well after this hook's first mount, so the profile
 * fetched on mount is only ever the guest one. Refreshing again whenever `signedIn` flips is what turns that
 * guest profile into the real account - without it the navbar and onboarding never learn sign-in happened.
 */
export function useAccount(signedIn: boolean, onSessionChange: () => void): AccountApi {
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [taste, setTaste] = useState<TasteSummary | null>(null);
  const [ready, setReady] = useState(false);
  const changed = useRef(onSessionChange);
  changed.current = onSessionChange;

  const load = useCallback(async (): Promise<AccountProfile | null> => {
    try {
      await ensureSession();
      const [nextProfile, nextTaste] = await Promise.all([fetchProfile(), fetchTaste()]);
      setProfile(nextProfile);
      setTaste(nextTaste);
      return nextProfile;
    } catch {
      // Home falls back to Browse-style content without a profile, so a failed load is not fatal.
      return null;
    } finally {
      setReady(true);
    }
  }, []);

  // Mount, a sign-in event and the sign-in poll can all ask at once. One load runs; everyone who asks
  // while it does shares a single follow-up, which starts after it ends so it sees any change that
  // prompted the request (a guest linked to an account, say).
  const running = useRef<Promise<AccountProfile | null> | null>(null);
  const followUp = useRef<Promise<AccountProfile | null> | null>(null);
  const refresh = useCallback((): Promise<AccountProfile | null> => {
    const start = (): Promise<AccountProfile | null> => {
      const run = load().finally(() => { if (running.current === run) running.current = null; });
      running.current = run;
      return run;
    };
    if (!running.current) return start();
    followUp.current ??= running.current.then(() => {
      followUp.current = null;
      return start();
    });
    return followUp.current;
  }, [load]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onAccount = (): void => {
      void refresh().then(() => changed.current());
    };
    // The library changed on another device: only likes and playlists need reloading.
    const onLibrary = (): void => changed.current();
    window.addEventListener('allegra:account', onAccount);
    window.addEventListener('allegra:library', onLibrary);
    return () => {
      window.removeEventListener('allegra:account', onAccount);
      window.removeEventListener('allegra:library', onLibrary);
    };
  }, [refresh]);

  const wasSignedIn = useRef(signedIn);
  useEffect(() => {
    if (wasSignedIn.current === signedIn) return;
    wasSignedIn.current = signedIn;
    let cancelled = false;
    const run = async (): Promise<void> => {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        if (cancelled) return;
        const next = await refresh();
        changed.current();
        if (!signedIn) break;
        if (next && !next.isGuest) break;
        await new Promise((resolve) => window.setTimeout(resolve, 400));
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [signedIn, refresh]);

  const afterSessionChange = useCallback(async (): Promise<void> => {
    await refresh();
    changed.current();
  }, [refresh]);

  const startGuest = useCallback(async (): Promise<void> => {
    await startGuestSession();
    await afterSessionChange();
  }, [afterSessionChange]);

  const rename = useCallback(async (displayName: string): Promise<void> => {
    setProfile(await updateDisplayName(displayName));
  }, []);

  const seed = useCallback(async (artists: readonly string[], languages: readonly string[]): Promise<void> => {
    setTaste(await seedTaste(artists, languages));
    changed.current();
  }, []);

  return { profile, taste, ready, refresh, startGuest, rename, seed };
}

/**
 * Tells the server how long each song was actually listened to, once it has been left. A few seconds counts
 * against a song's artist and most of it counts for them, so the taste profile follows behaviour, not just taps.
 */
export function useListenTracker(song: UnifiedSong | null, currentTime: number, refreshTaste: () => Promise<unknown>): void {
  const state = useRef<{ key: string | null; song: UnifiedSong | null; seconds: number }>({ key: null, song: null, seconds: 0 });
  const key = song ? `${song.source.toLowerCase()}:${song.id}` : null;
  const refreshRef = useRef(refreshTaste);
  refreshRef.current = refreshTaste;

  useEffect(() => {
    const heard = state.current;
    if (heard.key !== key) {
      if (heard.song && heard.seconds >= 1) {
        void sendListenSignal(heard.song, heard.seconds).then(() => refreshRef.current()).catch(() => undefined);
      }
      state.current = { key, song, seconds: 0 };
      return;
    }
    heard.seconds = Math.max(heard.seconds, currentTime);
  }, [key, currentTime, song]);
}
