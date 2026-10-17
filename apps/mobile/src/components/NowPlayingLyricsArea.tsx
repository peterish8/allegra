import React from 'react';
import { Dimensions, InteractionManager, Pressable, Text, View, StyleSheet, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Artwork from './allegra/Artwork';
import { COVER_GLOW_BASE } from './allegra/edgeGlowMath';
import { isCardPlayerBackground, lyricsTextStyle, useSettingsStore } from '../store/settingsStore';
import { washAt, youtubeWash } from './allegra/palette';
import { isCoverFull } from './player/coverStage';
import { usePlayerStore } from '../store/playerStore';
import Animated, { EntryAnimationsValues, ExitAnimationsValues, SharedValue, useAnimatedStyle, useReducedMotion, withTiming } from 'react-native-reanimated';
import { Motion } from '../constants/allegraTheme';
import { DOCK_THUMB, LYRICS_MORPH_MS } from './player/lyricsMorph';
import { useArtworkPalette } from './allegra/useArtworkPalette';
import SynchronizedLyrics, { SynchronizedLyricsRef } from './SynchronizedLyrics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ErrorBoundary from './ErrorBoundary';
import { useIsFocused } from '@react-navigation/native';
import { useAppActive } from '../hooks/useAppActive';

type ProcessedLyric = { timestamp: number; text: string };

export const HEADER_CLEARANCE = 28;
/** The compact controls (no volume row) stacked at the bottom. */
export const CONTROLS_CLEARANCE = 372;

/** Height the controls take from the title down (full layout, with volume), plus a clear gap above the title. */
const CONTROLS_ROOM = 360;

export { LYRICS_MORPH_MS };
/**
 * How long after the player opens the (hidden) lyrics list is mounted, so
 * opening lyrics has no mount to wait on. Also waits for interactions to
 * finish, so the mount never lands on the sheet's own opening frames.
 */
const LYRICS_PREMOUNT_MS = 900;
/**
 * Whether the lines are mounted (hidden) before they are asked for. Hidden lyrics are inert (`live` off: no
 * clock, scrolling, glide, sweep or waveform), so this only costs the mount itself. It is a switch so a build
 * can run without it when judging whether the pre-mount matters.
 */
const PREMOUNT_HIDDEN_LYRICS = true;

const clamp01 = (v: number) => {
  'worklet';
  return Math.min(1, Math.max(0, v));
};
// Tap the cover: the card grows into the full-bleed cover, or the full cover
// draws back into a card.
const growIn = (_v: EntryAnimationsValues) => {
  'worklet';
  const t = { duration: 340, easing: Motion.ease.decelerate };
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.9 }] as const },
    animations: { opacity: withTiming(1, t), transform: [{ scale: withTiming(1, t) }] as const },
  };
};
const shrinkIn = (_v: EntryAnimationsValues) => {
  'worklet';
  const t = { duration: 340, easing: Motion.ease.decelerate };
  return {
    initialValues: { opacity: 0, transform: [{ scale: 1.12 }] as const },
    animations: { opacity: withTiming(1, t), transform: [{ scale: withTiming(1, t) }] as const },
  };
};
const fadeAway = (_v: ExitAnimationsValues) => {
  'worklet';
  const t = { duration: 220, easing: Motion.ease.accelerate };
  return { initialValues: { opacity: 1 }, animations: { opacity: withTiming(0, t) } };
};

/** The full-bleed cover's height: YouTube Music's, a little taller than wide, never past 62% of the screen. */
export const fullCoverHeight = (width: number, height: number): number => Math.round(Math.min(width * 1.15, height * 0.62));

/**
 * The full cover for the card styles: edge to edge from the top of the
 * screen, melting into whatever is behind it at its lower edge — YouTube
 * Music's wash, or the Cover glow's black (`onBlack`).
 */
