/**
 * What a tap on a stats row does (1.48.0): a song plays by its catalog id (or is found again by title and artist), an
 * artist's page opens. The same two actions the Listening stats page uses, shared with its full-list pages.
 */
import { parseSongRef } from '@shared/songRef';
import { openShareTarget } from '../../services/share/openShare';
import type { TopSong } from '../../services/stats/listeningStats';
import { navigationRef } from '../../utils/navigationService';

export function playStatsSong(song: TopSong): void {
  const parsed = song.ref ? parseSongRef(song.ref) : null;
  void openShareTarget({ kind: 'song', ref: parsed ? `${parsed.source}:${parsed.id}` : null, title: song.title, artist: song.artist });
}

export function openStatsArtist(name: string): void {
  if (navigationRef.isReady()) navigationRef.navigate('Main', { screen: 'Browse', params: { screen: 'Artist', params: { name } } });
}
