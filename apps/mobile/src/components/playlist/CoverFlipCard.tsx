/**
 * The playlist's cover, and the owner's extra (1.44.0): a double tap turns it over into a deck of the playlist's songs
 * as cards. Swipe the deck sideways and the card it comes to rest on plays; a double tap turns it back. While this
 * playlist plays, the deck opens on the playing song and follows it.
 *
 * Each face shows on its own half of the turn (no backface-visibility, which Android draws unreliably). Under Reduce
 * Motion the turn is a plain cross-fade. TalkBack: the card is one stop; its action turns it over, and while turned
 * swiping up or down steps through the songs.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, View, type AccessibilityActionEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { interpolate, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import Artwork from '../allegra/Artwork';
import { Glass, Motion, Radius, Signal, Space } from '../../constants/allegraTheme';
import { Text } from '../../ui/Text';
import * as Haptics from '../../utils/haptics';
import { deckStartIndex, FLIP_MS, settledCard, swipeChangesSong } from './playlistPage';

export interface FlipSong { id: string; title: string; artist?: string | null; coverImageUri?: string | null }

interface Props {
  size: number;
  /** The cover itself (the playlist's own, a mosaic or a generated one). */
  front: React.ReactNode;
  name: string;
  songs: readonly FlipSong[];
  playingId: string | null;
  /** This playlist is the one playing. */
  playingHere: boolean;
  /** Play the song at this index of `songs`. */
  onPick: (index: number) => void;
}

const DOUBLE_TAP_MS = 280;
const CARD_FADE = ['rgba(7, 8, 11, 0)', Glass.scrimHeavy] as const;

