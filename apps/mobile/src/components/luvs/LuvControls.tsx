/**
 * The pieces around the Luvs taste map: the action buttons (they press like
 * every other button; turning one on gives it one small pop), the ring on a
 * Luv, the equaliser on the playing card and the scrubber for the clip.
 * Transforms and opacity only.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Glass, Motion, Signal } from '../../constants/allegraTheme';
import { luvsBufferManager } from '../../services/LuvsBufferManager';
import { Tactile } from '../allegra/motion';
import TimelineScrubber from '../TimelineScrubber';
import { equaliserMotionMode } from './luvsMotion';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

// ─── The Luv landing ─────────────────────────────────────────────────────────
/**
 * A single soft ring that opens from the button and fades. It replaces the ring of small hearts that
 * burst outwards, which read as confetti: a Luv is a quiet confirmation, not a celebration.
 */
const PulseRing: React.FC<{ trigger: number; color: string }> = ({ trigger, color }) => {
  const reduce = useReducedMotion();
  const progress = useSharedValue(1);
  useEffect(() => {
    if (reduce) {
      cancelAnimation(progress);
      progress.value = 1;
      return;
    }
    if (trigger === 0) {
      cancelAnimation(progress);
      progress.value = 1;
      return;
    }
    progress.value = 0;
    progress.value = withTiming(1, { duration: Motion.duration.luvsPulse, easing: Motion.ease.decelerate });
  }, [trigger, reduce, progress]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.5 * (1 - progress.value),
    transform: [{ scale: 1 + 0.5 * progress.value }] as const,
  }));
  return <Animated.View style={[styles.ring, { borderColor: color }, style]} pointerEvents="none" />;
};

/**
 * The double-tap Luv: one white heart where the finger landed, pressed in on a firm spring, held for a
 * moment and lifted away as it fades. A soft shadow keeps it readable over any cover. No confetti.
 * `trigger` counts the taps; `x` and `y` are where, in the card's own coordinates. Transforms and opacity only.
 */
const HEART = 92;
export const DoubleTapHeart: React.FC<{ trigger: number; x: number; y: number }> = ({ trigger, x, y }) => {
  const reduce = useReducedMotion();
  const pop = useSharedValue(0);
  const lift = useSharedValue(0);
  const fade = useSharedValue(0);
  useEffect(() => {
    if (trigger === 0) return;
    cancelAnimation(pop); cancelAnimation(lift); cancelAnimation(fade);
    pop.value = reduce ? 1 : 0;
    lift.value = 0;
    fade.value = 0;
    if (!reduce) pop.value = withSpring(1, Motion.spring.luvsHeartPop);
    fade.value = withSequence(
      withTiming(1, { duration: reduce ? 0 : Motion.duration.luvsHeartIn }),
      withDelay(Motion.duration.luvsHeartHold, withTiming(0, { duration: reduce ? 0 : Motion.duration.luvsHeartOut, easing: Motion.ease.decelerate })),
    );
    if (!reduce) lift.value = withDelay(Motion.duration.luvsHeartHold, withTiming(1, { duration: Motion.duration.luvsHeartOut, easing: Motion.ease.decelerate }));
  }, [trigger, reduce, pop, lift, fade]);
  const style = useAnimatedStyle(() => ({
    opacity: fade.value,
    transform: [
      { translateY: -26 * lift.value },
      { rotate: `${-9 * (1 - pop.value)}deg` },
      { scale: (0.5 + 0.55 * pop.value) * (1 - 0.06 * lift.value) },
    ] as const,
  }));
  if (trigger === 0) return null;
  return (
    <Animated.View style={[styles.doubleHeart, { left: x - HEART / 2, top: y - HEART / 2 }, style]} pointerEvents="none">
      <Ionicons name="heart" size={HEART} color="#ffffff" style={styles.doubleHeartGlyph} />
    </Animated.View>
  );
};