const FullCover: React.FC<{
  width: number;
  screenH: number;
  uri?: string;
  title: string;
  artist?: string;
  primary: string;
  onBlack?: boolean;
  stageX?: SharedValue<number>;
  lyricsP?: SharedValue<number>;
}> = ({ width, screenH, uri, title, artist, primary, onBlack = false, stageX, lyricsP }) => {
  const reduce = useReducedMotion();
  const h = fullCoverHeight(width, screenH);
  // The backdrop's own colour where the cover ends, so there is no seam.
  const meet = onBlack ? COVER_GLOW_BASE : washAt(youtubeWash(primary), h / Math.max(1, screenH));
  // Lyrics opening: the full cover lifts a little and melts away under them.
  const follow = useAnimatedStyle(() => {
    const x = stageX ? stageX.value : 0;
    const p = lyricsP ? lyricsP.value : 0;
    return {
      opacity: (1 - 0.55 * Math.min(1, Math.abs(x) / Math.max(1, width))) * (1 - p),
      transform: [{ translateX: x }, { translateY: -h * 0.06 * p }, { scale: 1 + 0.04 * p }] as const,
    };
  });
  return (
    <Animated.View style={[styles.fullCover, { height: h }, follow]} entering={reduce ? undefined : growIn} exiting={reduce ? undefined : fadeAway} pointerEvents="none">
      <Artwork uri={uri} title={title} artist={artist} size={Math.max(width, h)} priority="high" continuous quiet style={{ width, height: h }} />
      <LinearGradient colors={['rgba(0,0,0,0.32)', 'rgba(0,0,0,0)']} style={[styles.fullShade, { height: Math.round(h * 0.22) }]} />
      <LinearGradient colors={[`${meet}00`, `${meet}cc`, meet]} locations={[0, 0.6, 1]} style={[styles.fullMelt, { height: Math.round(h * 0.42) }]} />
    </Animated.View>
  );
};

interface NowPlayingLyricsAreaProps {
  showLyrics: boolean;
  processedLyrics: ProcessedLyric[];
  duration?: number;
  currentTime: SharedValue<number>;
  onLyricPress: (timestamp: number) => void;
  songTitle?: string;
  isUserScrollingRef: React.MutableRefObject<boolean>;
  scrollTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>;
  flatListRef: React.RefObject<SynchronizedLyricsRef>;
  coverImageUri?: string;
  songArtist?: string;
  scrollOffset?: SharedValue<number>;
  /** The cover follows a sideways swipe by this much. */
  stageX?: SharedValue<number>;
  /** Cover (0) .. lyrics (1), animated by the screen. */
  lyricsP?: SharedValue<number>;
  /** The title's thumbnail centre, where the cover flies to under lyrics. */
  dockX?: SharedValue<number>;
  dockY?: SharedValue<number>;
  /** Removes the cover morph and gives the synchronized list the full player. */
  fullscreen?: boolean;
}

/**
 * What the cover stage shows: the backdrop's own full-bleed hero (Apple
 * styles, nothing drawn here), a full cover of our own (card styles), or a
 * floating card.
 */
type StageMode = 'hero' | 'full' | 'card';

/**
 * The cover, following a sideways swipe.
 *
 * Lyrics opening: the card flies into the thumbnail at the start of the
 * title (dockX/dockY) and hands over to it; closing, it flies back out.
 */
