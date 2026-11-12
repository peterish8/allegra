/**
 * The playlist's cover, and the owner's extra (1.44.0): turn it over into a deck of the playlist's songs as cards.
 * Double tap, or drag across the cover: the cover turns under the finger and, when it lets go, springs to whichever
 * side the drag and its speed were heading for. Swipe the deck sideways and it follows the finger one to one (a rubber
 * band past the ends); lifting springs to the next card with the finger's speed, and that card plays. A double tap
 * turns it back. Every motion is interruptible: a new touch takes over from wherever the cover or the deck is.
 *
 * One shared value per motion (`flip`, `pos`), driven by the gesture on the UI thread and only released to a spring,
 * so nothing waits for JavaScript while a finger is down. Each face shows on its own half of the turn (no
 * backface-visibility, which Android draws unreliably). Under Reduce Motion the turn is a plain cross-fade and
 * releases are short fades; the finger still moves the deck. TalkBack: the card is one stop; its action turns it
 * over, and while turned swiping up or down steps through the songs.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type AccessibilityActionEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation, interpolate, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import Artwork from '../allegra/Artwork';
import { Glass, Motion, Radius, Signal, Space } from '../../constants/allegraTheme';
import { Text } from '../../ui/Text';
import * as Haptics from '../../utils/haptics';
import {
  deckFollow, deckSettle, deckStartIndex, deckVelocity, FLIP_MS, flipFromDrag, flipSettle, flipVelocity, swipeChangesSong,
} from './playlistPage';

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
/** A drag starts after this many px sideways, and gives way to the page's scroll after this many vertically. */
const PAN_ACTIVE_X = 10;
const PAN_FAIL_Y = 14;
/** Cards kept either side of the one in front: a fling travels one card, so two is always enough. */
const DECK_REACH = 2;
/** The turn settles critically damped and never overshoots past a half turn either way. */
const FLIP_SPRING = { ...Motion.spring.hero, overshootClamping: true } as const;
/** Plain copies, so the gesture worklets capture numbers and not the whole Motion table (it holds easing functions). */
const DECK_SPRING = { ...Motion.spring.settle } as const;
const FAST_MS = Motion.duration.fast;
const CARD_FADE = ['rgba(7, 8, 11, 0)', Glass.scrimHeavy] as const;

/** One card of the deck: placed by the deck's position, a touch smaller and dimmer the further from the front. */
const DeckCard: React.FC<{ song: FlipSong; index: number; count: number; size: number; pos: SharedValue<number>; playing: boolean }> = ({ song, index, count, size, pos, playing }) => {
  const style = useAnimatedStyle(() => {
    const away = Math.min(1, Math.abs(index - pos.value));
    return {
      opacity: 1 - 0.35 * away,
      transform: [{ translateX: (index - pos.value) * size }, { scale: 1 - 0.05 * away }] as const,
    };
  });
  return (
    <Animated.View style={[styles.card, { width: size, height: size }, style]}>
      <Artwork uri={song.coverImageUri} title={song.title} artist={song.artist ?? undefined} size={size} style={StyleSheet.absoluteFill} />
      <LinearGradient pointerEvents="none" colors={CARD_FADE} style={styles.fade} />
      <View style={styles.count}><Text variant="caption" tabular style={styles.onCard}>{`${index + 1} / ${count}`}</Text></View>
      <View style={styles.caption}>
        <Text variant="label" numberOfLines={1} style={styles.onCard}>{song.title}</Text>
        {song.artist ? <Text variant="secondary" numberOfLines={1} tone="secondary">{song.artist}</Text> : null}
        {playing ? <Text variant="caption" tone="secondary">Playing</Text> : null}
      </View>
    </Animated.View>
  );
};

