/**
 * The insight cards (1.48.0): swipeable cards in the way Spotify's weekly insights are, each one a single fact from
 * the listener's own log ("You spent 363 minutes listening to these albums", "12 hours of your listening"). A card
 * exists only when the log backs it (services/stats/statsPages). Cards page one at a time; dots show where you are,
 * and the caller puts Share under the pager.
 */
import React, { useCallback } from 'react';
import { FlatList, StyleSheet, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Artwork from '../allegra/Artwork';
import { Radius, Signal, Space } from '../../constants/allegraTheme';
import { GUTTER, Text } from '../../ui';
import { insightCaption, insightHeading, groupedNumber, type InsightCard, type Period } from '../../services/stats/statsPages';
import { SHARE_TONES } from '../../services/stats/statsShare';

const ART = 56;

const toneOf = (card: InsightCard) => SHARE_TONES[card.kind === 'albums' ? 'albums' : card.kind === 'hours' ? 'hours' : 'streak'];

const CardBody: React.FC<{ card: InsightCard; period: Period }> = ({ card, period }) => {
  const tone = toneOf(card);
  if (card.kind === 'albums') {
    return (
      <>
        <Text variant="detail" style={{ color: tone.accent }} accessibilityRole="header">{insightHeading(card)}</Text>
        <View style={styles.albums}>
          {card.items.map(item => (
            <View key={`${item.title}-${item.artist}`} style={styles.albumRow} accessible accessibilityLabel={`${item.title} by ${item.artist}, ${item.minutes} minutes`}>
              <View style={styles.art}><Artwork uri={item.artwork} title={item.title} artist={item.artist} size={ART} style={StyleSheet.absoluteFill} /></View>
              <View style={styles.albumText}>
                <Text variant="display" tabular style={{ color: tone.accent }}>{groupedNumber(item.minutes)} <Text variant="secondary" style={{ color: tone.accent }}>min</Text></Text>
                <Text variant="secondary" numberOfLines={2} style={{ color: tone.accent }}>{item.title} · {item.artist}</Text>
              </View>
            </View>
          ))}
        </View>
      </>
    );
  }
  const figure = card.kind === 'hours' ? `${card.figure} ${card.unit}` : `${card.days} days`;
  return (
    <>
      {card.kind === 'hours' ? (
        <View style={styles.art}><Artwork uri={card.artwork} title={card.artist} size={ART} style={StyleSheet.absoluteFill} /></View>
      ) : null}
      <Text variant="hero" tabular style={{ color: tone.accent }} accessibilityRole="header">{figure}</Text>
      <Text variant="lead" style={{ color: Signal.ink }}>{card.kind === 'hours' ? 'of your listening' : 'in a row'}</Text>
      <Text variant="secondary" style={{ color: Signal.inkSoft }}>{insightCaption(card, period)}</Text>
    </>
  );
};

export const InsightPager: React.FC<{
  cards: readonly InsightCard[];
  period: Period;
  index: number;
  onIndex: (index: number) => void;
}> = ({ cards, period, index, onIndex }) => {
  const { width } = useWindowDimensions();
  const cardWidth = width - GUTTER * 2;
  const step = cardWidth + Space.sm;

  const onEnd = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.max(0, Math.min(cards.length - 1, Math.round(event.nativeEvent.contentOffset.x / step)));
    onIndex(next);
  }, [cards.length, onIndex, step]);

  return (
    <View>
      <FlatList
        data={cards}
        horizontal
        snapToInterval={step}
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        keyExtractor={card => card.kind}
        contentContainerStyle={{ paddingHorizontal: GUTTER, gap: Space.sm }}
        onMomentumScrollEnd={onEnd}
        renderItem={({ item }) => (
          <View style={[styles.card, { width: cardWidth, backgroundColor: toneOf(item).bg }]}>
            <CardBody card={item} period={period} />
          </View>
        )}
      />
      <View style={styles.dots} accessible accessibilityLabel={`Card ${index + 1} of ${cards.length}`}>
        {cards.map((card, i) => <View key={card.kind} style={[styles.dot, i === index && styles.dotOn]} />)}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: { minHeight: 420, borderRadius: Radius.sheet, padding: Space.lg, gap: Space.sm, justifyContent: 'center' },
  albums: { gap: Space.md, marginTop: Space.md },
  albumRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  albumText: { flex: 1, minWidth: 0 },
  art: { width: ART, height: ART, borderRadius: 6, overflow: 'hidden' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: Space.xs, marginTop: Space.md },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Signal.inkFaint },
  dotOn: { backgroundColor: Signal.ink },
});