const Stage: React.FC<{
  mode: StageMode;
  width: number;
  screenH: number;
  paddingTop: number;
  uri?: string;
  title: string;
  artist?: string;
  /** Cover glow: the full cover melts into black, not a wash. */
  onBlack: boolean;
  stageX?: SharedValue<number>;
  lyricsP?: SharedValue<number>;
  dockX?: SharedValue<number>;
  dockY?: SharedValue<number>;
}> = ({ mode, width, screenH, paddingTop, uri, title, artist, onBlack, stageX, lyricsP, dockX, dockY }) => {
  const reduce = useReducedMotion();
  const palette = useArtworkPalette(uri);
  // Short screens: the card also fits the height above the title, which used
  // to run over the card's bottom edge.
  const room = Math.max(160, screenH - paddingTop - CONTROLS_ROOM);
  const card = Math.min(width - 64, 380, room);

  // Swipe-follow, and the flight into the title's thumbnail.
  const centreX = width / 2;
  const centreY = paddingTop + card / 2;
  const endScale = DOCK_THUMB / card;
  const stageStyle = useAnimatedStyle(() => {
    const x = stageX ? stageX.value : 0;
    const away = Math.min(1, Math.abs(x) / Math.max(1, width));
    const p = lyricsP ? lyricsP.value : 0;
    const dx = dockX && dockX.value > 0 ? dockX.value - centreX : 0;
    const dy = dockY && dockY.value > 0 ? dockY.value - centreY : 0;
    return {
      opacity: (1 - 0.55 * away) * (1 - clamp01((p - 0.82) / 0.18)),
      transform: [
        { translateX: x + dx * p },
        { translateY: dy * p },
        { scale: (1 - 0.05 * away) * (1 + (endScale - 1) * p) },
      ] as const,
    };
  });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {mode === 'full' ? (
        <FullCover key="full" width={width} screenH={screenH} uri={uri} title={title} artist={artist} primary={palette.primary} onBlack={onBlack} stageX={stageX} lyricsP={lyricsP} />
      ) : null}
      <View style={[styles.cardArea, { paddingTop }]}>
        <Animated.View style={[{ width: card, height: card, alignItems: 'center', justifyContent: 'center' }, stageStyle]}>
          {mode === 'card' ? (
            <Animated.View key="card" entering={reduce ? undefined : shrinkIn} exiting={reduce ? undefined : fadeAway} style={styles.stageLayer}>
              <Artwork uri={uri} title={title} artist={artist} size={card} priority="high" continuous quiet style={[styles.card, { width: card, height: card }]} />
            </Animated.View>
          ) : null}
        </Animated.View>
      </View>
    </View>
  );
};

