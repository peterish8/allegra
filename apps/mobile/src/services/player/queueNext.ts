/**
 * "Play next" for a song on the phone (the long-press sheet). Catalog songs have their own path through
 * StreamService.playNext, which also routes to another device while Connect plays there; a song on the phone
 * only joins this phone's own queue, so the action is offered only while this phone has one.
 */
import { prepareNextInQueue, usePlayerStore, usesNativeQueue } from '../../store/playerStore';
import { fire, nativeQueue } from '../../playback/nativeQueue';
import type { Song } from '../../types/song';

/** Whether this phone has a queue a song can join right after the playing one. */
export const canQueueNext = (song: Song): boolean => {
  const { playlistQueue, currentSongId } = usePlayerStore.getState();
  return Boolean(playlistQueue && playlistQueue.length > 0 && currentSongId && currentSongId !== song.id);
};

/** The queue with `song` moved (or added) right after `currentId`. Pure, for the JavaScript-owned queue. */
export const withSongNext = (queue: readonly Song[], currentId: string, song: Song): Song[] => {
  const rest = queue.filter(s => s.id !== song.id);
  const at = rest.findIndex(s => s.id === currentId) + 1;
  return [...rest.slice(0, at), song, ...rest.slice(at)];
};

export const queueNext = (song: Song): boolean => {
  if (!canQueueNext(song)) return false;
  const state = usePlayerStore.getState();
  if (usesNativeQueue()) {
    // The engine puts it right after the playing song (shuffle-aware); the screen follows its report.
    fire(nativeQueue.insert([song], 'next').then(() => state.reconcileNativeQueue()));
    return true;
  }
  state.updateQueue(withSongNext(state.playlistQueue ?? [], state.currentSongId ?? '', song));
  prepareNextInQueue();
  return true;
};
