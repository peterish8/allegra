/**
 * The Library's hero: your recent songs as a coverflow of covers.
 *
 *   - The cover in the middle is the biggest and faces you; the ones either side
 *     are smaller, turned in towards it and overlapping. Each is the plain cover
 *     (rounded, a soft shadow, no glass plate) with the title and artist under it.
 *   - Drag to move along the row (it follows the finger, then settles on the
 *     nearest card with a spring). Tap the middle card to play it; tap a card
 *     beside it to bring it to the middle. With three cards or more the row
 *     loops: past the last card comes the first again, either way.
 *   - The row keeps its order and its place: playing a card leaves it in the
 *     middle (the list it comes from is kept in order by LibraryScreen).
 *   - Underneath, a plain row of controls: shuffle everything, step back or
 *     forward along the row, and play or pause the card in the middle.
 *
 * The position is a single shared value on the UI thread, so a drag never
 * waits on React. Transforms and opacity only.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Motion, Radius, Signal, Space } from '../../constants/allegraTheme';
import type { Song } from '../../types/song';
import { IconButton, Text as UIText } from '../../ui';
import * as Haptics from '../../utils/haptics';
import Artwork from '../allegra/Artwork';
import { flowOffset, focusFromDrag, loopDistance, loopFocusFromDrag, loops, loopSettleFocus, nearestPositionOf, settleFocus, tapSide, wrapIndex } from './flowMath';

const SETTLE = { stiffness: 220, damping: 26, mass: 1 } as const;
/** Cards within this distance of the centre are drawn; the rest wait out of sight. */
const REACH = 2.4;
const TILT_DEG = 26;
const PERSPECTIVE = 1300;
/** Room under each cover for its title and artist. */
const LABEL_HEIGHT = 52;

interface GlassDeckProps {
  songs: Song[];
  /** The middle card's width. */
  size: number;
  /** The song that is playing, if any. */
  currentId?: string | null;
  isPlaying: boolean;
  onPlay: (song: Song) => void;
  onTogglePlay: () => void;
  onShuffle: () => void;
  /** The card in the middle to start with (0 = the first). */
  initialIndex?: number;
}

const Plate: React.FC<{
  song: Song;
  index: number;
  count: number;
  size: number;
  height: number;
  step: number;
  position: SharedValue<number>;
  nowPlaying: boolean;
}> = React.memo(({ song, index, count, size, height, step, position, nowPlaying }) => {
  const style = useAnimatedStyle(() => {
    // Read round the circle when the row loops, so the first card follows the last.
    const d = loopDistance(index, position.value, count);
    const a = Math.abs(d);
    const turn = Math.max(-1, Math.min(1, d));
    return {
      zIndex: 100 - Math.round(a * 10),
      opacity: a > REACH ? 0 : interpolate(a, [0, 1, REACH], [1, 0.82, 0], Extrapolation.CLAMP),
      transform: [
        { perspective: PERSPECTIVE },
        { translateX: flowOffset(d, step) },
        // A card on the left turns its face towards the middle (its inner edge
        // recedes), and the other way round.
        { rotateY: `${-turn * TILT_DEG}deg` },
        { scale: interpolate(a, [0, 1, 2], [1, 0.8, 0.66], Extrapolation.CLAMP) },
      ] as const,
    };
  });
  // The cover is the card: full width, rounded, a soft shadow to lift it off the room. No glass plate behind it.
  return (
    <Animated.View style={[styles.plate, { width: size, height }, style]} pointerEvents="none">
      <View style={[styles.art, { width: size, height: size }]}>
        <View style={styles.artClip}>
          <Artwork uri={song.coverImageUri} title={song.title} artist={song.artist} size={size} priority="high" style={StyleSheet.absoluteFill} />
        </View>
        {nowPlaying ? (
          <View style={styles.playing}>
            <Ionicons name="volume-medium" size={14} color={Signal.waveInk} />
          </View>
        ) : null}
      </View>
      <View style={styles.label}>
        <UIText variant="row" align="center" numberOfLines={1}>{song.title}</UIText>
        {song.artist ? <UIText variant="secondary" tone="muted" align="center" numberOfLines={1}>{song.artist}</UIText> : null}
      </View>
    </Animated.View>
  );
});

