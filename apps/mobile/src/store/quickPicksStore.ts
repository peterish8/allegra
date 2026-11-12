import { create } from 'zustand';
import { readQuickPicks, writeQuickPicks, bookmarkQuickPicks } from '../database/generatedPlaylistQueries';
import { listensSince } from '../database/listenLogQueries';
import { getRecommendations, toPlayableAllegraSong } from '../services/account/allegraApi';
import { buildHomeFeed } from '../services/stream/homeFeed';
import { searchOfficial } from '../services/stream/officialSearch';
import { recommendFor } from '../services/stream/recommend';
import { quickPicksDaypart, rankQuickPicks, shouldRefreshQuickPicks, type LiveQuickPicks } from '../services/stream/liveQuickPicks';
import { useSongsStore } from './songsStore';
import { useStreamHistoryStore } from './streamHistoryStore';
import { useLuvsPreferencesStore } from './luvsPreferencesStore';
import { useOnlineLibraryStore } from './onlineLibraryStore';
import { usePlaylistStore } from './playlistStore';
import type { UnifiedSong } from '../types/song';
const flights = new Map<string, Promise<void>>();
const attempts = new Map<string, number>();
const reads = new Map<string, Promise<void>>();
interface State {
  entries: Record<string, LiveQuickPicks | undefined>;
  hydrated: Record<string, boolean>;
  loading: Record<string, boolean>;
  errors: Record<string, string | undefined>;
  hydrate: (scope: string) => Promise<void>;
  refresh: (scope: string, token: string | null, force?: boolean, fallback?: UnifiedSong[]) => Promise<void>;
  save: (scope: string, saved: boolean) => Promise<void>;
}
export const useQuickPicksStore = create<State>((set, get) => ({
  entries: {}, hydrated: {}, loading: {}, errors: {},
  hydrate: (scope) => {
    if (get().hydrated[scope]) return Promise.resolve();
    const running = reads.get(scope); if (running) return running;
    const work = readQuickPicks(scope).then(entry => set(s => ({ entries: { ...s.entries, [scope]: entry }, hydrated: { ...s.hydrated, [scope]: true } })))
      .catch(() => set(s => ({ errors: { ...s.errors, [scope]: 'Could not read your saved picks. Try again.' } })))
      .finally(() => reads.delete(scope));
    reads.set(scope, work); return work;
  },
  refresh: (scope, token, force = false, fallback = []) => {
    const running = flights.get(scope); if (running) return running;
    const work = (async () => {
      await get().hydrate(scope);
      if (!get().hydrated[scope]) return;
      const history = useStreamHistoryStore.getState().plays;
      const languages = useLuvsPreferencesStore.getState().preferredLanguages.filter(l => l.weight > 0).map(l => l.language);
      const now = Date.now();
      const listens = await listensSince(now - 28 * 86400000);
      const likes = [...useOnlineLibraryStore.getState().likedRefs, ...usePlaylistStore.getState().likedSongIds].sort().join('|');
      const signal = `${likes}|${history[0]?.playedAt ?? ''}|${listens.length}|${listens[listens.length - 1]?.startedAt ?? ''}|${languages.join(',')}`;
      const previous = get().entries[scope];
      if (!shouldRefreshQuickPicks(previous, now, signal, force)) return;
      if (!force && now - (attempts.get(scope) ?? 0) < 60000) return;
      attempts.set(scope, now);
      set(s => ({ loading: { ...s.loading, [scope]: true }, errors: { ...s.errors, [scope]: undefined } }));
      let songs: UnifiedSong[] = token ? (await getRecommendations(token)).map(toPlayableAllegraSong).filter((song): song is UnifiedSong => song !== null) : [];
      let source: LiveQuickPicks['source'] = 'account';
      if (!songs.length && previous?.songs.length && token) throw new Error('Keeping your last picks. Could not get fresh recommendations.');
      if (!songs.length) {
        source = history.length ? 'history' : 'discovery';
        if (fallback.length) songs = fallback;
        else {
          const feed = await buildHomeFeed({ localSongs: useSongsStore.getState().songs, history, languages }, { searchMusic: q => searchOfficial(q), recommend: seed => recommendFor(seed, 12) });
          songs = feed.quickPicks;
        }
      }
      songs = rankQuickPicks(songs, listens, now);
      if (!songs.length) throw new Error('No fresh picks available. Try again after listening to a few songs.');
      // Saving may change while the network is in flight. Preserve the latest bookmark state.
      const entry: LiveQuickPicks = { scope, saved: get().entries[scope]?.saved ?? false, songs, generatedAt: now, revision: (previous?.revision ?? 0) + 1, daypart: quickPicksDaypart(now), signal, source };
      await writeQuickPicks(entry);
      set(s => ({ entries: { ...s.entries, [scope]: { ...entry, saved: s.entries[scope]?.saved ?? entry.saved } } }));
    })().catch(error => set(s => ({ errors: { ...s.errors, [scope]: error instanceof Error ? error.message : 'Could not refresh picks.' } })))
      .finally(() => { flights.delete(scope); set(s => ({ loading: { ...s.loading, [scope]: false } })); });
    flights.set(scope, work); return work;
  },
  save: async (scope, saved) => {
    const entry = get().entries[scope]; if (!entry) return;
    set(s => ({ entries: { ...s.entries, [scope]: { ...s.entries[scope]!, saved } } }));
    try { await bookmarkQuickPicks(scope, saved); }
    catch (error) {
      set(s => ({ entries: { ...s.entries, [scope]: { ...s.entries[scope]!, saved: entry.saved } } }));
      throw error;
    }
  },
}));
