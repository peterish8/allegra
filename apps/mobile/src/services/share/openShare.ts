/**
 * Opening a share (a tapped link, or a scanned LuvLyrics code): a song plays at once and Now Playing opens on it, the
 * way Spotify opens a shared track; a public playlist opens on its own page in Library (SharedPlaylistScreen).
 * A song link whose catalog id no longer resolves is found again by its title and artist.
 */
import type { ShareTarget } from '@shared/shareLinks';
import { navigationRef, openMainTab } from '../../utils/navigationService';
import { searchOfficial } from '../stream/officialSearch';
import { StreamService } from '../stream/StreamService';
import { usePlayerStore } from '../../store/playerStore';
import { fetchSharedPlaylist, fetchSharedSong } from './shareService';
import type { UnifiedSong } from '../../types/song';

export type OpenOutcome = 'playing' | 'opened' | 'not-found';

/** The song a link names: by its catalog id, else found again by title and artist. Null when neither finds it; throws only when a lookup failed and nothing else resolved. */
async function resolveShareSong(target: Extract<ShareTarget, { kind: 'song' }>): Promise<UnifiedSong | null> {
  let failure: unknown = null;
  if (target.ref) {
    try {
      const song = await fetchSharedSong(target.ref);
      if (song) return song;
    } catch (error) { failure = error; }
  }
  if (target.title) {
    try {
      const found = await searchOfficial(`${target.title} ${target.artist}`.trim(), 3);
      if (found[0]) return found[0];
    } catch (error) { failure = error; }
  }
  if (failure) throw failure;
  return null;
}

export async function openShareTarget(target: ShareTarget): Promise<OpenOutcome> {
  if (target.kind === 'playlist') {
    openMainTab({ screen: 'Library', params: { screen: 'SharedPlaylist', params: { code: target.code } } });
    return 'opened';
  }
  const song = await resolveShareSong(target).catch(() => null);
  if (!song) return 'not-found';
  playResolvedSong(song);
  return 'playing';
}

/** Plays a song that is already resolved (the scanner's result card) and opens Now Playing on it. */
export function playResolvedSong(song: UnifiedSong): void {
  StreamService.play([song], 0);
  const songId = usePlayerStore.getState().currentSongId;
  if (songId) navigationRef.navigate('NowPlaying', { songId });
}

/**
 * Whether a share can be opened right now, without opening it: a playlist code the server still knows, or a song that
 * resolves. The scanner asks first, so a dead code says so on the scanner instead of leaving an empty page behind.
 * 'unreachable' is a network failure (try again), 'gone' is a code that no longer opens anything.
 */
export type ShareCheck = 'ok' | 'gone' | 'unreachable';

export async function checkShareTarget(target: ShareTarget): Promise<ShareCheck> {
  try {
    const found = target.kind === 'playlist' ? await fetchSharedPlaylist(target.code) : await resolveShareSong(target);
    return found ? 'ok' : 'gone';
  } catch {
    return 'unreachable';
  }
}
