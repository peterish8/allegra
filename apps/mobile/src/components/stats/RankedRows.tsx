/**
 * The rows of the full Top artists and Top songs pages (1.48.0): place, picture, name with its time or plays, "N weeks
 * in top 5" under it, and the rank chip on the right (↑2, ↓1, New against the period before). Every row also says
 * all of that in words for TalkBack.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Artwork from '../allegra/Artwork';
import { Space, StatsTheme } from '../../constants/allegraTheme';
import { GUTTER, Tactile, Text } from '../../ui';
import { durationWords, rankMove, rankMoveWords, type TopArtist, type TopSong } from '../../services/stats/listeningStats';
import { groupedNumber, weeksInTopWords } from '../../services/stats/statsPages';
import { RankChip } from './StatsParts';

const ART = 52;

interface RowProps {
  readonly rank: number;
  readonly ranked: boolean;
  /** Calendar weeks in the top five; 0 or undefined when never. */
  readonly weeks: number | undefined;
}

export const RankedArtistRow: React.FC<RowProps & { artist: TopArtist; onOpen: (name: string) => void }> = ({ artist, rank, ranked, weeks, onOpen }) => {
  const move = rankMove(rank, artist.previousRank, ranked);
  const songs = `${artist.songs} ${artist.songs === 1 ? 'song' : 'songs'}`;
  const streak = weeksInTopWords(weeks);
  return (
    <Tactile onPress={() => onOpen(artist.name)} accessibilityRole="button" style={styles.row}
      accessibilityLabel={`Number ${rank}, ${artist.name}, ${durationWords(artist.seconds)}, ${songs}. ${streak}. ${rankMoveWords(move)}`}
      accessibilityHint="Opens the artist">
      <Text variant="lead" tabular style={styles.rank}>{rank}</Text>
      <View style={[styles.art, styles.round]}><Artwork uri={artist.artwork} title={artist.name} size={ART} style={StyleSheet.absoluteFill} /></View>
      <View style={styles.text}>
        <Text variant="row" numberOfLines={1} style={styles.title}>{artist.name}</Text>
        <Text variant="secondary" tone="secondary" numberOfLines={1}>{durationWords(artist.seconds)} · {songs}</Text>
        {streak ? <Text variant="caption" tone="muted" numberOfLines={1}>{streak}</Text> : null}
      </View>
      <RankChip move={move} />
    </Tactile>
  );
};

export const RankedSongRow: React.FC<RowProps & { song: TopSong; onPlay: (song: TopSong) => void }> = ({ song, rank, ranked, weeks, onPlay }) => {
  const move = rankMove(rank, song.previousRank, ranked);
  const plays = `${groupedNumber(song.plays)} ${song.plays === 1 ? 'play' : 'plays'}`;
  const streak = weeksInTopWords(weeks);
  return (
    <Tactile onPress={() => onPlay(song)} accessibilityRole="button" style={styles.row}
      accessibilityLabel={`Number ${rank}, ${song.title} by ${song.artist}, ${plays}, ${durationWords(song.seconds)}. ${streak}. ${rankMoveWords(move)}`}
      accessibilityHint="Plays the song">
      <Text variant="lead" tabular style={styles.rank}>{rank}</Text>
      <View style={styles.art}><Artwork uri={song.artwork} title={song.title} artist={song.artist} size={ART} style={StyleSheet.absoluteFill} /></View>
      <View style={styles.text}>
        <Text variant="row" numberOfLines={1} style={styles.title}>{song.title}</Text>
        <Text variant="secondary" tone="secondary" numberOfLines={1}>{song.artist} · {plays}</Text>
        {streak ? <Text variant="caption" tone="muted" numberOfLines={1}>{streak}</Text> : null}
      </View>
      <RankChip move={move} />
    </Tactile>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: 72, paddingHorizontal: GUTTER },
  rank: { width: 28, textAlign: 'center', color: StatsTheme.rank },
  art: { width: ART, height: ART, borderRadius: 6, overflow: 'hidden' },
  round: { borderRadius: ART / 2 },
  text: { flex: 1, minWidth: 0 },
  title: { fontWeight: '600' },
});