export const CoverFlipCard: React.FC<Props> = ({ size, front, name, songs, playingId, playingHere, onPick }) => {
  const reduce = useReducedMotion();
  const flip = useSharedValue(0);
  const [turned, setTurned] = useState(false);
  // The deck is built the first time the card turns over, not with the page.
  const [built, setBuilt] = useState(false);
  const ids = songs.map(s => s.id);
  const start = deckStartIndex(ids, playingId, playingHere);
  const [card, setCard] = useState(start);
  const list = useRef<FlatList<FlipSong>>(null);
  const canTurn = songs.length > 0;

  const turn = useCallback(() => {
    if (!canTurn && !turned) return;
    const next = !turned;
    if (next) { setBuilt(true); setCard(deckStartIndex(songs.map(s => s.id), playingId, playingHere)); }
    setTurned(next);
    Haptics.toggle();
    flip.value = withTiming(next ? 1 : 0, { duration: FLIP_MS, easing: Motion.ease.standard });
  }, [canTurn, turned, songs, playingId, playingHere, flip]);

  // While turned, the deck follows the playing song (a skip from the mini player, the song ending).
  useEffect(() => {
    if (!turned || !playingHere || !playingId) return;
    const at = songs.findIndex(s => s.id === playingId);
    if (at < 0 || at === card) return;
    setCard(at);
    list.current?.scrollToIndex({ index: at, animated: !reduce });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playingId, playingHere, turned]);

  const rest = (index: number) => {
    setCard(index);
    if (swipeChangesSong(songs[index]?.id, playingId, playingHere)) { Haptics.tap(); onPick(index); }
  };
  const onSettle = (e: NativeSyntheticEvent<NativeScrollEvent>) => rest(settledCard(e.nativeEvent.contentOffset.x, size, songs.length));
  const step = (by: number) => {
    const index = Math.min(songs.length - 1, Math.max(0, card + by));
    if (index === card) return;
    list.current?.scrollToIndex({ index, animated: !reduce });
    rest(index);
  };

  const doubleTap = Gesture.Tap().numberOfTaps(2).maxDelay(DOUBLE_TAP_MS).onEnd((_e, success) => {
    if (success) runOnJS(turn)();
  });

  // Under Reduce Motion the faces only cross-fade (no turn).
  const frontStyle = useAnimatedStyle(() => ({
    opacity: reduce ? 1 - flip.value : flip.value < 0.5 ? 1 : 0,
    transform: [{ perspective: 1200 }, { rotateY: `${reduce ? 0 : interpolate(flip.value, [0, 1], [0, 180])}deg` }] as const,
  }));
  const backStyle = useAnimatedStyle(() => ({
    opacity: reduce ? flip.value : flip.value >= 0.5 ? 1 : 0,
    transform: [{ perspective: 1200 }, { rotateY: `${reduce ? 0 : interpolate(flip.value, [0, 1], [-180, 0])}deg` }] as const,
  }));

  const song = songs[card];
  const onAction = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === 'activate') turn();
    else if (e.nativeEvent.actionName === 'increment') step(1);
    else if (e.nativeEvent.actionName === 'decrement') step(-1);
  };

  return (
    <GestureDetector gesture={doubleTap}>
      <View
        style={{ width: size, height: size }}
        accessible
        accessibilityRole={turned ? 'adjustable' : 'image'}
        accessibilityLabel={turned && song ? `${song.title}${song.artist ? ` by ${song.artist}` : ''}, card ${card + 1} of ${songs.length}` : `${name} cover`}
        accessibilityHint={turned ? 'Swipe up or down to change the song. Double tap to turn the cover back.' : canTurn ? 'Double tap to turn it into song cards' : undefined}
        accessibilityActions={turned ? [{ name: 'activate', label: 'Turn the cover back' }, { name: 'increment' }, { name: 'decrement' }] : canTurn ? [{ name: 'activate', label: 'Show the songs as cards' }] : []}
        onAccessibilityAction={onAction}
      >
        <Animated.View style={[styles.face, frontStyle]} pointerEvents={turned ? 'none' : 'auto'}>
          <View style={styles.clip}>{front}</View>
        </Animated.View>
        {built ? (
          <Animated.View style={[styles.face, backStyle]} pointerEvents={turned ? 'auto' : 'none'}>
            <View style={styles.clip}>
              <FlatList
                ref={list}
                data={songs as FlipSong[]}
                keyExtractor={item => item.id}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                initialScrollIndex={start < songs.length ? start : 0}
                getItemLayout={(_d, index) => ({ length: size, offset: size * index, index })}
                initialNumToRender={1}
                maxToRenderPerBatch={2}
                windowSize={3}
                onMomentumScrollEnd={onSettle}
                onScrollToIndexFailed={() => undefined}
                renderItem={({ item, index }) => (
                  <View style={{ width: size, height: size }}>
                    <Artwork uri={item.coverImageUri} title={item.title} artist={item.artist ?? undefined} size={size} style={StyleSheet.absoluteFill} />
                    <LinearGradient pointerEvents="none" colors={CARD_FADE} style={styles.fade} />
                    <View style={styles.count}><Text variant="caption" tabular style={styles.onCard}>{`${index + 1} / ${songs.length}`}</Text></View>
                    <View style={styles.caption}>
                      <Text variant="label" numberOfLines={1} style={styles.onCard}>{item.title}</Text>
                      {item.artist ? <Text variant="secondary" numberOfLines={1} tone="secondary">{item.artist}</Text> : null}
                      {playingHere && item.id === playingId ? <Text variant="caption" tone="secondary">Playing</Text> : null}
                    </View>
                  </View>
                )}
              />
            </View>
          </Animated.View>
        ) : null}
      </View>
    </GestureDetector>
  );
};

const styles = StyleSheet.create({
  face: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: Radius.cover,
    backgroundColor: Signal.bgSubtle,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
    elevation: 14,
  },
  clip: { ...StyleSheet.absoluteFillObject, borderRadius: Radius.cover, overflow: 'hidden' },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '45%' },
  count: { position: 'absolute', top: Space.xs, right: Space.xs, paddingHorizontal: Space.xs, paddingVertical: 2, borderRadius: Radius.pill, backgroundColor: Glass.scrim },
  caption: { position: 'absolute', left: Space.sm, right: Space.sm, bottom: Space.sm, gap: 2 },
  onCard: { color: Signal.ink },
});
