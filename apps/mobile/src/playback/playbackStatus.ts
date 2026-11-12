export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';
export interface PlaybackSnapshot { hasSong: boolean; playWhenReady: boolean; audible: boolean; buffering: boolean; error: string | null }
/** Transport intent and audible state are different during buffering. */
export function playbackStatus(s: PlaybackSnapshot): PlaybackStatus {
  if (!s.hasSong) return 'idle';
  if (s.error) return 'error';
  if (s.playWhenReady && (s.buffering || !s.audible)) return 'loading';
  return s.playWhenReady && s.audible ? 'playing' : 'paused';
}
/** The slice of the player store the status is read from. */
export interface PlayerStatusSource {
  currentSongId: string | null;
  isPlaying: boolean;
  playbackSongId: string | null;
  audible: boolean;
  buffering: boolean;
  playbackError: string | null;
}

/** The status the screens show, from the player store. A report about another song says nothing about this one. */
export const playbackStatusOf = (s: PlayerStatusSource): PlaybackStatus => playbackStatus({
  hasSong: s.currentSongId !== null,
  playWhenReady: s.isPlaying,
  audible: s.playbackSongId === s.currentSongId && s.audible,
  buffering: s.playbackSongId === s.currentSongId && s.buffering,
  error: s.playbackSongId === s.currentSongId ? s.playbackError : null,
});

/**
 * Whether the playhead is moving: audio is coming out. While a song loads or buffers the transport already says
 * "playing" (playWhenReady) but the playhead stands at 0, so a prediction that keeps counting there thinks a song
 * that has not started is 4 s in.
 */
export const playheadIsMoving = (s: PlayerStatusSource): boolean => playbackStatusOf(s) === 'playing';

export const playbackErrorMessage = (reason: string): string => reason === 'expired'
  ? 'This song’s link expired. Try again to get a fresh link.'
  : reason === 'network' ? 'The song could not be reached. Check your connection and try again.'
  : reason === 'stall' ? 'The song stopped loading. Try again, or skip to the next song.'
  : 'This song could not play. Try again, or choose another song.';