/** An icon that turns steadily while `spinning`, and settles back upright when it stops. */
export const SpinningIcon: React.FC<{ name: IconName; size: number; color: string; spinning: boolean }> = ({ name, size, color, spinning }) => {
  const reduce = useReducedMotion();
  const turn = useSharedValue(0);
  useEffect(() => {
    cancelAnimation(turn);
    if (reduce) {
      turn.value = 0;
      return;
    }
    if (spinning) {
      turn.value = 0;
      turn.value = withRepeat(withTiming(1, { duration: Motion.duration.luvsRefreshTurn, easing: Motion.ease.linear }), -1, false);
    } else {
      turn.value = withTiming(0, { duration: Motion.duration.fast });
    }
  }, [spinning, reduce, turn]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value * 360}deg` }] as const }));
  return (
    <Animated.View style={style}>
      <Ionicons name={name} size={size} color={color} />
    </Animated.View>
  );
};

// ─── Action button ───────────────────────────────────────────────────────────
export const LuvAction: React.FC<{
  icon: IconName;
  label: string;
  onPress: () => void;
  /** Filled when the action is on (liked, saved). */
  on?: boolean;
  tint?: string;
  burst?: number;
  disabled?: boolean;
}> = ({ icon, label, onPress, on = false, tint = Signal.wave, burst = 0, disabled = false }) => {
  const reduce = useReducedMotion();
  const pop = useSharedValue(1);
  const glow = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    glow.value = withTiming(on ? 1 : 0, { duration: reduce ? 0 : Motion.duration.base });
  }, [on, reduce, glow]);
  // The press itself is Tactile's (sinks, comes back, even if the finger slides off). Only the moment the action
  // turns on — a Luv, a save — gets one small pop on the settle spring; every other press stays a press.
  useEffect(() => {
    if (reduce) return;
    if (burst === 0) return;
    pop.value = withSequence(withTiming(1.12, { duration: Motion.duration.fast, easing: Motion.ease.decelerate }), withSpring(1, Motion.spring.settle));
  }, [burst, reduce, pop]);
  const circle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  const fill = useAnimatedStyle(() => ({ opacity: glow.value }));
  return (
    <Tactile
      onPress={onPress}
      disabled={disabled}
      pressScale={0.9}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: on, disabled }}
      hitSlop={6}
      style={[styles.cell, disabled && styles.disabled]}
    >
      <Animated.View style={[styles.circle, circle]}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.fill, { backgroundColor: tint }, fill]} />
        {burst ? <PulseRing trigger={burst} color={tint} /> : null}
        <Ionicons name={icon} size={24} color={on && tint === Signal.wave ? Signal.waveInk : Signal.ink} />
      </Animated.View>
      <Text style={styles.label} numberOfLines={1}>{label}</Text>
    </Tactile>
  );
};

// ─── Equaliser ───────────────────────────────────────────────────────────────
const EQ_MAX = 15;
export const EqBars: React.FC<{ active: boolean }> = ({ active }) => {
  const reduce = useReducedMotion();
  const motionMode = equaliserMotionMode(active, reduce);
  const h1 = useSharedValue(3);
  const h2 = useSharedValue(3);
  const h3 = useSharedValue(3);
  useEffect(() => {
    [h1, h2, h3].forEach(cancelAnimation);
    if (reduce) {
      h1.value = 3;
      h2.value = 3;
      h3.value = 3;
    } else if (motionMode === 'loop') {
      h1.value = withRepeat(withSequence(withTiming(13, { duration: Motion.duration.luvsEqualiserBeat }), withTiming(3, { duration: Motion.duration.luvsEqualiserBeat })), -1, false);
      h2.value = withRepeat(withSequence(withTiming(7, { duration: Motion.duration.luvsEqualiserRise }), withTiming(15, { duration: Motion.duration.luvsEqualiserPeak }), withTiming(3, { duration: Motion.duration.luvsEqualiserReturn })), -1, false);
      h3.value = withRepeat(withSequence(withTiming(15, { duration: Motion.duration.luvsEqualiserAccent }), withTiming(3, { duration: Motion.duration.luvsEqualiserPeak })), -1, false);
    } else {
      [h1, h2, h3].forEach(h => { h.value = withTiming(3, { duration: Motion.duration.luvsEqualiserSettle }); });
    }
  }, [motionMode, reduce, h1, h2, h3]);
  const s1 = useAnimatedStyle(() => ({ transform: [{ scaleY: h1.value / EQ_MAX }] }));
  const s2 = useAnimatedStyle(() => ({ transform: [{ scaleY: h2.value / EQ_MAX }] }));
  const s3 = useAnimatedStyle(() => ({ transform: [{ scaleY: h3.value / EQ_MAX }] }));
  return (
    <View style={styles.eq}>
      <Animated.View style={[styles.eqBar, s1]} />
      <Animated.View style={[styles.eqBar, s2]} />
      <Animated.View style={[styles.eqBar, s3]} />
    </View>
  );
};

// ─── Scrubber ────────────────────────────────────────────────────────────────
/** The playing clip's position, from the Luvs audio pool (seconds). */
export const LuvScrubber: React.FC<{ onScrubbing?: (on: boolean) => void }> = ({ onScrubbing }) => {
  const position = useSharedValue(0);
  const duration = useSharedValue(0);
  useEffect(() => {
    luvsBufferManager.setStatusUpdateCallback(status => {
      if (status.isLoaded) {
        position.value = (status.positionMillis || 0) / 1000;
        duration.value = (status.durationMillis || 0) / 1000;
      }
    });
  }, [position, duration]);
  return (
    <View style={styles.scrubber}>
      <TimelineScrubber
        currentTime={position}
        duration={duration}
        onSeek={t => luvsBufferManager.seekTo(t * 1000)}
        onScrubStart={() => { onScrubbing?.(true); luvsBufferManager.pause(); }}
        onScrubEnd={() => { onScrubbing?.(false); luvsBufferManager.resume(); }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  cell: { alignItems: 'center', width: 72 },
  disabled: { opacity: 0.45 },
  circle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Glass.fillLight,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Glass.hairlineStrong,
  },
  fill: { borderRadius: 26 },
  label: { color: Signal.inkSoft, fontSize: 12, fontWeight: '600', marginTop: 6 },
  ring: { position: 'absolute', top: -1, left: -1, right: -1, bottom: -1, borderRadius: 27, borderWidth: 2 },
  doubleHeart: { position: 'absolute', width: HEART, height: HEART, alignItems: 'center', justifyContent: 'center' },
  doubleHeartGlyph: { textShadowColor: 'rgba(238, 107, 95, 0.55)', textShadowOffset: { width: 0, height: 4 }, textShadowRadius: 18 },
  eq: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: EQ_MAX },
  eqBar: { width: 3, height: EQ_MAX, borderRadius: 1.5, backgroundColor: Signal.wave, transformOrigin: 'bottom' },
  scrubber: { height: 46, justifyContent: 'center' },
});
