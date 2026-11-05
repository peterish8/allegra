export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';
export interface PlaybackSnapshot { hasSong: boolean; playWhenReady: boolean; audible: boolean; buffering: boolean; error: string | null }
/** Transport intent and audible state are different during buffering. */
export function playbackStatus(s: PlaybackSnapshot): PlaybackStatus {
  if (!s.hasSong) return 'idle';
  if (s.error) return 'error';
  if (s.playWhenReady && (s.buffering || !s.audible)) return 'loading';
  return s.playWhenReady && s.audible ? 'playing' : 'paused';
}
export const playbackErrorMessage = (reason: string): string => reason === 'expired'
  ? 'This song’s link expired. Try again to get a fresh link.'
  : reason === 'network' ? 'The song could not be reached. Check your connection and try again.'
  : reason === 'stall' ? 'The song stopped loading. Try again, or skip to the next song.'
  : 'This song could not play. Try again, or choose another song.';