export const GlassDeck: React.FC<GlassDeckProps> = ({ songs, size, currentId, isPlaying, onPlay, onTogglePlay, onShuffle, initialIndex = 0 }) => {
  const n = songs.length;
  const loop = loops(n);
  const reduce = useReducedMotion();
  const first = Math.min(Math.max(0, initialIndex), Math.max(0, n - 1));
  // Any number when the row loops (each lap adds n); the card in the middle is wrapIndex(position, n).
  const position = useSharedValue(first);
  const start = useSharedValue(first);
  const [focus, setFocus] = useState(first);
  /** The cover plus the two lines under it. */
  const height = size + LABEL_HEIGHT;
  const step = Math.round(size * 0.66);
  const stageWidth = size + step * 2;

  // The songs changed (one was played, one arrived): the card in the middle stays in the middle, wherever it now is.
  const focusedId = React.useRef<string | undefined>(songs[first]?.id);
  const signature = songs.map(s => s.id).join('|');
  const firstRun = React.useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const at = songs.findIndex(s => s.id === focusedId.current);
    const index = at >= 0 ? at : Math.min(wrapIndex(position.value, Math.max(1, n)), Math.max(0, n - 1));
    position.value = nearestPositionOf(index, position.value, n);
    setFocus(index);
    focusedId.current = songs[index]?.id;
  // The ids are what matter; `songs` is read through them.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, position]);

  /** The row came to rest on `target` (a position: any lap when it loops). */
  const settled = useCallback((target: number) => {
    const index = loop ? wrapIndex(target, n) : Math.min(Math.max(0, target), n - 1);
    focusedId.current = songs[index]?.id;
    setFocus(f => {
      if (f !== index) Haptics.selectionAsync().catch(() => {});
      return index;
    });
  }, [loop, n, songs]);

  /** One card along (or back), from where the row is heading. */
  const moveBy = useCallback((delta: number) => {
    const from = Math.round(position.value);
    const target = loop ? from + delta : Math.min(Math.max(0, from + delta), n - 1);
    position.value = reduce ? withTiming(target, { duration: Motion.duration.fast }) : withSpring(target, SETTLE);
    settled(target);
  }, [loop, n, position, reduce, settled]);

  const centre = songs[Math.min(focus, n - 1)];
  const playFocused = useCallback(() => {
    if (!centre) return;
    if (centre.id === currentId) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      onTogglePlay();
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      onPlay(centre);
    }
  }, [centre, currentId, onPlay, onTogglePlay]);

  const onTap = useCallback((x: number) => {
    const side = tapSide(x, stageWidth, size);
    if (side === 0) playFocused();
    else moveBy(side);
  }, [stageWidth, size, playFocused, moveBy]);

  const pan = Gesture.Pan()
    .enabled(n > 1)
    .activeOffsetX([-10, 10])
    .failOffsetY([-14, 14])
    .onBegin(() => {
      start.value = position.value;
    })
    .onUpdate(e => {
      position.value = loop ? loopFocusFromDrag(start.value, e.translationX, step) : focusFromDrag(start.value, e.translationX, step, n);
    })
    .onEnd(e => {
      const target = loop ? loopSettleFocus(position.value, e.velocityX, step) : settleFocus(position.value, e.velocityX, step, n);
      position.value = withSpring(target, { ...SETTLE, velocity: -e.velocityX / step });
      runOnJS(settled)(target);
    });
  const tap = Gesture.Tap()
    .maxDistance(10)
    .onEnd((e, success) => {
      if (success) runOnJS(onTap)(e.x);
    });

  if (n === 0) return null;
  const playingHere = !!centre && centre.id === currentId && isPlaying;

  return (
    <View style={styles.wrap}>
      <GestureDetector gesture={Gesture.Exclusive(pan, tap)}>
        <View
          style={[styles.stage, { width: stageWidth, height: height + 12 }]}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={`Recent songs. ${centre?.title ?? ''}${centre?.artist ? ` by ${centre.artist}` : ''}. Swipe to browse, double tap to play`}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={e => moveBy(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
        >
          {songs.map((song, index) => (
            <Plate
              key={song.id}
              song={song}
              index={index}
              count={n}
              size={size}
              height={height}
              step={step}
              position={position}
              nowPlaying={song.id === currentId}
            />
          ))}
        </View>
      </GestureDetector>

      {/* The controls: shuffle, back, play / pause, forward. A plain row, no glass behind it. */}
      <View style={styles.controls}>
        <IconButton icon="shuffle" label="Shuffle everything" variant="plain" size="lg" onPress={onShuffle} />
        <IconButton icon="play-skip-back" label="Previous song in the row" variant="plain" size="lg" disabled={!loop && focus <= 0} onPress={() => moveBy(-1)} />
        <IconButton
          icon={playingHere ? 'pause' : 'play'}
          label={playingHere ? 'Pause' : `Play ${centre?.title ?? ''}`}
          variant="primary"
          size="lg"
          onPress={playFocused}
          style={styles.playButton}
        >
          <Ionicons name={playingHere ? 'pause' : 'play'} size={26} color={Signal.waveInk} style={playingHere ? undefined : styles.playNudge} />
        </IconButton>
        <IconButton icon="play-skip-forward" label="Next song in the row" variant="plain" size="lg" disabled={!loop && focus >= n - 1} onPress={() => moveBy(1)} />
        <View style={styles.countSlot} pointerEvents="none">
          <UIText variant="caption" tone="muted" tabular>{focus + 1}/{n}</UIText>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  stage: { alignItems: 'center', justifyContent: 'center' },
  plate: { position: 'absolute', alignItems: 'center' },
  // The shadow sits on the outer view; the clip inside rounds the cover (a clipping view can't cast it on Android).
  art: {
    borderRadius: Radius.well,
    backgroundColor: Signal.bgSubtle,
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  artClip: { ...StyleSheet.absoluteFillObject, borderRadius: Radius.well, overflow: 'hidden' },
  playing: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Signal.wave,
  },
  label: { alignSelf: 'stretch', paddingHorizontal: Space.xs, paddingTop: Space.sm, gap: 2 },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.md,
    marginTop: Space.md,
  },
  playButton: { width: 56, height: 56, borderRadius: 28 },
  playNudge: { marginLeft: 3 },
  countSlot: { width: 44, alignItems: 'center' },
});

export default GlassDeck;
