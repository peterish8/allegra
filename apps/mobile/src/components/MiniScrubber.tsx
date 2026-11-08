/**
 * The mini player's progress line, scrubbed like Apple Music's (1.41.0): a rounded line that thickens under the
 * finger, follows it on the UI thread with no React render per frame, and shows no thumb and no time readout. The row
 * under it dims while scrubbing (`active`). A tap jumps; a drag seeks on release.
 *
 * Transform and opacity only: the line thickens by scaleY, and the fill is a full-width bar slid in by translateX inside
 * the rounded, clipped track, so its corners never squash.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';
import { Glass, Motion, Radius, Signal } from '../constants/allegraTheme';
import { scrubFraction, SCRUB_REST_SCALE } from '../playback/miniScrub';
import * as Haptics from '../utils/haptics';

/** The line's full (scrubbing) thickness; at rest it is SCRUB_REST_SCALE of this. */
export const SCRUB_LINE = 6;
/** Extra grab room above the band: the line is flush with the shell's top edge. */
const SCRUB_HIT_SLOP = { top: 10 } as const;

export interface MiniScrubberProps {
  positionSV: SharedValue<number>;
  durationSV: SharedValue<number>;
  enabled: boolean;
  /** Seconds to seek to, once the finger lifts (or on a tap). Resolves when the seek is done. */
  onCommit: (fraction: number) => Promise<void>;
  /** 0..1 while scrubbing, for the row under it to dim. */
  active: SharedValue<number>;
  height: number;
  accessibility: React.ComponentProps<typeof View>;
}

export const MiniScrubber: React.FC<MiniScrubberProps> = ({ positionSV, durationSV, enabled, onCommit, active, height, accessibility }) => {
  const width = useSharedValue(1);
  /** The finger's place along the line, -1 when nothing holds it. */
  const held = useSharedValue(-1);

  const finish = async (fraction: number) => {
    try { await onCommit(fraction); } finally { held.value = -1; }
  };
  const tick = () => Haptics.tap();

  // The line sits on the very top edge (1.41.3), so the finger can also land a little above it.
  const pan = Gesture.Pan().enabled(enabled).hitSlop(SCRUB_HIT_SLOP).activeOffsetX([-3, 3]).failOffsetY([-24, 24])
    .onBegin(e => {
      held.value = scrubFraction(e.x, width.value);
      active.value = withSpring(1, Motion.spring.tactile);
    })
    .onStart(() => { runOnJS(tick)(); })
    .onUpdate(e => { held.value = scrubFraction(e.x, width.value); })
    .onEnd(e => { runOnJS(finish)(scrubFraction(e.x, width.value)); })
    .onFinalize((_e, success) => {
      active.value = withSpring(0, Motion.spring.tactile);
      if (!success) held.value = -1;
    });
  const tap = Gesture.Tap().enabled(enabled).hitSlop(SCRUB_HIT_SLOP).maxDuration(250)
    .onEnd((e, success) => {
      if (!success) return;
      held.value = scrubFraction(e.x, width.value);
      runOnJS(finish)(scrubFraction(e.x, width.value));
    });

  const line = useAnimatedStyle(() => ({
    transform: [{ scaleY: SCRUB_REST_SCALE + (1 - SCRUB_REST_SCALE) * active.value }],
  }));
  const fill = useAnimatedStyle(() => {
    const f = held.value >= 0 ? held.value : durationSV.value > 0 ? Math.max(0, Math.min(1, positionSV.value / durationSV.value)) : 0;
    return { transform: [{ translateX: (f - 1) * width.value }] };
  });
  const brighten = useAnimatedStyle(() => ({ opacity: 0.85 + 0.15 * active.value }));

  return (
    <GestureDetector gesture={Gesture.Exclusive(pan, tap)}>
      <View style={[styles.band, { height }]} {...accessibility}>
        <Animated.View style={[styles.track, line]} onLayout={e => { width.value = Math.max(1, e.nativeEvent.layout.width); }}>
          <Animated.View style={[styles.fill, fill, brighten]} />
        </Animated.View>
      </View>
    </GestureDetector>
  );
};

const styles = StyleSheet.create({
  // 1.41.3 (owner): the line is flush with the top edge and runs edge to edge, with no gap above it; it thickens
  // downward (transformOrigin top). The band under it is the drag target.
  band: { justifyContent: 'flex-start', paddingHorizontal: 0, paddingTop: 0 },
  track: {
    // 1.44.0 (owner): no grey line of its own across the card; the unplayed part is a faint white over the glow.
    height: SCRUB_LINE, overflow: 'hidden', backgroundColor: Glass.selected,
    transformOrigin: 'top',
  },
  fill: { ...StyleSheet.absoluteFillObject, borderRadius: Radius.pill, backgroundColor: Signal.wave },
});
