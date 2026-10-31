/**
 * Now Playing's song scrubber drawn by a Kotlin view (android/.../views/NativeScrubberView.kt): the track, its fill
 * and the elapsed / length labels. It follows the Media3 player's own clock while that player is on `songId`, so there
 * is no per-frame work in JavaScript; a drag or tap comes back as seconds through `onSeekSeconds`, which seeks through
 * the existing flow. `NowPlayingControls` keeps `AppleSlider` for iOS, builds without the view and Connect's remote
 * player (`useNativeScrubber`).
 *
 * The view is laid over an invisible spacer built from the same layout numbers as the React Native labels, so the
 * rows around it do not move by a pixel.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { runOnJS, useAnimatedReaction, type SharedValue } from 'react-native-reanimated';
import { requireNativeView } from 'expo';
import { cleanSeconds, commitSeconds } from './nativeScrubberProps';
import { SCRUBBER_HIT_H, TIME_ROW_STYLE, TIME_TEXT_STYLE } from './scrubberLayout';

interface NativeScrubberViewProps {
  /** "volume" makes the slider the system media volume's (no clock, no labels, no commit event). */
  mode?: 'position' | 'volume';
  songId?: string;
  seedSec?: number;
  durationSec?: number;
  live: boolean;
  trackHeight: number;
  label: string;
  onCommit?: (event: { nativeEvent: { seconds: number; fraction: number } }) => void;
  style?: StyleProp<ViewStyle>;
}

const loadView = (): React.ComponentType<NativeScrubberViewProps> | null => {
  if (Platform.OS !== 'android') return null;
  try {
    return requireNativeView<NativeScrubberViewProps>('NativeScrubber');
  } catch {
    return null;
  }
};

const NativeView = loadView();

export const nativeScrubberAvailable = (): boolean => NativeView !== null;

interface NativeScrubberProps {
  /** The recording on screen; native follows the player only while it is playing this one. */
  songId: string;
  positionSV: SharedValue<number>;
  durationSV: SharedValue<number>;
  /** The place the finger chose, in seconds: seek there and resume if playing, as the slider's commit does. */
  onSeekSeconds: (seconds: number) => void | Promise<void>;
  /** The route is in front, so the view may keep time. */
  live: boolean;
  trackHeight?: number;
  accessibilityLabel?: string;
}

const NativeScrubber: React.FC<NativeScrubberProps> = ({
  songId, positionSV, durationSV, onSeekSeconds, live, trackHeight = 10, accessibilityLabel = 'Song position',
}) => {
  const [durationSec, setDurationSec] = useState(0);
  const [seedSec, setSeedSec] = useState(0);

  // The length changes once per song (when it loads); the view needs it as a prop, the position it reads itself.
  // The cleaning runs on the JavaScript side of runOnJS: cleanSeconds is not a worklet.
  const takeDuration = useCallback((seconds: number) => setDurationSec(cleanSeconds(seconds, 0.01)), []);
  useAnimatedReaction(
    () => Math.round(durationSV.value * 100) / 100,
    (next, prev) => {
      if (next !== prev) runOnJS(takeDuration)(next);
    },
  );
  // Not read during render (a shared value is for worklets). The first song takes the position JavaScript knows; a song
  // that replaces it starts at 0, since the position still held for a moment is the previous song's.
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    const first = seededFor.current === null;
    seededFor.current = songId;
    setSeedSec(first ? cleanSeconds(positionSV.value, 0.1) : 0);
  }, [songId, positionSV]);

  const onCommit = useCallback((event: { nativeEvent: { seconds: number } }) => {
    const seconds = commitSeconds(event, durationSec);
    // The seek reports its own failure; a rejection must not escape from an event handler.
    if (seconds !== null) Promise.resolve(onSeekSeconds(seconds)).catch(() => {});
  }, [durationSec, onSeekSeconds]);

  if (!NativeView) return null;
  return (
    <View>
      <View style={styles.strip} />
      <View style={TIME_ROW_STYLE} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Text style={styles.spacerText}>0:00</Text>
        <Text style={styles.spacerText}>0:00</Text>
      </View>
      <NativeView
        style={StyleSheet.absoluteFill}
        songId={songId}
        seedSec={seedSec}
        durationSec={durationSec}
        live={live}
        trackHeight={trackHeight}
        label={accessibilityLabel}
        onCommit={onCommit}
      />
    </View>
  );
};

interface NativeVolumeSliderProps {
  live: boolean;
  trackHeight?: number;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * The system media volume as the same Kotlin slider: it reads and sets the stream itself and follows the hardware keys
 * while on screen, so nothing crosses the bridge per move. `VolumeRow` falls back to `AppleSlider` where this is missing.
 */
export const NativeVolumeSlider: React.FC<NativeVolumeSliderProps> = React.memo(({ live, trackHeight = 6, accessibilityLabel = 'Volume', style }) => {
  if (!NativeView) return null;
  return <NativeView mode="volume" style={[styles.volume, style]} live={live} trackHeight={trackHeight} label={accessibilityLabel} />;
});
NativeVolumeSlider.displayName = 'NativeVolumeSlider';

const styles = StyleSheet.create({
  strip: { height: SCRUBBER_HIT_H },
  spacerText: { ...TIME_TEXT_STYLE, opacity: 0 },
  volume: { height: SCRUBBER_HIT_H },
});

export default React.memo(NativeScrubber);
