/**
 * Listening stats (1.45.0, owner): Spotify keeps its listening stats to a four-week glance of top artists and songs;
 * LuvLyrics is free, so everyone gets everything, for any range: minutes heard and the change on the period before,
 * top 5 artists and songs, the song on repeat and how long it played, when you listen (a 24-hour clock and the kind
 * of listener that makes you), your week, day by day, the tempo of what you play, streaks, finishing and skipping,
 * and what was new to you.
 *
 * Counted from what this phone heard (services/stats), kept only on this phone; collecting can be paused and the
 * history cleared at the bottom of the page.
 */
import React, { useState } from 'react';
import { parseSongRef } from '@shared/songRef';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppScreen } from '../components/AppScreen';
import { useArtworkPalette } from '../components/allegra/useArtworkPalette';
import { Switch } from '../components/settings/SettingsKit';
import {
  Card, DailyBars, EmptyRing, Habits, Hero, ListeningClock, OnRepeat, TempoCard, TopArtists, TopSongs, WeekBars,
} from '../components/stats/StatsParts';
import { clearListens } from '../database/listenLogQueries';
import { useListeningStats } from '../hooks/useListeningStats';
import { openShareTarget } from '../services/share/openShare';
import { changeWords, STATS_RANGES, type StatsRange, type TopSong } from '../services/stats/listeningStats';
import { useSettingsStore } from '../store/settingsStore';
import { Chip, ChipRow, ConfirmSheet, GUTTER, IconButton, Signal, Space, Text, TextButton, useBottomClearance } from '../ui';
import { navigationRef, safeGoBack } from '../utils/navigationService';

export const ListeningStatsScreen: React.FC = () => {
  const navigation = useNavigation();
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const bottom = useBottomClearance();
  const [range, setRange] = useState<StatsRange>('month');
  const { loading, stats, tempo, tempoBusy, reload } = useListeningStats(range, focused);
  const collecting = useSettingsStore(s => s.listeningStats);
  const setCollecting = useSettingsStore(s => s.setListeningStats);
  const [confirmClear, setConfirmClear] = useState(false);
  const palette = useArtworkPalette(stats?.onRepeat?.artwork ?? undefined);

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

  return (
    <AppScreen style={styles.screen}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top, paddingBottom: bottom }}>
        <View style={styles.header}>
          <IconButton icon="arrow-back" label="Back" variant="secondary" shape="disc" onPress={() => safeGoBack(navigation)} />
          <View style={styles.headerText}>
            <Text variant="page" accessibilityRole="header">Listening stats</Text>
            <Text variant="secondary" tone="secondary">Free for everyone. Kept on this phone.</Text>
          </View>
        </View>

        <ChipRow gutter={GUTTER}>
          {STATS_RANGES.map(r => <Chip key={r.id} label={r.label} selected={r.id === range} onPress={() => setRange(r.id)} />)}
        </ChipRow>

        {loading || !stats ? null : stats.empty ? (
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
            <Hero stats={stats} tint={palette.primary} change={changeWords(stats.change, range)} />
            <TopArtists artists={stats.topArtists} onOpen={openArtist} />
            <TopSongs songs={stats.topSongs} onPlay={play} />
            {stats.onRepeat ? <OnRepeat song={stats.onRepeat} tint={palette.secondary} onPlay={() => play(stats.onRepeat!)} /> : null}
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
  header: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingHorizontal: Space.xs, paddingVertical: Space.sm },
  headerText: { flex: 1, minWidth: 0 },
  empty: { alignItems: 'center', gap: Space.sm, paddingHorizontal: GUTTER * 2, paddingVertical: Space.xxl },
  sectionTitle: { marginHorizontal: GUTTER, marginTop: Space.lg },
});

export default ListeningStatsScreen;
