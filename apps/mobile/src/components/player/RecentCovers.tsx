import { Image } from 'expo-image';
import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Glass, Radius, Space, Tactile } from '../../ui';

/** The covers used recently, one tap to use one again (the song menu's Cover category). */
export const RecentCovers: React.FC<{ uris: readonly string[]; onSelect: (uri: string) => void }> = ({ uris, onSelect }) => (
  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
    {uris.map((uri, index) => (
      <Tactile key={`${uri}-${index}`} onPress={() => onSelect(uri)} pressScale={0.96} haptic="select" accessibilityRole="button" accessibilityLabel={`Use recent cover ${index + 1}`}>
        <Image source={{ uri }} style={styles.image} contentFit="cover" />
      </Tactile>
    ))}
  </ScrollView>
);

const styles = StyleSheet.create({
  row: { gap: Space.xs, paddingHorizontal: Space.xs, paddingVertical: Space.xs },
  image: { width: 64, height: 64, borderRadius: Radius.thumb, backgroundColor: Glass.fillLight },
});
