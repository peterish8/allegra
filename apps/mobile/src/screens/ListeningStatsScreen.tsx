/**
 * Listening stats (1.45.0, owner): Spotify keeps its listening stats to a four-week glance of top artists and songs;
 * LuvLyrics is free, so everyone gets everything, for any range: minutes heard and the change on the period before,
 * top 5 artists and songs, when you listen (a 24-hour clock and the kind of listener that makes you), your week, day
 * by day, the tempo of what you play, streaks, finishing and skipping, and what was new to you.
 *
 * 1.46.0 (owner: "neat, like Spotify"): the page opens the way Spotify's does (newsroom, 2025-11-06): a plain back
 * chevron, the big title, the dates with Share beside them, then two tiles (top artist, top song) with Spotify's rank
 * chips against the period before, then one highlight card (a new find, or another song on repeat; never the top
 * song again). The rest of the page follows below.
 *
 * Counted from what this phone heard (services/stats), kept only on this phone; collecting can be paused and the
 * history cleared at the bottom of the page.
 */
import React, { useMemo, useState } from 'react';
import { parseSongRef } from '@shared/songRef';
import { ScrollView, Share, StyleSheet, View, useWindowDimensions } from 'react-native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppScreen } from '../components/AppScreen';
import { useArtworkPalette } from '../components/allegra/useArtworkPalette';
import { Switch } from '../components/settings/SettingsKit';
import { PastWeeks } from '../components/stats/PastWeeks';
import {
  Card, DailyBars, EmptyRing, Habits, Hero, Highlight, ListeningClock, Spotlight, TempoCard, TopArtists, TopSongs, WeekBars,
} from '../components/stats/StatsParts';
import { clearListens } from '../database/listenLogQueries';
import { useListeningStats } from '../hooks/useListeningStats';
import { openShareTarget } from '../services/share/openShare';
import { changeWords, rangeWords, statsShareText, STATS_RANGES, type StatsRange, type TopSong } from '../services/stats/listeningStats';
import { insightCards, pastWeeks } from '../services/stats/statsPages';
import { useSettingsStore } from '../store/settingsStore';
import type { TabParamList } from '../types/navigation';
import { Chip, ChipRow, ConfirmSheet, EmptyState, GUTTER, IconButton, ListRow, Signal, Space, Text, TextButton, useBottomClearance } from '../ui';
import { navigationRef, safeGoBack } from '../utils/navigationService';

