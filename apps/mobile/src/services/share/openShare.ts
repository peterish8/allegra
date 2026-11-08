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
import { fetchSharedSong } from './shareService';
import type { UnifiedSong } from '../../types/song';

export type OpenOutcome = 'playing' | 'opened' | 'not-found';

export async function openShareTarget(target: ShareTarget): Promise<OpenOutcome> {
  if (target.kind === 'playlist') {
    openMainTab({ screen: 'Library', params: { screen: 'SharedPlaylist', params: { code: target.code } } });
    return 'opened';
  }
  let song: UnifiedSong | null = target.ref ? await fetchSharedSong(target.ref).catch(() => null) : null;
  if (!song && target.title) {
    const found = await searchOfficial(`${target.title} ${target.artist}`.trim(), 3).catch(() => []);
    song = found[0] ?? null;
  }
  if (!song) return 'not-found';
  StreamService.play([song], 0);
  const songId = usePlayerStore.getState().currentSongId;
  if (songId) navigationRef.navigate('NowPlaying', { songId });
  return 'playing';
}
