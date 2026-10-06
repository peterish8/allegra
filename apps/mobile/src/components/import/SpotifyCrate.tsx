/**
 * The transfer crate in the Spotify dock: the picked sources as a small fanned stack with a count,
 * and the covers that fly between a row and the crate. Transform and opacity only.
 */
import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeIn, FadeOut, Keyframe, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { SPOTIFY_LIKED_ID, type SpotifySourcePlaylist } from '@shared/spotify';
import { crateStack } from '@shared/importCrate';
import { Glass, Motion, Radius, Signal } from '../../constants/allegraTheme';
import { Artwork } from '../allegra/Artwork';

const SLEEVE = 44;

/** A source's cover, as the list row and the crate both draw it. */
export const SourceCover: React.FC<{ readonly playlist: SpotifySourcePlaylist; readonly size: number }> = ({ playlist, size }) => {
  const box = { width: size, height: size, borderRadius: Radius.thumb };
  if (playlist.kind === 'liked' || playlist.id === SPOTIFY_LIKED_ID) {
    return (
      <LinearGradient colors={[Signal.accentDeep, Signal.accent, Signal.vibeBlue]} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={[styles.liked, box]}>
        <Ionicons name="heart" size={Math.round(size * 0.42)} color={Signal.ink} />
      </LinearGradient>
    );
  }
  return <Artwork uri={playlist.imageUrl ?? null} title={playlist.name} size={size} style={box} />;
};

/** A finished source leaves the crate as if dealt off the top of the stack. */
const DEAL = new Keyframe({
  0: { opacity: 1, transform: [{ translateX: 0 }, { translateY: 0 }, { rotate: '0deg' }] },
  100: { opacity: 0, transform: [{ translateX: 36 }, { translateY: -22 }, { rotate: '12deg' }], easing: Motion.ease.accelerate },
}).duration(Motion.duration.deal);

const Sleeve: React.FC<{
  readonly playlist: SpotifySourcePlaylist;
  readonly layer: number;
  readonly depth: number;
  readonly lifted: boolean;
  readonly transferring: boolean;
}> = ({ playlist, layer, depth, lifted, transferring }) => {
  const reduce = useReducedMotion();
  const d = useSharedValue(depth);
  const up = useSharedValue(lifted ? 1 : 0);
  useEffect(() => { d.value = withTiming(depth, { duration: Motion.duration.base, easing: Motion.ease.decelerate }); }, [d, depth]);
  useEffect(() => { up.value = withTiming(lifted ? 1 : 0, { duration: Motion.duration.base, easing: Motion.ease.decelerate }); }, [up, lifted]);
  // Each sleeve under the top fans a little further left and back; the running one lifts and tilts.
  const fan = useAnimatedStyle(() => {
    if (reduce) return {};
    const rest = d.value * (1 - up.value);
    return { transform: [{ translateX: -7 * rest }, { translateY: -8 * up.value }, { rotate: `${-7 * rest - 5 * up.value}deg` }, { scale: 1 - 0.04 * rest }] as const };
  });
  return (
    <Animated.View
      style={[styles.sleeve, { zIndex: layer }]}
      // A picked sleeve appears as its flying cover lands.
      entering={reduce ? FadeIn.duration(Motion.duration.instant) : FadeIn.duration(Motion.duration.base).delay(transferring ? 0 : Motion.duration.flight)}
      exiting={transferring && !reduce ? DEAL : FadeOut.duration(Motion.duration.instant)}
    >
      <Animated.View style={fan}><SourceCover playlist={playlist} size={SLEEVE} /></Animated.View>
    </Animated.View>
  );
};

/** Decorative: the count is also in the list header, so screen readers skip the crate. */
export const SpotifyCrate: React.FC<{
  readonly sources: ReadonlyMap<string, SpotifySourcePlaylist>;
  /** Everything in the crate, bottom to top. */
  readonly ids: readonly string[];
  readonly liftId: string | null;
  readonly transferring: boolean;
  /** Where the top sleeve sits: the target of a cover flying in. */
  readonly slotRef: React.Ref<View>;
}> = ({ sources, ids, liftId, transferring, slotRef }) => {
  const stack = crateStack(ids);
  return (
    <View style={styles.crate} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none">
      {ids.length === 0 ? <View style={styles.empty} /> : null}
      <View ref={slotRef} collapsable={false} style={styles.slot} />
      {stack.map((id, index) => {
        const playlist = sources.get(id);
        const depth = stack.length - 1 - index;
        return playlist ? <Sleeve key={id} playlist={playlist} layer={index + 1} depth={depth} lifted={depth === 0 && liftId === id} transferring={transferring} /> : null;
      })}
      {ids.length > 0 ? <View style={styles.count}><Text style={styles.countText}>{ids.length}</Text></View> : null}
    </View>
  );
};

/** A box in the panel's own coordinates. */
export interface Box { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

/** One cover in the air between a row and the crate; removed when it lands. */
export const FlyingCover: React.FC<{
  readonly playlist: SpotifySourcePlaylist;
  readonly from: Box;
  readonly to: Box;
  readonly flightKey: number;
  /** Stable across renders: a new identity would restart the flight. */
  readonly onLanded: (flightKey: number) => void;
}> = ({ playlist, from, to, flightKey, onLanded }) => {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withTiming(1, { duration: Motion.duration.flight, easing: Motion.ease.emphasis }, (finished) => { if (finished) runOnJS(onLanded)(flightKey); });
  }, [t, onLanded, flightKey]);
  // Moves centre to centre and scales about the centre, so the cover lands exactly on the target.
  const dx = to.x + to.width / 2 - (from.x + from.width / 2);
  const dy = to.y + to.height / 2 - (from.y + from.height / 2);
  const ratio = to.width / from.width;
  const style = useAnimatedStyle(() => ({
    opacity: 1 - 0.15 * t.value,
    transform: [{ translateX: dx * t.value }, { translateY: dy * t.value }, { scale: 1 + (ratio - 1) * t.value }] as const,
  }));
  return (
    <Animated.View pointerEvents="none" style={[styles.flight, { left: from.x, top: from.y, width: from.width, height: from.height }, style]}>
      <SourceCover playlist={playlist} size={from.width} />
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  crate: { width: 64, height: 56 },
  empty: { position: 'absolute', top: 6, bottom: 6, left: 14, right: 4, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Glass.hairlineStrong },
  slot: { position: 'absolute', top: 6, right: 4, width: SLEEVE, height: SLEEVE },
  sleeve: { position: 'absolute', top: 6, right: 4, width: SLEEVE, height: SLEEVE },
  liked: { alignItems: 'center', justifyContent: 'center' },
  count: { position: 'absolute', top: 0, right: 0, zIndex: 10, minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: Signal.wave },
  countText: { color: Signal.waveInk, fontSize: 11, fontWeight: '800', fontVariant: ['tabular-nums'] },
  flight: { position: 'absolute', zIndex: 50 },
});
