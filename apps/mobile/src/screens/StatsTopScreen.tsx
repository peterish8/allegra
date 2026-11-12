/**
 * Top artists and Top songs in full (1.48.0, from Listening stats): the headline in words ("You listened to 42 artists
 * this week"), the dates, then every ranked row with its picture, its move against the period before and how many
 * weeks it made the top five. Share sends the top five as a picture. A finished week opens here too (`weekStart`).
 * Loading, empty and could-not-read states are all said in words; nothing is estimated.
 */
import React, { useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { RouteProp, useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppScreen } from '../components/AppScreen';
import { RankedArtistRow, RankedSongRow } from '../components/stats/RankedRows';
import { openStatsArtist, playStatsSong } from '../components/stats/statsActions';
import { useListenHistory } from '../hooks/useListenHistory';
import { rangeWords, type TopArtist, type TopSong } from '../services/stats/listeningStats';
import { listenedHeadline, statsFor, topFiveWeeks } from '../services/stats/statsPages';
import { shareStatsCard, statsImageFailureText } from '../services/stats/statsImage';
import { listCardModel } from '../services/stats/statsShare';
import type { TabParamList } from '../types/navigation';
import { EmptyState, GUTTER, IconButton, RowPlaceholder, Signal, Space, Text, useBottomClearance } from '../ui';
import { safeGoBack } from '../utils/navigationService';

export const StatsTopScreen: React.FC = () => {
  const { params } = useRoute<RouteProp<TabParamList, 'StatsTop'>>();
  const navigation = useNavigation();
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const bottom = useBottomClearance();
  const history = useListenHistory(focused);
  const [sharing, setSharing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const artists = params.kind === 'artists';

  const page = useMemo(
    () => (history.loading || history.failed ? null : statsFor(history.log, params, Date.now(), history.first)),
    [history, params],
  );
  const weeks = useMemo(() => topFiveWeeks(history.log, artists ? 'artist' : 'song'), [history.log, artists]);
  const stats = page?.stats ?? null;
  const model = stats ? listCardModel(params.kind, stats) : null;

  const share = () => {
    if (!model || sharing) return;
    setSharing(true);
    setNote(null);
    void shareStatsCard(model).then(result => {
      setSharing(false);
      if (result.ok === false) setNote(statsImageFailureText(result.reason));
    });
  };

  const header = (
    <View>
      <View style={styles.bar}>
        <IconButton icon="chevron-back" label="Back" onPress={() => safeGoBack(navigation)} />
        {model ? <IconButton icon="share-outline" label={`Share your top ${params.kind} as a picture`} onPress={share} disabled={sharing} /> : null}
      </View>
      <View style={styles.titleBlock}>
        <Text variant="display" accessibilityRole="header">{artists ? 'Top artists' : 'Top songs'}</Text>
        {page && stats && !stats.empty ? (
          <>
            <Text variant="secondary" tone="secondary">{rangeWords(stats.bounds)}</Text>
            <Text variant="page" style={styles.headline}>{listenedHeadline(params.kind, artists ? stats.artists : stats.songs, page.period)}</Text>
          </>
        ) : null}
        {note ? <Text variant="secondary" tone="secondary" accessibilityRole="alert">{note}</Text> : null}
      </View>
    </View>
  );

  if (stats && !stats.empty) {
    const rows: readonly (TopArtist | TopSong)[] = artists ? stats.rankedArtists : stats.rankedSongs;
    return (
      <AppScreen style={styles.screen}>
        <FlatList
          data={rows}
          keyExtractor={(item, i) => `${'name' in item ? item.name : item.key}-${i}`}
          ListHeaderComponent={header}
          contentContainerStyle={{ paddingTop: insets.top, paddingBottom: bottom }}
          renderItem={({ item, index }) => 'name' in item
            ? <RankedArtistRow artist={item} rank={index + 1} ranked={stats.ranked} weeks={weeks.get(item.name.toLowerCase())} onOpen={openStatsArtist} />
            : <RankedSongRow song={item} rank={index + 1} ranked={stats.ranked} weeks={weeks.get(item.key)} onPlay={playStatsSong} />}
        />
      </AppScreen>
    );
  }

  let body: React.ReactNode;
  if (history.loading) {
    body = <View accessibilityLabel="Loading your stats">{[0, 1, 2, 3, 4, 5].map(i => <RowPlaceholder key={i} />)}</View>;
  } else if (history.failed) {
    body = <EmptyState icon="alert-circle-outline" title="Couldn't read your stats" body="Your listening is kept on this phone. Try again." action={{ label: 'Try again', onPress: history.reload }} />;
  } else {
    body = <EmptyState icon="musical-notes-outline" title="Nothing here yet" body="Play some music and this list fills in. Every song you hear on this phone counts." />;
  }
  return (
    <AppScreen style={styles.screen}>
      <View style={{ paddingTop: insets.top, paddingBottom: bottom }}>
        {header}
        {body}
      </View>
    </AppScreen>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Signal.bgDeep },
  bar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: Space.xs, paddingTop: Space.xs },
  titleBlock: { paddingHorizontal: GUTTER, paddingBottom: Space.md, gap: Space.xs },
  headline: { marginTop: Space.sm },
});

export default StatsTopScreen;
