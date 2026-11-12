import React from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Artwork from '../components/allegra/Artwork';
import { Tactile } from '../components/allegra/motion';
import { Radius, Space, Typography } from '../constants/allegraTheme';
import { Text } from './Text';

/** Square artwork always identifies a collection; metadata names its type. */
export const CollectionCard: React.FC<{ title: string; meta?: string; uri?: string; size?: number; onPress: () => void; onActions?: () => void }> = ({ title, meta, uri, size = 148, onPress, onActions }) => {
  const { fontScale } = useWindowDimensions();
  return (
  <Tactile onPress={onPress} onLongPress={onActions} accessibilityRole="button" accessibilityLabel={meta ? `${title}, ${meta}` : title} accessibilityHint={onActions ? 'Long press for collection actions' : undefined} style={{ width: size }}>
    <View style={{ width: size, height: size, borderRadius: Radius.art, overflow: 'hidden' }}><Artwork uri={uri} title={title} size={size} style={StyleSheet.absoluteFill} /></View>
    <Text variant="row" numberOfLines={2} ellipsizeMode="tail" style={[styles.title, { minHeight: Typography.row.lineHeight * 2 * fontScale }]}>{title}</Text>
    {meta ? <Text variant="secondary" tone="secondary" numberOfLines={2}>{meta}</Text> : null}
  </Tactile>
);
};
const styles = StyleSheet.create({ title: { marginTop: Space.xs } });
