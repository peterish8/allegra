/**
 * Watches the playing song: once its lyrics are plain, asks once for synced ones and swaps them in
 * (services/lyrics/lyricsUpgrade). Now Playing, the island and the queue all read the new lines.
 */
import { useEffect } from 'react';
import { usePlayerStore } from '../store/playerStore';
import { songCanUpgradeToSyncedLyrics } from '../utils/lyricsState';
import { upgradeToSyncedLyrics } from '../services/lyrics/lyricsUpgrade';

export function useLyricsUpgrade(): void {
  const songId = usePlayerStore(state => state.currentSong?.id ?? null);
  const plainOnly = usePlayerStore(state => (state.currentSong ? songCanUpgradeToSyncedLyrics(state.currentSong) : false));

  useEffect(() => {
    if (!songId || !plainOnly) return;
    const song = usePlayerStore.getState().currentSong;
    if (song?.id === songId) upgradeToSyncedLyrics(song).catch(() => undefined);
  }, [songId, plainOnly]);
}
