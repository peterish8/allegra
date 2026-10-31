/**
 * Plain lyrics on screen (JioSaavn's words usually arrive first) are swapped for synced ones when a
 * synced-only lookup finds them: the Echo cascade, Allegra listener syncs, then the Lyrica backend with
 * its full cold-start allowance. Asked once per song per app run, and applied only if the same song
 * still shows the same lyrics, so a skip or a version picked by hand meanwhile is left alone.
 */
import { fromMobileId } from '@shared/songRef';
import { lyricaService } from '../LyricaService';
import { usePlayerStore } from '../../store/playerStore';
import { isStreamSongId } from '../stream/streamSong';
import { songCanUpgradeToSyncedLyrics, songHasSyncedLyrics } from '../../utils/lyricsState';
import type { Song } from '../../types/song';

const asked = new Set<string>();

/** Whether this song's lyrics are worth one more, synced-only lookup. Words typed by hand are kept. */
export function wantsSyncedUpgrade(song: Song | null, alreadyAsked: ReadonlySet<string>): song is Song {
  return song !== null && !alreadyAsked.has(song.id) && song.lyricSource !== 'Manual' && songCanUpgradeToSyncedLyrics(song);
}

/** Test seam: forget which songs were asked this run. */
export function resetLyricsUpgrades(): void {
  asked.clear();
}

/** True when synced lyrics replaced the plain ones. Never throws. */
export async function upgradeToSyncedLyrics(song: Song): Promise<boolean> {
  if (!wantsSyncedUpgrade(song, asked)) return false;
  asked.add(song.id);
  const before = song.lyrics;
  try {
    const result = await lyricaService.fetchLyrics(song.title, song.artist ?? '', true, song.duration || undefined, {
      ref: isStreamSongId(song.id) ? fromMobileId(song.id) ?? undefined : undefined,
    });
    if (!result || !lyricaService.hasTimestamps(result.lyrics)) return false;
    const lyrics = lyricaService.parseLrc(result.lyrics, song.duration || 180);
    const patch: Partial<Song> = { lyrics, lyricSource: result.source };
    const state = usePlayerStore.getState();
    const now = state.currentSong;
    if (!now || now.id !== song.id || now.lyrics !== before || !songHasSyncedLyrics({ ...now, lyrics })) return false;
    state.updateCurrentSong(patch);
    if (state.playlistQueue) {
      state.updateQueue(state.playlistQueue.map(s => (s.id === song.id ? { ...s, ...patch } : s)));
    }
    if (!isStreamSongId(song.id)) {
      // A song on the phone keeps the synced lines for its next play.
      try {
        const queries = await import('../../database/queries');
        await queries.updateSong({ ...now, ...patch });
      } catch {
        // On screen for now; the library keeps its old lyrics.
      }
    }
    return true;
  } catch {
    // The plain lyrics stay; nothing else depends on this.
    return false;
  }
}
