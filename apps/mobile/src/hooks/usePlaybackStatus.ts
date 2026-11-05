import { usePlayerStore } from '../store/playerStore';
import { playbackStatus } from '../playback/playbackStatus';

export const usePlaybackStatus = () => usePlayerStore(s => playbackStatus({
  hasSong: s.currentSongId !== null,
  playWhenReady: s.isPlaying,
  audible: s.playbackSongId === s.currentSongId && s.audible,
  buffering: s.playbackSongId === s.currentSongId && s.buffering,
  error: s.playbackSongId === s.currentSongId ? s.playbackError : null,
}));
