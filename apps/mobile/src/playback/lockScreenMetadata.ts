/**
 * What the notification and lock screen say about the song that is playing (Android).
 *
 * `MainPlayer.updateMetadata` rewrites the metadata of whatever item the engine is playing at the moment the call
 * lands. A skip is a queue command that lands a moment after the screen has already moved, so a call made at once
 * for the new song could land while the engine was still on the old one and give that item the new song's title
 * and cover (it showed the wrong title in the notification after two quick skips). The call therefore waits until
 * no queue command is in flight, and is dropped if the song changed again meanwhile.
 */
import { NativeAudioPlayer, whenQueueIdle } from '../services/NativeAudioPlayer';

export interface LockScreenSong {
  title?: string;
  artist?: string;
  album?: string;
  coverImageUri?: string;
}

/** Returns a function that drops the update if it has not been sent yet. */
export function publishLockScreenMetadata(song: LockScreenSong): () => void {
  let dropped = false;
  whenQueueIdle(() => {
    if (dropped) return;
    NativeAudioPlayer.updateMetadata({
      title: song.title || 'Unknown Title',
      artist: song.artist || 'Unknown Artist',
      album: song.album || '',
      artworkUri: song.coverImageUri || '',
    });
  });
  return () => { dropped = true; };
}
