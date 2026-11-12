import { usePlayerStore } from '../store/playerStore';
import { playbackStatusOf } from '../playback/playbackStatus';

export const usePlaybackStatus = () => usePlayerStore(playbackStatusOf);
