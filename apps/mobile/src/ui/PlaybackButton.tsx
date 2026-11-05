/** Stable transport geometry; loading and retry replace the glyph inside the same disc. */
import React from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useReducedMotion } from 'react-native-reanimated';
import type { PlaybackStatus } from '../playback/playbackStatus';
import { Tactile } from '../components/allegra/motion';
import { Glass, Signal } from '../constants/allegraTheme';

export function PlaybackButton({ status, onPress, size = 84 }: { status: PlaybackStatus; onPress: () => void; size?: number }) {
  const reduceMotion = useReducedMotion();
  const loading = status === 'loading';
  const label = status === 'error' ? 'Could not play. Try again' : loading ? 'Loading. Pause' : status === 'playing' ? 'Pause' : 'Play';
  return <Tactile onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
    style={[styles.disc, { width: size, height: size, borderRadius: size / 2 }]}>
    {loading && !reduceMotion ? <ActivityIndicator size={size > 48 ? 'large' : 'small'} color={Signal.ink} />
      : <Ionicons name={status === 'error' ? 'refresh' : status === 'playing' || loading ? 'pause' : 'play'} size={size > 48 ? 36 : 22} color={Signal.ink} />}
  </Tactile>;
}
const styles = StyleSheet.create({ disc: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: Glass.fillPressed } });
