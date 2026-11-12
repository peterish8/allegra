/**
 * Insights (1.48.0, from Listening stats and Past weeks): swipeable cards of facts from the listener's own log, each
 * one shareable as a picture. Only cards the log can back are shown (services/stats/statsPages); with none, the page
 * says so instead of inventing numbers. A finished week opens here with `weekStart`.
 */
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { RouteProp, useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppScreen } from '../components/AppScreen';
import { InsightPager } from '../components/stats/InsightPager';
import { useListenHistory } from '../hooks/useListenHistory';
import { rangeWords } from '../services/stats/listeningStats';
import { insightCards, statsFor } from '../services/stats/statsPages';
import { shareStatsCard, statsImageFailureText } from '../services/stats/statsImage';
import { insightCardModel } from '../services/stats/statsShare';
import type { TabParamList } from '../types/navigation';
import { Button, EmptyState, GUTTER, IconButton, RowPlaceholder, Signal, Space, Text, useBottomClearance } from '../ui';
import { safeGoBack } from '../utils/navigationService';

export const StatsInsightsScreen: React.FC = () => {
  const { params } = useRoute<RouteProp<TabParamList, 'StatsInsights'>>();
  const navigation = useNavigation();
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const bottom = useBottomClearance();
  const history = useListenHistory(focused);
  const [index, setIndex] = useState(0);
  const [sharing, setSharing] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const page = useMemo(
    () => (history.loading || history.failed ? null : statsFor(history.log, params, Date.now(), history.first)),
    [history, params],
  );
  const cards = useMemo(() => (page ? insightCards(history.log, page.stats) : []), [page, history.log]);
  const current = cards[Math.min(index, Math.max(0, cards.length - 1))];
  const dates = page ? rangeWords(page.stats.bounds) : '';

  const share = () => {
    if (!current || !page || sharing) return;
    setSharing(true);
    setNote(null);
    void shareStatsCard(insightCardModel(current, page.period, dates)).then(result => {
      setSharing(false);
      if (result.ok === false) setNote(statsImageFailureText(result.reason));
    });
  };

  let body: React.ReactNode;
  if (history.loading) {
    body = <View accessibilityLabel="Loading your insights">{[0, 1, 2].map(i => <RowPlaceholder key={i} />)}</View>;
  } else if (history.failed) {
    body = <EmptyState icon="alert-circle-outline" title="Couldn't read your stats" body="Your listening is kept on this phone. Try again." action={{ label: 'Try again', onPress: history.reload }} />;
  } else if (!page || cards.length === 0) {
    body = <EmptyState icon="sparkles-outline" title="No insights yet" body="Cards appear once you have listened for a while, and only from songs you really played." />;
  } else {
    body = (
      <>
        <InsightPager cards={cards} period={page.period} index={index} onIndex={setIndex} />
        <View style={styles.share}>
          <Button label="Share" icon="share-social-outline" variant="primary" busy={sharing} onPress={share} accessibilityLabel="Share this card as a picture" />
          {note ? <Text variant="secondary" tone="secondary" accessibilityRole="alert">{note}</Text> : null}
        </View>
      </>
    );
  }

  return (
    <AppScreen style={styles.screen}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top, paddingBottom: bottom }}>
        <View style={styles.bar}>
          <IconButton icon="chevron-back" label="Back" onPress={() => safeGoBack(navigation)} />
        </View>
        <View style={styles.titleBlock}>
          <Text variant="display" accessibilityRole="header">{params.weekStart !== undefined && dates ? `Insights for ${dates}` : 'Insights'}</Text>
          {params.weekStart === undefined && dates ? <Text variant="secondary" tone="secondary">{dates}</Text> : null}
        </View>
        {body}
      </ScrollView>
    </AppScreen>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Signal.bgDeep },
  bar: { paddingHorizontal: Space.xs, paddingTop: Space.xs },
  titleBlock: { paddingHorizontal: GUTTER, paddingBottom: Space.md, gap: Space.xs },
  share: { alignItems: 'center', gap: Space.sm, marginTop: Space.lg },
});

export default StatsInsightsScreen;