export const CoverFlipCard: React.FC<Props> = ({ size, front, name, songs, playingId, playingHere, onPick }) => {
  const reduce = useReducedMotion();
  /** 0 = the cover, 1 = the cards. */
  const flip = useSharedValue(0);
  /** Which way the finger turned it (+1 / -1), so the cover turns away from the finger. */
  const dir = useSharedValue(1);
  /** The deck's position in cards (fractional while a finger or a spring moves it). */
  const pos = useSharedValue(0);
  /** Where the deck was when the finger came down. */
  const grab = useSharedValue(0);
  const [turned, setTurned] = useState(false);
  const turnedRef = useRef(false);
  // The deck is built the first time the card turns over, not with the page.
  const [built, setBuilt] = useState(false);
  const ids = songs.map(s => s.id);
  const [card, setCard] = useState(() => deckStartIndex(ids, playingId, playingHere));
  const count = songs.length;
  const canTurn = count > 0;

  /** Make the deck ready under the cover: open on the playing song, then it is there before the first half-turn ends. */
  const prepare = useCallback(() => {
    const at = deckStartIndex(songs.map(s => s.id), playingId, playingHere);
    setBuilt(true);
    setCard(at);
    pos.value = at;
  }, [songs, playingId, playingHere, pos]);

  /** A turn finished its decision (a drag released, a double tap): remember which side, tick. */
  const commitTurn = useCallback((next: boolean) => {
    if (turnedRef.current !== next) Haptics.toggle();
    turnedRef.current = next;
    setTurned(next);
  }, []);

  const turn = useCallback(() => {
    if (!canTurn && !turned) return;
    const next = !turned;
    if (next) prepare();
    commitTurn(next);
    cancelAnimation(flip);
    flip.value = reduce ? withTiming(next ? 1 : 0, { duration: FLIP_MS, easing: Motion.ease.standard }) : withSpring(next ? 1 : 0, FLIP_SPRING);
  }, [canTurn, turned, prepare, commitTurn, flip, reduce]);

  /** A card came to rest (or was chosen): remember it, and play it when it is not already the song playing. */
  const rest = useCallback((index: number) => {
    setCard(index);
    if (swipeChangesSong(songs[index]?.id, playingId, playingHere)) { Haptics.tap(); onPick(index); }
  }, [songs, playingId, playingHere, onPick]);

  const moveDeck = useCallback((index: number, velocity = 0) => {
    cancelAnimation(pos);
    pos.value = reduce ? withTiming(index, { duration: FAST_MS }) : withSpring(index, { ...DECK_SPRING, velocity });
  }, [pos, reduce]);

  // While turned, the deck follows the playing song (a skip from the mini player, the song ending).
  useEffect(() => {
    if (!turned || !playingHere || !playingId) return;
    const at = songs.findIndex(s => s.id === playingId);
    if (at < 0 || at === card) return;
    setCard(at);
    moveDeck(at);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playingId, playingHere, turned]);

  const step = (by: number) => {
    const index = Math.min(count - 1, Math.max(0, card + by));
    if (index === card) return;
    moveDeck(index);
    rest(index);
  };

  const doubleTap = Gesture.Tap().numberOfTaps(2).maxDelay(DOUBLE_TAP_MS).onEnd((_e, success) => {
    if (success) runOnJS(turn)();
  });

  // Dragging across the cover turns it under the finger.
  const coverDrag = Gesture.Pan()
    .enabled(!turned && canTurn)
    .activeOffsetX([-PAN_ACTIVE_X, PAN_ACTIVE_X])
    .failOffsetY([-PAN_FAIL_Y, PAN_FAIL_Y])
    .onStart(e => {
      cancelAnimation(flip);
      dir.value = e.translationX < 0 ? -1 : 1;
      runOnJS(prepare)();
    })
    .onUpdate(e => {
      flip.value = flipFromDrag(e.translationX, size);
    })
    .onEnd(e => {
      const along = e.velocityX * dir.value;
      const next = flipSettle(flip.value, along, size);
      flip.value = reduce
        ? withTiming(next, { duration: FAST_MS })
        : withSpring(next, { ...FLIP_SPRING, velocity: flipVelocity(along, size) });
      runOnJS(commitTurn)(next === 1);
    });

  // Dragging the deck moves its cards under the finger; letting go springs to the next card with the finger's speed.
  const deckDrag = Gesture.Pan()
    .enabled(turned)
    .activeOffsetX([-PAN_ACTIVE_X, PAN_ACTIVE_X])
    .failOffsetY([-PAN_FAIL_Y, PAN_FAIL_Y])
    .onStart(() => {
      cancelAnimation(pos);
      grab.value = pos.value;
    })
    .onUpdate(e => {
      pos.value = deckFollow(grab.value - e.translationX / size, count);
    })
    .onEnd(e => {
      const index = deckSettle(pos.value, e.velocityX, size, count);
      pos.value = reduce
        ? withTiming(index, { duration: FAST_MS })
        : withSpring(index, { ...DECK_SPRING, velocity: deckVelocity(e.velocityX, size) });
      runOnJS(rest)(index);
    });

  // Under Reduce Motion the faces only cross-fade (no turn).
  const frontStyle = useAnimatedStyle(() => ({
    opacity: reduce ? 1 - flip.value : flip.value < 0.5 ? 1 : 0,
    transform: [{ perspective: 1200 }, { rotateY: `${reduce ? 0 : dir.value * interpolate(flip.value, [0, 1], [0, 180])}deg` }] as const,
  }));
  const backStyle = useAnimatedStyle(() => ({
    opacity: reduce ? flip.value : flip.value >= 0.5 ? 1 : 0,
    transform: [{ perspective: 1200 }, { rotateY: `${reduce ? 0 : dir.value * interpolate(flip.value, [0, 1], [-180, 0])}deg` }] as const,
  }));

  const song = songs[card];
  const onAction = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === 'activate') turn();
    else if (e.nativeEvent.actionName === 'increment') step(1);
    else if (e.nativeEvent.actionName === 'decrement') step(-1);
  };

  const from = Math.max(0, card - DECK_REACH);
  const to = Math.min(count - 1, card + DECK_REACH);
  const visible: number[] = [];
  for (let i = from; i <= to; i++) visible.push(i);

  return (
    <GestureDetector gesture={Gesture.Race(doubleTap, turned ? deckDrag : coverDrag)}>
      <View
        style={{ width: size, height: size }}
        accessible
        accessibilityRole={turned ? 'adjustable' : 'image'}
        accessibilityLabel={turned && song ? `${song.title}${song.artist ? ` by ${song.artist}` : ''}, card ${card + 1} of ${count}` : `${name} cover`}
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
              {visible.map(i => (
                <DeckCard key={songs[i].id} song={songs[i]} index={i} count={count} size={size} pos={pos} playing={playingHere && songs[i].id === playingId} />
              ))}
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
  card: { position: 'absolute', left: 0, top: 0 },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '45%' },
  count: { position: 'absolute', top: Space.xs, right: Space.xs, paddingHorizontal: Space.xs, paddingVertical: 2, borderRadius: Radius.pill, backgroundColor: Glass.scrim },
  caption: { position: 'absolute', left: Space.sm, right: Space.sm, bottom: Space.sm, gap: 2 },
  onCard: { color: Signal.ink },
});