const NowPlayingLyricsArea: React.FC<NowPlayingLyricsAreaProps> = ({
  showLyrics,
  processedLyrics,
  duration,
  currentTime,
  onLyricPress,
  songTitle,
  isUserScrollingRef,
  scrollTimeoutRef,
  flatListRef,
  coverImageUri,
  songArtist,
  scrollOffset,
  stageX,
  lyricsP,
  dockX,
  dockY,
  fullscreen = false,
}) => {
  const routeFocused = useIsFocused();
  const appActive = useAppActive();
  const lyricsLive = showLyrics && routeFocused && appActive;
  // Settings → Lyrics (text size, line spacing) and the song's own alignment (lyrics editor).
  const fontSize = useSettingsStore(st => st.lyricsSize);
  const lineSpacing = useSettingsStore(st => st.lineSpacing);
  // Settings → Lyrics → Alignment, unless the song was set to centre or right
  // in the lyrics editor (songs are stored as 'left' by default).
  const globalAlign = useSettingsStore(st => st.lyricsAlign);
  const songAlign = usePlayerStore(st => st.currentSong?.lyricsAlign);
  const align = songAlign && songAlign !== 'left' ? songAlign : globalAlign;
  const textStyle = React.useMemo(() => lyricsTextStyle(fontSize, lineSpacing, align), [fontSize, lineSpacing, align]);
  const insets = useSafeAreaInsets();
  const { width, height: windowH } = useWindowDimensions();
  const screenH = Math.max(windowH, Dimensions.get('screen').height);
  // Tapping the cover flips it between full-bleed and a card (coverStage.isCoverFull).
  const full = useSettingsStore(s => isCoverFull(s.playerBackground, s.appleMusicInspired, s.playerCoverFull));
  const cardStyle = useSettingsStore(s => isCardPlayerBackground(s.playerBackground));
  const onBlack = useSettingsStore(s => s.playerBackground === 'aura');
  // Apple styles, full: the backdrop draws the cover full-bleed, so there is
  // nothing to draw here. The card styles draw their own full cover over the
  // wash. Otherwise a floating card. The stage stays mounted under the
  // lyrics: it has flown into the title's thumbnail.
  const mode: StageMode = !full ? 'card' : cardStyle ? 'full' : 'hero';

  // The lines are mounted (hidden) shortly after the player opens and then
  // stay: mounting the list is the slow part, and done on the tap it lands
  // after the cover has already flown, so the lines pop in with no fade.
  const [lyricsMounted, setLyricsMounted] = React.useState(showLyrics);
  const hasLines = processedLyrics.length > 0;
  React.useEffect(() => {
    if (showLyrics) {
      setLyricsMounted(true);
      return undefined;
    }
    // Keep the premount benefit for the visible player, but don't build the
    // hidden list while this route or the app is out of view.
    if (!routeFocused || !appActive) return undefined;
    // A song with no lyric lines has nothing to open onto: no hidden list for it.
    if (!PREMOUNT_HIDDEN_LYRICS || !hasLines) return undefined;
    let task: { cancel: () => void } | null = null;
    const t = setTimeout(() => {
      task = InteractionManager.runAfterInteractions(() => setLyricsMounted(true));
    }, LYRICS_PREMOUNT_MS);
    return () => { clearTimeout(t); task?.cancel(); };
  }, [showLyrics, hasLines, routeFocused, appActive]);
  // Stable, so the memoised lyrics list doesn't re-render with every player render.
  const onScrollStateChange = React.useCallback((isScrolling: boolean) => {
    isUserScrollingRef.current = isScrolling;
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    if (!isScrolling) {
      scrollTimeoutRef.current = setTimeout(() => {
        isUserScrollingRef.current = false;
      }, 4000);
    }
  }, [isUserScrollingRef, scrollTimeoutRef]);
  const lyricsFallback = React.useCallback((retry: () => void) => (
    <Pressable onPress={retry} style={styles.fallback} accessibilityRole="button">
      <Text style={styles.fallbackTitle}>These lyrics couldn't be drawn</Text>
      <Text style={styles.fallbackHint}>The song keeps playing. Tap to try again.</Text>
    </Pressable>
  ), []);
  // The lines rise in once the cover is on its way, and sink out first on the way back.
  const linesStyle = useAnimatedStyle(() => {
    if (fullscreen) return { opacity: 1, transform: [{ translateY: 0 }] };
    const p = lyricsP ? lyricsP.value : showLyrics ? 1 : 0;
    const t = clamp01((p - 0.3) / 0.7);
    return { opacity: t, transform: [{ translateY: 28 * (1 - t) }] };
  });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {!fullscreen ? (
        <Stage
          mode={mode}
          width={width}
          screenH={screenH}
          paddingTop={insets.top + HEADER_CLEARANCE + 24}
          uri={coverImageUri}
          title={songTitle ?? ''}
          artist={songArtist}
          onBlack={onBlack}
          stageX={stageX}
          lyricsP={lyricsP}
          dockX={dockX}
          dockY={dockY}
        />
      ) : null}
      {lyricsMounted ? (
        // Apple Music's lyrics view: the lines own the space between the header
        // and the controls, and the sung line's centre rides at 35% of that
        // space — not in the middle of a list whose lower half sits under the controls.
        <Animated.View
          style={[
            styles.lyricsFrame,
            fullscreen
              ? { paddingTop: insets.top + 92, marginBottom: Math.max(insets.bottom, 16) + 12 }
              : { paddingTop: insets.top + HEADER_CLEARANCE },
            linesStyle,
          ]}
          pointerEvents={showLyrics ? 'auto' : 'none'}
        >
      <ErrorBoundary name="lyrics" resetKey={processedLyrics} fallback={lyricsFallback}>
      <SynchronizedLyrics
        ref={flatListRef}
        textStyle={textStyle}
        lyrics={processedLyrics || []}
        duration={duration}
        currentTime={currentTime}
        onLyricPress={onLyricPress}
        songTitle={songTitle}
        activeLinePosition={fullscreen ? 0.42 : 0.35}
        topSpacerHeight={24}
        edgeFade={fullscreen ? 80 : 56}
        live={lyricsLive}
        scrollOffset={scrollOffset}
        isUserScrolling={isUserScrollingRef.current}
        onScrollStateChange={onScrollStateChange}
      />
      </ErrorBoundary>
        </Animated.View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  cardArea: { alignItems: 'center' },
  stageLayer: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: 14, overflow: 'hidden' },
  fullCover: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden' },
  fullShade: { position: 'absolute', top: 0, left: 0, right: 0 },
  fullMelt: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  fallback: { flex: 1, justifyContent: 'center', paddingHorizontal: 28, gap: 6 },
  fallbackTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: '700' },
  fallbackHint: { color: 'rgba(255,255,255,0.62)', fontSize: 15 },
  lyricsFrame: {
    flex: 1,
    // The controls (meta, scrubber, transport) float over the bottom.
    marginBottom: CONTROLS_CLEARANCE,
  },
});

export default React.memo(NowPlayingLyricsArea);
