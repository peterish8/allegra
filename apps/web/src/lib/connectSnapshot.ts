import { shareableArtwork } from '@shared/artwork';
import { fromAllegraSong, type SongSnapshot } from '@shared/songRef';
import type { UnifiedSong } from '@shared/types';

import type { LibrarySong } from './libraryRows';

/**
 * What another device is sent for a song this browser shows (Connect, and the account library).
 *
 * A song from the account library carries the snapshot stored with its like or playlist entry,
 * and that is what travels, so another device names it the same way. Its cover is the one this
 * browser shows, though: the stored one is often empty (written by a phone whose only cover was
 * a file of its own), while the catalog row the browser hydrated has the real cover. Sending the
 * stored one made the phone draw a placeholder for a song the laptop showed with its cover.
 */
export function snapshotFromSong(song: UnifiedSong): SongSnapshot | null {
  const library = song as UnifiedSong & Partial<Pick<LibrarySong, 'libraryRef' | 'librarySnapshot'>>;
  const ref = library.libraryRef ?? fromAllegraSong(song);
  if (!ref) return null;
  const stored = library.librarySnapshot;
  const artwork = shareableArtwork(song.artwork, stored?.artwork);
  if (stored) return stored.artwork === artwork ? stored : { ...stored, artwork };
  return {
    ref,
    title: song.title,
    artist: song.artist,
    ...(song.album ? { album: song.album } : {}),
    artwork,
    duration: song.duration
  };
}

/**
 * A song that arrived from another device, kept with the cover this browser found for it: what it
 * sends on (back to that device, to the account) then has a cover even when the sender had none.
 */
export function withFoundCover(sent: SongSnapshot, found: string | null | undefined): SongSnapshot {
  const artwork = shareableArtwork(found, sent.artwork);
  return artwork === sent.artwork ? sent : { ...sent, artwork };
}
