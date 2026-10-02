/**
 * A slim line under Stream's search while songs are saving: "Saving 2 songs", with a way to the Library where
 * the queue lives. It is what the Downloads tab of the old Get songs screen was for, as a glance: it shows
 * only while something is queued or running, and is gone the moment the queue is done.
 */
import React from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { Tactile } from '../allegra/motion';
import { Motion, Radius, Signal } from '../../constants/allegraTheme';
import { useDownloadQueueStore } from '../../store/downloadQueueStore';

const ACTIVE = ['pending', 'staging', 'downloading'];

export const DownloadsTray: React.FC<{ onPress: () => void }> = ({ onPress }) => {
  // A number, so this re-renders when the count changes and not on every progress tick.
  const active = useDownloadQueueStore(state => state.queue.filter(item => ACTIVE.includes(item.status)).length);
  if (active === 0) return null;
  return (
    <Animated.View entering={FadeIn.duration(Motion.duration.base)} exiting={FadeOut.duration(Motion.duration.fast)} layout={LinearTransition.duration(Motion.duration.base)}>
      <Tactile onPress={onPress} pressScale={0.98} accessibilityRole="button" accessibilityLabel={`Saving ${active} ${active === 1 ? 'song' : 'songs'}. Open your library`} style={styles.tray}>
        <ActivityIndicator size="small" color={Signal.wave} />
        <Text style={styles.text}>Saving {active} {active === 1 ? 'song' : 'songs'}</Text>
        <Text style={styles.view}>View</Text>
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
  text: { color: Signal.ink, fontSize: 13, fontWeight: '600' },
  view: { color: Signal.inkMuted, fontSize: 13 },
});
