/**
 * The immersive header for a mix or a collection (1.48.0): the cover edge to edge, dissolving into solid black, with the
 * title over the black end of the fade. `ImmersiveHero` is the list's header and scrolls away with it (the picture
 * drifts at half speed, and stretches when you pull past the top); `ImmersiveTopBar` stays put: a back button, and a
 * black bar with the title that fades in once the hero is gone. Opacity and transform only.
 * Numbers and the fade are in `immersiveHero.ts`. Nothing here reads the cover's colours.
 */
import { LinearGradient } from 'expo-linear-gradient';
import React, { useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Space, Surface } from '../../constants/allegraTheme';
import { IconButton, Text } from '../../ui';
import Artwork from '../allegra/Artwork';
import { barFadeRange, fadeColors, fadeLocations, topScrimColors, topScrimLocations } from './heroFade';

/** A scroll position for the hero and the title bar, and the handler that feeds it (native driver). */
export function useHeroScroll() {
  const y = useRef(new Animated.Value(0)).current;
  const onScroll = useRef(Animated.event([{ nativeEvent: { contentOffset: { y } } }], { useNativeDriver: true })).current;
  return { y, onScroll };
}

interface HeroProps {
  uri?: string | null;
  title: string;
  /** One or two quiet lines under the title (artists, "48 songs · Made for you"). */
  lines: readonly string[];
  width: number;
  height: number;
  scrollY: Animated.Value;
  /** The controls (Play, Shuffle) on the black below the fade. */
  children?: React.ReactNode;
}

export const ImmersiveHero: React.FC<HeroProps> = ({ uri, title, lines, width, height, scrollY, children }) => {
  // Pulling down stretches the picture from the top; scrolling up moves it at half speed.
  const drift = scrollY.interpolate({ inputRange: [-height, 0, height], outputRange: [-height / 2, 0, height * 0.5], extrapolate: 'clamp' });
  const stretch = scrollY.interpolate({ inputRange: [-height, 0], outputRange: [2, 1], extrapolate: 'clamp' });
  return (
    <View style={styles.wrap}>
      <View style={{ width, height }}>
        <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateY: drift }] }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ scale: stretch }] }]}>
            <Artwork uri={uri} title={title} size={width} priority="high" style={{ width, height }} />
          </Animated.View>
        </Animated.View>
        <LinearGradient pointerEvents="none" colors={topScrimColors()} locations={topScrimLocations()} style={StyleSheet.absoluteFill} />
        <LinearGradient pointerEvents="none" colors={fadeColors()} locations={fadeLocations()} style={StyleSheet.absoluteFill} />
        <View style={styles.titleBlock}>
          <Text variant="detail" align="center" numberOfLines={3} accessibilityRole="header">{title}</Text>
          {lines.filter(Boolean).map(line => <Text key={line} variant="secondary" tone="secondary" align="center" numberOfLines={2}>{line}</Text>)}
        </View>
      </View>
      {children}
    </View>
  );
};

interface BarProps {
  title: string;
  height: number;
  scrollY: Animated.Value;
  topInset: number;
  onBack: () => void;
}

export const ImmersiveTopBar: React.FC<BarProps> = ({ title, height, scrollY, topInset, onBack }) => {
  const [from, to] = barFadeRange(height);
  const barOpacity = scrollY.interpolate({ inputRange: [from, to], outputRange: [0, 1], extrapolate: 'clamp' });
  return (
    <View pointerEvents="box-none" style={[styles.bar, { paddingTop: topInset, height: topInset + 56 }]}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.barBacking, { opacity: barOpacity }]} />
      <IconButton icon="arrow-back" label="Back" onPress={onBack} />
      <Animated.View pointerEvents="none" style={[styles.barTitle, { opacity: barOpacity }]}>
        <Text variant="body" numberOfLines={1} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{title}</Text>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { backgroundColor: Surface.immersive },
  titleBlock: { position: 'absolute', left: Space.md, right: Space.md, bottom: Space.sm, alignItems: 'center', gap: Space.xs },
  bar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: Space.sm, gap: Space.sm },
  barBacking: { backgroundColor: Surface.immersive },
  barTitle: { flex: 1 },
});
