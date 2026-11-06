/**
 * The application side of the Stream / Library header glow (ui/HeaderGlow): the playing cover's colours, the page's
 * scroll offset and the drift that runs only while the glow is seen.
 *
 *   const glow = useHeaderGlow();
 *   <HeaderGlow {...glow.props} />           behind the page
 *   onScroll={e => glow.onScroll(e.nativeEvent.contentOffset.y)}
 *
 * The drift rests (holding its current frame, not jumping) when the screen loses focus, the app leaves the
 * foreground, the header has scrolled away, or Reduce Motion, Reduce Transparency, Battery Saver or a low-end device
 * asks for less. Reduce Transparency also lightens the light itself.
 */
import { useIsFocused } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { Easing, cancelAnimation, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NEUTRAL_AURA, shadePalette } from '../components/allegra/palette';
import { useArtworkPalette } from '../components/allegra/useArtworkPalette';
import { Motion } from '../constants/allegraTheme';
import { usePlayerStore } from '../store/playerStore';
import type { HeaderGlowProps } from '../ui/HeaderGlow';
import { glowAnimates, glowFrame } from '../ui/headerGlowMath';
import { useBatterySaver } from '../utils/batterySaver';
import { useLowEndDevice } from '../utils/performanceTier';
import { useAppActive } from './useAppActive';
import { useReduceTransparency } from './useReduceTransparency';

const NEUTRAL_START = [NEUTRAL_AURA.secondary, NEUTRAL_AURA.primary, NEUTRAL_AURA.tertiary];

export const useHeaderGlow = ():{ props: HeaderGlowProps; onScroll: (y: number) => void } => {
  const cover = usePlayerStore(s => s.currentSong?.coverImageUri ?? s.currentSong?.coverRemoteUri);
  // Neutral until the cover's own colours are read, so a new song never flashes Allegra's default coral first.
  const palette = useArtworkPalette(cover, NEUTRAL_START);
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const frame = useMemo(() => glowFrame(height, insets.top), [height, insets.top]);

  const focused = useIsFocused();
  const appActive = useAppActive();
  const reduceMotion = useReducedMotion();
  const lowEnd = useLowEndDevice();
  const batterySaver = useBatterySaver();
  const reduceTransparency = useReduceTransparency();

  const scrollY = useSharedValue(0);
  const drift = useSharedValue(0);
  const [scrolledAway, setScrolledAway] = useState(false);
  const onScroll = useCallback((y: number) => {
    scrollY.value = y;
    const away = y >= frame.extent;
    setScrolledAway(prev => (prev === away ? prev : away));
  }, [frame.extent, scrollY]);

  const animate = glowAnimates({ focused, appActive, reduceMotion, lowEnd, batterySaver, reduceTransparency, scrolledAway });
  useEffect(() => {
    if (!animate) {
      cancelAnimation(drift);
      // Reduce Motion: the resting frame, not wherever the sway happened to stop.
      if (reduceMotion) drift.value = 0;
      return undefined;
    }
    // Continue from the current phase, so leaving and coming back never restarts it with a jump.
    const ease = Easing.inOut(Easing.sin);
    const remaining = Math.max(0.05, 1 - drift.value) * Motion.duration.drift;
    drift.value = withTiming(1, { duration: remaining, easing: ease }, finished => {
      if (finished) drift.value = withRepeat(withTiming(0, { duration: Motion.duration.drift, easing: ease }), -1, true);
    });
    return () => cancelAnimation(drift);
  }, [animate, drift, reduceMotion]);

  // A dark tint of the cover: the vivid swatch at full strength read as a coloured wash (olive on the emulator).
  const tint = shadePalette(palette, 0.72);
  const colors = cover ? { primary: tint.primary, secondary: tint.secondary } : null;
  return {
    props: { colors, frame, scrollY, drift, strength: reduceTransparency ? 0.6 : 1 },
    onScroll,
  };
};
