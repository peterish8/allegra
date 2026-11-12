/**
 * Now Playing's audio load, kept out of the React effect so it can be tested with the real store.
 *
 * MiniPlayer and Now Playing both watch `loadedAudioId`; whichever claims `beginAudioLoad` loads the song. This is
 * the Now Playing half. The rule that matters most: a song that is already loaded is NOT a load. Opening the player
 * on it (from the pill, a deep link, a share) must leave play and pause exactly as they are. The effect used to
 * "resume the first time the screen opens on a loaded track", which started a paused song the moment the player
 * opened.
 */
import {
  beginAudioLoad,
  endAudioLoad,
  playerControls,
  prepareNextInQueue,
  shouldPlayAfterLoad,
  takeResumePosition,
  usePlayerStore,
} from '../store/playerStore';
import type { Song } from '../types/song';
import { diag } from '../utils/diag';

export type NowPlayingLoadResult =
  /** The route's song is not the one in the player: the screen has nothing to load. */
  | { kind: 'other-song' }
  /** There is no audio address for it, not even in the database. */
  | { kind: 'no-audio' }
  /** The other screen holds the load, or another song took over while this one loaded. */
  | { kind: 'not-ours' }
  /** The song is in the player (it was, or this call loaded it). */
  | { kind: 'ready'; song: Song };

export interface NowPlayingLoadInput {
  songId: string;
  currentSong: Song | null;
  loadedAudioId: string | null;
  player: { replace: (source: string, song?: Song) => Promise<unknown> | unknown } | null;
  /** The database copy of a song (its audio address, its lyrics). */
  fetchSong: (id: string) => Promise<Song | null>;
}

export async function loadForNowPlaying(input: NowPlayingLoadInput): Promise<NowPlayingLoadResult> {
  const { songId, currentSong, loadedAudioId, player, fetchSong } = input;
  if (currentSong?.id && currentSong.id !== songId) return { kind: 'other-song' };

  let song = currentSong?.id === songId ? currentSong : null;
  if (!song || !song.audioUri) song = await fetchSong(songId);
  if (!song?.audioUri) return { kind: 'no-audio' };

  // Already in the player: nothing to load and nothing to start or stop.
  if (loadedAudioId === songId) return { kind: 'ready', song };

  if (!beginAudioLoad(songId)) return { kind: 'not-ours' };
  try {
    // The song is named: a load keeps the queue it sits in (and never loads another song's address).
    await player?.replace(song.audioUri, song);
    // Give up only if another song took over while this one loaded. A dependency change (the lyrics landing
    // mid-load) re-runs the effect; bailing on that left the song loaded but never started.
    if (usePlayerStore.getState().currentSongId !== songId) return { kind: 'not-ours' };
    usePlayerStore.getState().setLoadedAudioId(songId);
    prepareNextInQueue();
    const resumeAt = takeResumePosition(songId);
    if (resumeAt !== null) playerControls.seekTo(resumeAt);
    // The song restored at launch, and one handed over paused, wait for a tap; any other load plays.
    const play = shouldPlayAfterLoad(songId);
    usePlayerStore.getState().requestPlayback(play);
    diag('audio', `player loaded "${song.title}", ${play ? 'play requested' : 'waits for a tap'}`);
    return { kind: 'ready', song };
  } finally {
    endAudioLoad(songId);
  }
}
