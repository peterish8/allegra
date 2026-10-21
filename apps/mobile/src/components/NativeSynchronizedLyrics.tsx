import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Dimensions, Platform, StyleSheet, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { useReducedMotion, type SharedValue } from 'react-native-reanimated';
import { requireNativeView } from 'expo';
import { useSettingsStore } from '../store/settingsStore';
import { isLowEndDevice } from '../utils/performanceTier';
import { isPlainLyrics, nativeLyricsConfig, nativeLyricsPayload, type NativeLyricLine } from '../playback/nativeLyricsPayload';
import { LyricsResumePill } from './LyricsResumePill';

interface NativeLyricsViewProps {
  payload: string;
  config: string;
  seedMs: number;
  live: boolean;
  resumeSignal: number;
  onLyricPress: (event: { nativeEvent: { timestamp: number } }) => void;
  onScrollState: (event: { nativeEvent: { scrolling: boolean } }) => void;
  onAtTop: (event: { nativeEvent: { atTop: boolean } }) => void;
  onPill: (event: { nativeEvent: { direction: number } }) => void;
  style?: StyleProp<ViewStyle>;
}

const loadNativeView = (): React.ComponentType<NativeLyricsViewProps> | null => {
  if (Platform.OS !== 'android') return null;
  try {
    return requireNativeView<NativeLyricsViewProps>('NativeLyrics');
  } catch {
    return null;
  }
};

const NativeLyricsView = loadNativeView();

/** Whether this build can draw the lyrics natively; false on iOS and where the Kotlin module is missing. */
export const nativeLyricsAvailable = NativeLyricsView !== null;

/** Native lyrics are for timed lines; plain text keeps its own React Native scroller. */
export const canUseNativeLyrics = (lines: readonly NativeLyricLine[]): boolean =>
  NativeLyricsView !== null && lines.length > 0 && !isPlainLyrics(lines);

const DEFAULT_TEXT: TextStyle = { fontSize: 28, lineHeight: 34, textAlign: 'left' };
const DEFAULT_GAP = 16;
/** The list's `scrollOffset` is read as "not at the top" past this many dp (the player sheet's dismiss drag). */
const NOT_AT_TOP = 3;

interface NativeSynchronizedLyricsProps {
  /** The recording these lines were fetched for; native follows the player only while it is playing this one. */
  songId: string;
  lyrics: readonly NativeLyricLine[];
  /** A seed for the first frame when the native player is not up yet (seconds), read when the lines change. */
  currentTime?: SharedValue<number>;
  onLyricPress: (timestamp: number) => void;
  onScrollStateChange?: (isScrolling: boolean) => void;
  textStyle?: TextStyle;
  activeLinePosition?: number;
  songTitle?: string;
  topSpacerHeight?: number;
  bottomSpacerHeight?: number;
  edgeFade?: number;
  /** Mirrors "the lines sit at the top", so the player sheet knows when a drag down dismisses. */
  scrollOffset?: SharedValue<number>;
  live?: boolean;
}

/**
 * The same lyrics as `SynchronizedLyrics`, drawn by a Kotlin view that follows the Media3 clock. Everything it
 * needs to decide is decided here: the text style, the highlight mode, the lyrics delay and Reduce Motion are
 * handed to it, and a tap comes back through the caller's own playback flow.
 */
export const NativeSynchronizedLyrics: React.FC<NativeSynchronizedLyricsProps> = ({
  songId,
  lyrics,
  currentTime,
  onLyricPress,
  onScrollStateChange,
  textStyle: textStyleProp,
  activeLinePosition = 0.35,
  songTitle,
  topSpacerHeight = 24,
  bottomSpacerHeight = Dimensions.get('window').height * 0.4,
  edgeFade = 0,
  scrollOffset,
  live = true,
}) => {
  const lyricsDelay = useSettingsStore(s => s.lyricsDelay);
  const highlight = useSettingsStore(s => s.lyricsHighlight);
  const reduceMotion = useReducedMotion();
  const [pillDirection, setPillDirection] = useState(0);
  const [resumeSignal, setResumeSignal] = useState(0);
  const [seedMs, setSeedMs] = useState(0);

  const letters = highlight !== 'lines';
  const payload = useMemo(() => nativeLyricsPayload(songId, lyrics, lyricsDelay, letters), [songId, lyrics, lyricsDelay, letters]);
  const config = useMemo(() => {
    const flat = StyleSheet.flatten([DEFAULT_TEXT, textStyleProp]) ?? DEFAULT_TEXT;
    const gap = typeof flat.marginVertical === 'number' ? flat.marginVertical : typeof flat.margin === 'number' ? flat.margin : DEFAULT_GAP;
    const align = flat.textAlign === 'center' || flat.textAlign === 'right' ? flat.textAlign : 'left';
    return nativeLyricsConfig({
      fontSize: flat.fontSize ?? 28,
      lineHeight: flat.lineHeight,
      gap,
      align,
      activePos: activeLinePosition,
      topSpacer: topSpacerHeight,
      bottomSpacer: bottomSpacerHeight,
      edgeFade,
      title: songTitle,
      reduceMotion,
      lowEnd: isLowEndDevice(),
    });
  }, [textStyleProp, activeLinePosition, topSpacerHeight, bottomSpacerHeight, edgeFade, songTitle, reduceMotion]);

  // Not read during render (a shared value is for worklets): picked up once per set of lines.
  useEffect(() => {
    setSeedMs(currentTime ? Math.max(0, Math.round(currentTime.value * 1000)) : 0);
  }, [payload, currentTime]);

  // The lines are not at the top and a drag down must scroll them, so the sheet's dismiss gesture stands aside.
  const onAtTop = useCallback((event: { nativeEvent: { atTop: boolean } }) => {
    if (scrollOffset) scrollOffset.value = event.nativeEvent.atTop ? 0 : NOT_AT_TOP;
  }, [scrollOffset]);
  const onScrollState = useCallback((event: { nativeEvent: { scrolling: boolean } }) => {
    onScrollStateChange?.(event.nativeEvent.scrolling);
  }, [onScrollStateChange]);
  const onPress = useCallback((event: { nativeEvent: { timestamp: number } }) => {
    onLyricPress(event.nativeEvent.timestamp);
  }, [onLyricPress]);
  const onPill = useCallback((event: { nativeEvent: { direction: number } }) => {
    setPillDirection(event.nativeEvent.direction);
  }, []);
  const resume = useCallback(() => {
    setResumeSignal(n => n + 1);
    setPillDirection(0);
  }, []);

  if (!NativeLyricsView) return null;
  return (
    <View style={styles.container}>
      <NativeLyricsView
        style={styles.container}
        payload={payload}
        config={config}
        seedMs={seedMs}
        live={live}
        resumeSignal={resumeSignal}
        onLyricPress={onPress}
        onScrollState={onScrollState}
        onAtTop={onAtTop}
        onPill={onPill}
      />
      {pillDirection !== 0 ? (
        <LyricsResumePill
          icon={pillDirection > 0 ? 'arrow-down' : 'arrow-up'}
          label="Now playing"
          accessibilityLabel="Back to the playing line"
          onPress={resume}
          hitSlop={10}
        />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
  },
});
