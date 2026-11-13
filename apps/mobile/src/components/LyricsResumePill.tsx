import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Frosted } from './allegra/Frosted';
import { Tactile } from './allegra/motion';
import { Signal, TypeScale } from '../constants/allegraTheme';

interface LyricsResumePillProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  hitSlop?: number;
}

/** The frosted pill floating over the lyrics: back to the playing line, or the plain-text auto-scroll switch. */
export const LyricsResumePill: React.FC<LyricsResumePillProps> = ({ icon, label, accessibilityLabel, onPress, hitSlop }) => (
  <Tactile
    wrapperStyle={styles.place}
    style={styles.pill}
    onPress={onPress}
    hitSlop={hitSlop}
    accessibilityRole="button"
    accessibilityLabel={accessibilityLabel}
  >
    <Frosted radius={18} intensity={50} tint={0.35} />
    <Ionicons name={icon} size={14} color={Signal.wave} />
    <Text style={styles.text}>{label}</Text>
  </Tactile>
);

const styles = StyleSheet.create({
  // Floating over the lyrics, clear of the transport row below.
  place: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 16,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    overflow: 'hidden',
  },
  text: {
    color: Signal.ink,
    fontSize: TypeScale.meta,
    fontWeight: '600',
  },
});
