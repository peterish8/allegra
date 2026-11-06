/**
 * Plays a voice search's chosen match: a library song through the player (or the device Connect points at), a catalog
 * song with the other streamable matches after it. Shared by the floating card and the Search field.
 */
import { routeSongPick } from '../services/connect/playbackIntents';
import { StreamService } from './stream/StreamService';
import { usePlayerStore } from '../store/playerStore';
import type { VoicePick } from '../store/voiceSearchStore';

export const playVoicePick = (picks: VoicePick[], selected: number): boolean => {
  const pick = picks[selected];
  if (!pick) return false;
  if (pick.kind === 'local') {
    // While another device plays, the song goes there (Connect looks it up or asks first).
    if (!routeSongPick({ playlistId: 'voice', songs: [pick.song], startIndex: 0 })) {
      const store = usePlayerStore.getState();
      store.loadSong(pick.song.id);
      store.requestPlayback(true);
    }
    return true;
  }
  // The other streamable matches follow it, then radio takes over.
  const rest = picks
    .filter((p, i): p is Extract<VoicePick, { kind: 'stream' }> => p.kind === 'stream' && i !== selected)
    .map(p => p.song);
  StreamService.play([pick.song, ...rest], 0);
  return true;
};