export const ListeningStatsScreen: React.FC = () => {
  const navigation = useNavigation<BottomTabNavigationProp<TabParamList>>();
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const bottom = useBottomClearance();
  const [range, setRange] = useState<StatsRange>('month');
  const { loading, stats, tempo, tempoBusy, reload, log, failed } = useListeningStats(range, focused);
  // The finished weeks and the insight cards come from the same log the numbers do (1.48.0).
  const weeks = useMemo(() => pastWeeks(log, Date.now()), [log]);
  const cards = useMemo(() => (stats ? insightCards(log, stats) : []), [log, stats]);
  const collecting = useSettingsStore(s => s.listeningStats);
  const setCollecting = useSettingsStore(s => s.setListeningStats);
  const [confirmClear, setConfirmClear] = useState(false);
  const palette = useArtworkPalette(stats?.onRepeat?.artwork ?? undefined);
  const { width } = useWindowDimensions();
  const cardWidth = width - GUTTER * 2;
  const tileWidth = (cardWidth - Space.sm) / 2;

  // A song with a catalog id plays by it; any other is found again by its title and artist.
  const play = (song: TopSong) => {
    const parsed = song.ref ? parseSongRef(song.ref) : null;
    void openShareTarget({ kind: 'song', ref: parsed ? `${parsed.source}:${parsed.id}` : null, title: song.title, artist: song.artist });
  };
  const openArtist = (name: string) => {
    if (navigationRef.isReady()) navigationRef.navigate('Main', { screen: 'Browse', params: { screen: 'Artist', params: { name } } });
  };
  const clear = async () => {
    setConfirmClear(false);
    await clearListens().catch(() => undefined);
    reload();
  };

  const share = () => {
    if (!stats || stats.empty) return;
    Share.share({ message: statsShareText(stats) }).catch(() => undefined);
  };
  const shareable = !!stats && !stats.empty;

  return (
    <AppScreen style={styles.screen}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top, paddingBottom: bottom }}>
        {/* Spotify's listening stats: a plain back chevron, the big title, then the dates with Share beside them. */}
        <View style={styles.bar}>
          <IconButton icon="chevron-back" label="Back" onPress={() => safeGoBack(navigation)} />
        </View>
        <View style={styles.titleBlock}>
          <Text variant="display" accessibilityRole="header">Listening stats</Text>
          <View style={styles.dateRow}>
            <View style={styles.dateText}>
              <Text variant="lead" numberOfLines={1}>{stats ? rangeWords(stats.bounds) : ' '}</Text>
              <Text variant="caption" tone="secondary">Free for everyone. Kept on this phone.</Text>
            </View>
            {shareable ? <IconButton icon="share-outline" label="Share your listening stats" onPress={share} /> : null}
          </View>
        </View>

        <ChipRow gutter={GUTTER}>
          {STATS_RANGES.map(r => <Chip key={r.id} label={r.label} selected={r.id === range} onPress={() => setRange(r.id)} />)}
        </ChipRow>

        {failed && !stats ? (
          <EmptyState icon="alert-circle-outline" title="Couldn't read your stats" body="Your listening is kept on this phone. Try again." action={{ label: 'Try again', onPress: reload }} />
        ) : loading || !stats ? null : stats.empty ? (
          <View style={styles.empty}>
            <EmptyRing />
            <Text variant="detail" align="center">Your stats start now</Text>
            <Text variant="secondary" tone="secondary" align="center">
              {collecting
                ? 'Play some music and come back: every song you hear on this phone counts, signed in or not.'
                : 'Collecting is paused. Turn it on below to start counting what you hear.'}
            </Text>
          </View>
        ) : (
          <>
            {/* The first glance, Spotify's order: top artist and top song side by side, then the highlight. */}
            <Spotlight artist={stats.topArtists[0]} song={stats.topSongs[0]} ranked={stats.ranked} tileWidth={tileWidth}
              onOpenArtist={openArtist} onPlay={play} />
            {stats.highlight ? <Highlight highlight={stats.highlight} width={cardWidth} onPlay={() => play(stats.highlight!.song)} /> : null}
            <Hero stats={stats} tint={palette.primary} change={changeWords(stats.change, range)} />
            <TopArtists artists={stats.topArtists} ranked={stats.ranked} onOpen={openArtist} onSeeAll={() => navigation.navigate('StatsTop', { kind: 'artists', range })} />
            <TopSongs songs={stats.topSongs} ranked={stats.ranked} onPlay={play} onSeeAll={() => navigation.navigate('StatsTop', { kind: 'songs', range })} />
            {cards.length > 0 ? (
              <ListRow title="Insights" subtitle="Cards from your listening, ready to share" icon="sparkles-outline" chevron onPress={() => navigation.navigate('StatsInsights', { range })} />
            ) : null}
            <PastWeeks weeks={weeks} onOpen={week => navigation.navigate('StatsInsights', { range: 'week', weekStart: week.weekStart })} />
            <ListeningClock stats={stats} />
            <TempoCard tempo={tempo} busy={tempoBusy} />
            <WeekBars stats={stats} />
            <DailyBars stats={stats} />
            <Text variant="title" style={styles.sectionTitle} accessibilityRole="header">Habits</Text>
            <Habits stats={stats} />
          </>
        )}

        <Card title="Your stats, your phone" caption="Counted from what you hear here. Nothing is uploaded for this page.">
          <Switch label="Keep counting" hint="Pause it any time; what is already counted stays." value={collecting} onChange={setCollecting} />
          <TextButton label="Clear listening stats" tone="danger" onPress={() => setConfirmClear(true)} />
        </Card>
      </ScrollView>

      <ConfirmSheet visible={confirmClear} title="Clear listening stats?" body="Every listen counted on this phone is removed. This cannot be undone."
        confirmLabel="Clear" destructive onConfirm={() => { void clear(); }} onClose={() => setConfirmClear(false)} />
    </AppScreen>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Signal.bgDeep },
  bar: { paddingHorizontal: Space.xs, paddingTop: Space.xs },
  titleBlock: { paddingHorizontal: GUTTER, paddingBottom: Space.sm, gap: Space.xs },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  dateText: { flex: 1, minWidth: 0 },
  empty: { alignItems: 'center', gap: Space.sm, paddingHorizontal: GUTTER * 2, paddingVertical: Space.xxl },
  sectionTitle: { marginHorizontal: GUTTER, marginTop: Space.lg },
});

export default ListeningStatsScreen;
