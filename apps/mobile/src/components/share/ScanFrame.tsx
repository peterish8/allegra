/**
 * The scanner's frame. While it looks, a thin light crosses it; the moment a code reads, the frame locks on (a small
 * settle from slightly larger, the ring brightens) and the light stops. Transform and opacity only, every time from
 * the Motion tokens; with Reduce Motion the light is still and the lock is a fade.
 */
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSpring, withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Glass, Motion, Radius } from '../../constants/allegraTheme';
import type { ScanPhase } from '../../services/share/scanFlow';

/** How much larger the frame is the instant before it locks. */
const LOCK_FROM = 1.06;
/** The light's height; it travels the frame's height minus this. */
const LIGHT_HEIGHT = 36;

export const ScanFrame: React.FC<{ phase: ScanPhase; width: number; height: number }> = ({ phase, width, height }) => {
  const reduce = useReducedMotion();
  const sweep = useSharedValue(0);
  const lock = useSharedValue(0);
  const looking = phase === 'scanning';

  useEffect(() => {
    cancelAnimation(sweep);
    if (looking && !reduce) {
      sweep.value = 0;
      sweep.value = withRepeat(withTiming(1, { duration: Motion.duration.scan, easing: Motion.ease.standard }), -1, true);
    } else {
      sweep.value = withTiming(0, { duration: Motion.duration.fast });
    }
  }, [looking, reduce, sweep]);

  useEffect(() => {
    const locked = phase !== 'scanning' && phase !== 'failed';
    lock.value = reduce
      ? withTiming(locked ? 1 : 0, { duration: Motion.duration.fast })
      : locked ? withSpring(1, Motion.spring.tactile) : withTiming(0, { duration: Motion.duration.base, easing: Motion.ease.decelerate });
  }, [phase, reduce, lock]);

  const frame = useAnimatedStyle(() => ({
    transform: [{ scale: reduce ? 1 : LOCK_FROM - (LOCK_FROM - 1) * lock.value }],
    opacity: 1 - 0.55 * lock.value,
  }));
  const ring = useAnimatedStyle(() => ({ opacity: lock.value }));
  const light = useAnimatedStyle(() => ({
    opacity: looking ? 0.9 * (1 - lock.value) : 0,
    transform: [{ translateY: sweep.value * (height - LIGHT_HEIGHT) }],
  }));

  return (
    <View style={{ width, height }} pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants">
      <Animated.View style={[styles.frame, { borderRadius: Radius.well }, frame]} />
      <Animated.View style={[styles.frame, styles.ring, { borderRadius: Radius.well }, ring]} />
      <View style={[StyleSheet.absoluteFill, { borderRadius: Radius.well, overflow: 'hidden' }]}>
        <Animated.View style={[styles.light, light]}>
          <LinearGradient colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.28)', 'rgba(255,255,255,0)']} style={StyleSheet.absoluteFill} />
        </Animated.View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  frame: { ...StyleSheet.absoluteFillObject, borderWidth: 2, borderColor: Glass.focusRing },
  ring: { borderWidth: 3 },
  light: { position: 'absolute', left: 0, right: 0, top: 0, height: LIGHT_HEIGHT },
});
