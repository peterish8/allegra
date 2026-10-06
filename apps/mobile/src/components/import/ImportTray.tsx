/**
 * A slim line on Stream while an import runs in the background: "Moving 2 of 4 from Spotify" or
 * "Finding songs · 120 of 800", with the way back to Import. Gone the moment nothing is running.
 */
import React from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { Tactile } from '../allegra/motion';
import { Motion, Radius, Signal } from '../../constants/allegraTheme';
import { useSpotifyTransfer } from '../../services/spotify/spotifyTransfer';
import { useFileImportStore } from '../../store/fileImportStore';

export const ImportTray: React.FC<{ onPress: () => void }> = ({ onPress }) => {
  const spotify = useSpotifyTransfer();
  const fileLine = useFileImportStore((state) => !state.busy ? null
    : state.step === 'matching' ? `Finding songs · ${state.progress.done} of ${state.progress.total}`
    : state.step === 'saving' ? `Saving songs · ${state.savedProgress.done} of ${state.savedProgress.total}` : null);
  const done = [...spotify.runs.values()].filter((run) => run.state === 'done').length;
  const line = spotify.syncing ? `Moving ${Math.min(done + 1, spotify.order.length)} of ${spotify.order.length} from Spotify` : fileLine;
  if (!line) return null;
  return (
    <Animated.View entering={FadeIn.duration(Motion.duration.base)} exiting={FadeOut.duration(Motion.duration.fast)}>
      <Tactile onPress={onPress} pressScale={0.98} accessibilityRole="button" accessibilityLabel={`${line}. Open Import`} style={styles.tray}>
        <ActivityIndicator size="small" color={Signal.wave} />
        <Text style={styles.text} numberOfLines={1}>{line}</Text>
        <Ionicons name="chevron-forward" size={14} color={Signal.inkMuted} />
      </Tactile>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  tray: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    alignSelf: 'flex-start',
    marginHorizontal: 20,
    marginTop: 10,
    height: 38,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  text: { color: Signal.ink, fontSize: 13, fontWeight: '600', flexShrink: 1 },
});
