import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Chip, Space } from '../../ui';
import type { SearchCategory } from '../../store/searchSessionStore';
const categories: SearchCategory[] = ['All', 'Songs', 'Artists', 'Albums', 'Playlists'];
export function SearchCategories({ selected, onSelect }: { selected: SearchCategory; onSelect: (category: SearchCategory) => void }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.row} accessibilityRole="tablist" accessibilityLabel="Search result types">
    {categories.map(category => <Chip key={category} label={category} selected={category === selected} onPress={() => onSelect(category)} accessibilityLabel={`${category} results`} />)}
  </ScrollView>;
}
const styles = StyleSheet.create({ row: { paddingHorizontal: Space.md, paddingVertical: Space.xs, gap: Space.xs } });
