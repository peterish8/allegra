import React from 'react';
import { StyleSheet, View } from 'react-native';
import Artwork from '../components/allegra/Artwork';
import { Tactile } from '../components/allegra/motion';
import { Radius, Space } from '../constants/allegraTheme';
import { Text } from './Text';

/** Square artwork always identifies a collection; metadata names its type. */
export const CollectionCard: React.FC<{ title: string; meta: string; uri?: string; size?: number; onPress: () => void; onActions?: () => void }> = ({ title, meta, uri, size = 148, onPress, onActions }) => (
  <Tactile onPress={onPress} onLongPress={onActions} accessibilityRole="button" accessibilityLabel={`${title}, ${meta}`} accessibilityHint={onActions ? 'Long press for collection actions' : undefined} style={{ width: size }}>
    <View style={{ width: size, height: size, borderRadius: Radius.art, overflow: 'hidden' }}><Artwork uri={uri} title={title} size={size} style={StyleSheet.absoluteFill} /></View>
    <Text variant="row" numberOfLines={2} style={styles.title}>{title}</Text>
    <Text variant="secondary" tone="secondary" numberOfLines={2}>{meta}</Text>
  </Tactile>
);
const styles = StyleSheet.create({ title: { marginTop: Space.xs } });
