/**
 * Like or unlike a song the phone knows only by its ref: a streamed song, or the song another
 * device is playing over Connect. It is an online like, kept in `liked_online_songs` and synced
 * to the account; a like is not a download. A copy already in the library is liked directly by
 * the caller instead (songsStore.toggleLike).
 */
import type { SongSnapshot } from '@shared/songRef';

import { removeOnlineLike, upsertOnlineLike } from '../../database/syncQueries';
import { useOnlineLibraryStore } from '../../store/onlineLibraryStore';
import { record } from './LibrarySync';
import { likeOp } from './plan';

export async function toggleOnlineLike(song: SongSnapshot): Promise<'liked' | 'unliked' | 'error'> {
  const at = Date.now();
  try {
    if (useOnlineLibraryStore.getState().likedRefs.has(song.ref)) {
      await removeOnlineLike(song.ref);
      record(likeOp(song.ref, false, at));
      await useOnlineLibraryStore.getState().load();
      return 'unliked';
    }
    await upsertOnlineLike({ ...song, at });
    record(likeOp(song.ref, true, at, song));
    await useOnlineLibraryStore.getState().load();
    return 'liked';
  } catch {
    return 'error';
  }
}
