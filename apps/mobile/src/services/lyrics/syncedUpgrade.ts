/**
 * Plain lyrics are a stand-in. When a song starts with plain words (JioSaavn, a lyrics site), keep
 * looking for a synced version in the background and swap it in the moment it lands, on the player,
 * its queue and the island. A version the listener picked meanwhile is never replaced.
 */
import { lyricaService } from '../LyricaService';
import { usePlayerStore } from '../../store/playerStore';

export interface UpgradeTarget {
  id: string;
  title: string;
  artist: string;
  /** Seconds; 0 when unknown. */
  duration: number;
  ref?: string;
}

const running = new Set<string>();

/** True when synced lyrics replaced `plainSource` on the song. Never throws. */
export async function upgradeToSynced(target: UpgradeTarget, plainSource: string): Promise<boolean> {
  if (running.has(target.id)) return false;
  running.add(target.id);
  try {
    const result = await lyricaService.fetchLyrics(target.title, target.artist, true, target.duration || undefined, { ref: target.ref });
    if (!result || !lyricaService.hasTimestamps(result.lyrics)) return false;
    const lyrics = lyricaService.parseLrc(result.lyrics, target.duration || 180);
    if (lyrics.length === 0) return false;
    const patch = { lyrics, lyricSource: result.source };
    const state = usePlayerStore.getState();
    const current = state.currentSong;
    let replaced = false;
    if (current?.id === target.id && current.lyricSource === plainSource) {
      state.updateCurrentSong(patch);
      replaced = true;
    }
    if (state.playlistQueue?.some(s => s.id === target.id && s.lyricSource === plainSource)) {
      state.updateQueue(state.playlistQueue.map(s => (s.id === target.id && s.lyricSource === plainSource ? { ...s, ...patch } : s)));
      replaced = true;
    }
    return replaced;
  } catch {
    return false;
  } finally {
    running.delete(target.id);
  }
}
