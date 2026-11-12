import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useAccount } from '../services/account/AccountProvider';
import { onPlayReported } from '../services/sync/LibrarySync';
import { useQuickPicksStore } from '../store/quickPicksStore';
import { useStreamHistoryStore } from '../store/streamHistoryStore';
import { nextDaypartAt } from '../services/stream/liveQuickPicks';
import { useOnlineLibraryStore } from '../store/onlineLibraryStore';
import { usePlaylistStore } from '../store/playlistStore';
import { useLuvsPreferencesStore } from '../store/luvsPreferencesStore';
import type { UnifiedSong } from '../types/song';
export function useLiveQuickPicks(fallback?: UnifiedSong[], ready = true) {
  const account = useAccount();
  const scope = account.loading ? null : account.signedIn ? account.profile?.userId ?? null : 'guest';
  const entry = useQuickPicksStore(s => scope ? s.entries[scope] : undefined);
  const loading = useQuickPicksStore(s => scope ? !!s.loading[scope] : false);
  const error = useQuickPicksStore(s => scope ? s.errors[scope] : undefined);
  const focused = useIsFocused();
  const [active, setActive] = useState(AppState.currentState === 'active');
  const onlineLikes = useOnlineLibraryStore(s => [...s.likedRefs].sort().join('|'));
  const localLikes = usePlaylistStore(s => [...s.likedSongIds].sort().join('|'));
  const languages = useLuvsPreferencesStore(s => s.preferredLanguages.map(l => `${l.language}:${l.weight}`).join('|'));
  const lastPlay = useStreamHistoryStore(s => s.plays[0]?.playedAt);
  const refresh = useCallback((force = false) => scope && ready ? useQuickPicksStore.getState().refresh(scope, account.token, force, fallback) : Promise.resolve(), [scope, account.token, fallback, ready]);
  useEffect(() => { if (focused && active) refresh(); }, [focused, active, refresh, lastPlay, onlineLikes, localLikes, languages]);
  useEffect(() => {
    if (!focused) return;
    const off = onPlayReported(() => { refresh(); });
    const sub = AppState.addEventListener('change', state => { setActive(state === 'active'); if (state === 'active') refresh(); });
    return () => { off(); sub.remove(); };
  }, [focused, refresh]);
  useEffect(() => {
    if (!focused || !active) return;
    const timer = setTimeout(() => { refresh(); }, Math.max(1, nextDaypartAt(Date.now()) - Date.now() + 50));
    return () => clearTimeout(timer);
  }, [focused, active, refresh, entry?.daypart]);
  return { scope, entry, loading, error, refresh };
}
