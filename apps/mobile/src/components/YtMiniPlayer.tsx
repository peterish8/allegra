import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, Modal, PanResponder, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Animated, { runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import YoutubeIframe from 'react-native-youtube-iframe';
import { Ionicons } from '@expo/vector-icons';
import { Control, Motion, OnMedia, Surface, TypeScale } from '../constants/allegraTheme';
import { Tactile } from './allegra/motion';

const { width: SW, height: SH } = Dimensions.get('window');
const CARD_W_SMALL = 260;
const CARD_W_LARGE = SW - 32;
const CARD_H_SMALL = CARD_W_SMALL * (9 / 16);
const CARD_H_LARGE = CARD_W_LARGE * (9 / 16);
const INITIAL_X = SW - CARD_W_SMALL - 16;
const INITIAL_Y = SH * 0.35;
const EDGE = 16;
/** The card pops by this much when it changes size, so the jump between the two sizes reads as one move. */
const SIZE_POP = 0.94;

interface Props {
  videoId: string;
  songTitle: string;
  onClose: () => void;
  onOpen?: () => void;
  onDismiss?: () => void;
}

/**
 * The floating video card. It moves by transform only (a finger drag, a snap to the nearest edge, an entrance pop),
 * so no frame lays the card out again; the two sizes switch at once with a small scale pop. Reduce Motion drops the
 * springs and the pop: the card still appears, snaps and resizes, in place.
 */
export const YtMiniPlayer: React.FC<Props> = ({ videoId, songTitle, onClose, onOpen, onDismiss }) => {
  const reduce = useReducedMotion();
  const x = useSharedValue(INITIAL_X);
  const y = useSharedValue(INITIAL_Y);
  const grabX = useRef(INITIAL_X);
  const grabY = useRef(INITIAL_Y);
  const entry = useSharedValue(0); // 0 = hidden, 1 = visible
  const pop = useSharedValue(1);
  const [expanded, setExpanded] = useState(false);
  const [playing, setPlaying] = useState(true);
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  useEffect(() => {
    if (reduce) {
      entry.value = 1;
    } else {
      entry.value = withSpring(1, Motion.spring.sheet);
    }
    onOpen?.();
    return () => { onDismiss?.(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const firstSize = useRef(true);
  useEffect(() => {
    if (firstSize.current) { firstSize.current = false; return; }
    if (expanded) {
      if (reduce) {
        x.value = EDGE;
      } else {
        x.value = withSpring(EDGE, Motion.spring.sheet);
      }
    }
    if (reduce) return;
    pop.value = SIZE_POP;
    pop.value = withSpring(1, Motion.spring.tactile);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  const handleClose = () => {
    entry.value = withTiming(0, { duration: reduce ? 0 : Motion.duration.fast }, finished => {
      if (finished) runOnJS(onClose)();
    });
  };

  const panResponder = useMemo(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => !expandedRef.current,
      onPanResponderGrant: () => {
        grabX.current = x.value;
        grabY.current = y.value;
      },
      onPanResponderMove: (_e, g) => {
        x.value = grabX.current + g.dx;
        y.value = grabY.current + g.dy;
      },
      onPanResponderRelease: () => {
        const snapX = x.value < SW / 2 ? EDGE : SW - CARD_W_SMALL - EDGE;
        if (reduce) {
          x.value = snapX;
        } else {
          x.value = withSpring(snapX, Motion.spring.settle);
        }
      },
    }),
  // x and y are stable shared values; the live preference is the only input.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [reduce]);

  const card = useAnimatedStyle((): ViewStyle => ({
    opacity: entry.value,
    transform: [
      { translateX: x.value },
      { translateY: y.value },
      { scale: (reduce ? 1 : 0.72 + 0.28 * entry.value) * pop.value },
    ],
  }));

  return (
    <Modal transparent animationType="none" visible onRequestClose={handleClose} statusBarTranslucent>
      <Animated.View
        style={[styles.card, { width: expanded ? CARD_W_LARGE : CARD_W_SMALL }, card]}
        {...panResponder.panHandlers}
      >
        {/* Header */}
        <View style={styles.header}>
          <Ionicons name="logo-youtube" size={14} color={OnMedia.primary} />
          <Text style={styles.title} numberOfLines={1}>{songTitle}</Text>
          <Tactile onPress={() => setPlaying(p => !p)} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel={playing ? 'Pause video' : 'Play video'}>
            <Ionicons name={playing ? 'pause' : 'play'} size={16} color={OnMedia.muted} />
          </Tactile>
          <Tactile onPress={() => setExpanded(e => !e)} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel={expanded ? 'Make the video smaller' : 'Make the video bigger'} accessibilityState={{ expanded }}>
            <Ionicons name={expanded ? 'contract-outline' : 'expand-outline'} size={16} color={OnMedia.muted} />
          </Tactile>
          <Tactile onPress={handleClose} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel="Close the video">
            <Ionicons name="close" size={18} color={OnMedia.muted} />
          </Tactile>
        </View>

        {/* Player */}
        <View style={[styles.playerBox, { height: expanded ? CARD_H_LARGE : CARD_H_SMALL }]}>
          <YoutubeIframe
            videoId={videoId}
            height={expanded ? CARD_H_LARGE : CARD_H_SMALL}
            width={expanded ? CARD_W_LARGE : CARD_W_SMALL}
            play={playing}
            onChangeState={(state) => {
              if (state === 'playing') setPlaying(true);
              if (state === 'paused' || state === 'ended') setPlaying(false);
            }}
            webViewProps={{
              allowsInlineMediaPlayback: true,
              mediaPlaybackRequiresUserAction: false,
            }}
          />
        </View>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    left: 0,
    top: 0,
    borderRadius: 14,
    backgroundColor: Surface.deep,
    overflow: 'hidden',
    elevation: 14,
    shadowColor: Surface.scrim,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.55,
    shadowRadius: 12,
  },
  header: {
    height: Control.target,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 10,
    backgroundColor: Surface.raised,
  },
  title: {
    flex: 1,
    marginLeft: 6,
    fontSize: TypeScale.caption,
    color: OnMedia.secondary,
    fontWeight: '600',
  },
  headerBtn: {
    width: Control.target,
    height: Control.target,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playerBox: {
    backgroundColor: Surface.scrim,
    overflow: 'hidden',
  },
});
