/**
 * Keeps the system island's lyrics in step with the playing song (Android). The island shows them under
 * its open card and follows the player's own clock, so they are sent once per song (and again when the
 * lyrics or the lyrics delay change), never per line.
 */
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { usePlayerStore } from '../store/playerStore';
import { useSettingsStore } from '../store/settingsStore';
import { clearIslandLyrics, setIslandLyrics } from '../services/NativeDynamicIsland';
import { islandLyricsPayload } from '../services/dynamicIslandSetup';

export function useIslandLyrics(): void {
  const songId = usePlayerStore(state => state.currentSong?.id ?? null);
  const lyrics = usePlayerStore(state => state.currentSong?.lyrics);
  const delay = useSettingsStore(state => state.lyricsDelay);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const payload = songId ? islandLyricsPayload(lyrics, delay) : null;
    if (songId && payload) setIslandLyrics(songId, payload.atMs, payload.texts);
    else clearIslandLyrics();
  }, [songId, lyrics, delay]);
}
