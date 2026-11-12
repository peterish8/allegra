/**
 * "Past weeks" (1.48.0): each finished week with listening, its dates, its top song and that song's plays. A tap opens
 * that week's insights. Straight on the page, no box, like Spotify's list.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Space } from '../../constants/allegraTheme';
import { GUTTER, ListRow, Text } from '../../ui';
import { groupedNumber, type PastWeek } from '../../services/stats/statsPages';

export const PastWeeks: React.FC<{ weeks: readonly PastWeek[]; onOpen: (week: PastWeek) => void }> = ({ weeks, onOpen }) => {
  if (weeks.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text variant="title" accessibilityRole="header" style={styles.title}>Past weeks</Text>
      {weeks.map(week => {
        const song = week.topSong;
        const detail = song ? `${song.title} · ${groupedNumber(song.plays)} ${song.plays === 1 ? 'play' : 'plays'}` : `${groupedNumber(week.minutes)} min`;
        return (
          <ListRow
            key={week.weekStart}
            title={week.label}
            subtitle={detail}
            artwork={song ? { uri: song.artwork ?? undefined, title: song.title, artist: song.artist } : undefined}
            icon={song ? undefined : 'calendar-outline'}
            chevron
            onPress={() => onOpen(week)}
            accessibilityLabel={`${week.label}. ${detail}. ${groupedNumber(week.minutes)} minutes`}
          />
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  section: { marginTop: Space.lg },
  title: { marginHorizontal: GUTTER, marginBottom: Space.xs },
});
