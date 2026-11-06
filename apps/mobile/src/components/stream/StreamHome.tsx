import { useWindowDimensions } from 'react-native';
/**
 * Stream home building blocks, modelled on the layouts every major player has
 * settled on rather than on a landing page:
 *
 *   MoodChips      YouTube Music's filter row â€” rounded-rect chips, one selected
 *   ShortcutGrid   Spotify's two-column "jump back in" grid (up to six)
 *   QuickPicks     YouTube Music's paged columns of four song rows
 *   SongRow        one track: art, title, artist, a single trailing action
 *   CoverShelf     horizontal shelf of plain square covers with title + artist
 *
 * Flat surfaces, no glass, no numbered ranks, no play disc on every cover â€” the
 * whole cover is the play target. The playing song is marked with the signal
 * colour and a speaker glyph on its art.
 */
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { FlatList, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Radius, Signal, Space, TypeScale } from '../../constants/allegraTheme';
import type { DownloadTarget } from '../../hooks/useDownloadState';
import { Chip, CHIP_ROW_PADDING, Control, SongRow as SharedSongRow } from '../../ui';
import Artwork from '../allegra/Artwork';
import { Tactile } from '../allegra/motion';
import DownloadButton from './DownloadButton';
import { shortcutCellWidth, shortcutColumns } from './shortcutGrid';
import SavedBadge from './SavedBadge';

// Matches SectionHeading's inset so headings and content share an edge.
export const GUTTER = Control.gutter;
const SURFACE = 'rgba(255, 255, 255, 0.07)';
const SURFACE_ON = 'rgba(255, 255, 255, 0.12)';

export interface TrackItem {
  key: string;
  title: string;
  artist?: string;
  artwork?: string;
  isCurrent: boolean;
  /** A catalog song: its download state shows beside it and on its cover. */
  download?: DownloadTarget;
}

const PlayingMark: React.FC<{ size: number }> = ({ size }) => (
  <View style={[StyleSheet.absoluteFill, styles.playingMark]}>
    <Ionicons name="volume-medium" size={size} color={Signal.wave} />
  </View>
);

// â”€â”€â”€ Mood chips â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const MoodChips: React.FC<{
  moods: readonly string[];
  selected: string | null;
  onSelect: (mood: string | null) => void;
}> = ({ moods, selected, onSelect }) => (
  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
    {moods.map(mood => {
      const on = mood === selected;
      return (
        <Chip key={mood} label={mood} selected={on} onPress={() => onSelect(on ? null : mood)} />
      );
    })}
  </ScrollView>
);

// â”€â”€â”€ Shortcut grid â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const ShortcutGrid: React.FC<{
  items: TrackItem[];
  onPress: (index: number) => void;
  onLongPress?: (index: number) => void;
}> = ({ items, onPress, onLongPress }) => {
  const { width, fontScale } = useWindowDimensions();
  const columns = shortcutColumns(fontScale);
  // A definite width, not "50%": the feed list measures its cells before it knows its own width, and a percentage of
  // an unknown width gave the grid a stale, far taller size (the blank gap under "Jump back in").
  const cellWidth = shortcutCellWidth(width, columns, GRID_INSET);
  return (
  <View style={styles.grid}>
    {items.slice(0, 6).map((item, i) => (
      <View key={item.key} style={[styles.gridCell, { width: cellWidth }]}>
        <Tactile
          onPress={() => onPress(i)}
          onLongPress={onLongPress ? () => onLongPress(i) : undefined}
          pressScale={0.97}
          accessibilityRole="button"
          accessibilityLabel={`${item.title}${item.artist ? `, ${item.artist}` : ''}`}
          style={styles.shortcut}
        >
          <View style={styles.shortcutArt}>
            <Artwork uri={item.artwork} title={item.title} artist={item.artist} size={SHORTCUT_ART} style={StyleSheet.absoluteFill} />
            {item.isCurrent ? <PlayingMark size={18} /> : null}
            {item.download ? <SavedBadge song={item.download} small /> : null}
          </View>
          <View style={styles.shortcutCopy}>
            <Text style={[styles.shortcutTitle, item.isCurrent && styles.current]} numberOfLines={2}>{item.title}</Text>
            {item.artist ? <Text style={styles.shortcutMeta} numberOfLines={1}>{item.artist}</Text> : null}
          </View>
        </Tactile>
      </View>
    ))}
  </View>
);
};

const SHORTCUT_ART = 56;
/** The grid's side inset: the page gutter less each tile's 4dp padding, so tile edges meet the gutter. */
const GRID_INSET = GUTTER - 4;

// â”€â”€â”€ Song row â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const SongRow: React.FC<{ item: TrackItem; onPress: () => void; onLongPress?: () => void; onSave?: () => void }> = ({ item, onPress, onLongPress, onSave }) => (
  <SharedSongRow title={item.title} artist={item.artist} artwork={item.artwork} playing={item.isCurrent} onPress={onPress} onActions={onLongPress}
    trailing={onSave && item.download ? <DownloadButton song={item.download} onSave={onSave} /> : undefined} />
);

// â”€â”€â”€ Quick picks: paged columns of four â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const QuickPicks: React.FC<{ items: TrackItem[]; onPress: (index: number) => void; onLongPress?: (index: number) => void; onSave?: (index: number) => void }> = ({ items, onPress, onLongPress, onSave }) => (
  <View>{items.slice(0, 4).map((item, index) => <SongRow key={item.key} item={item} onPress={() => onPress(index)} onLongPress={onLongPress ? () => onLongPress(index) : undefined} onSave={onSave ? () => onSave(index) : undefined} />)}</View>
);

const COVER = 148;

export const CoverShelf: React.FC<{
  items: TrackItem[];
  onPress: (index: number) => void;
  onLongPress?: (index: number) => void;
}> = ({ items, onPress, onLongPress }) => (
  <FlatList
    horizontal
    data={items}
    keyExtractor={item => item.key}
    showsHorizontalScrollIndicator={false}
    contentContainerStyle={styles.shelf}
    renderItem={({ item, index }) => (
      <Tactile
        onPress={() => onPress(index)}
        onLongPress={onLongPress ? () => onLongPress(index) : undefined}
        pressScale={0.97}
        accessibilityRole="button"
        accessibilityLabel={`${item.title}${item.artist ? `, ${item.artist}` : ''}`}
        style={styles.cover}
      >
        <View style={styles.coverArt}>
          <Artwork uri={item.artwork} title={item.title} artist={item.artist} size={COVER} style={StyleSheet.absoluteFill} />
          {item.isCurrent ? <PlayingMark size={28} /> : null}
          {item.download ? <SavedBadge song={item.download} /> : null}
        </View>
        <Text style={[styles.coverTitle, item.isCurrent && styles.current]} numberOfLines={1}>{item.title}</Text>
        {item.artist ? <Text style={styles.coverArtist} numberOfLines={1}>{item.artist}</Text> : null}
      </Tactile>
    )}
  />
);

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  current: { color: Signal.wave },
  playingMark: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0, 0, 0, 0.45)' },

  // The chips' 48dp touch is 36dp drawn plus slop above and below, which has to stay inside this row.
  chips: { paddingHorizontal: GUTTER, gap: Space.xs, paddingVertical: CHIP_ROW_PADDING },
  chip: {
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 8,
    justifyContent: 'center',
    backgroundColor: SURFACE,
  },
  chipOn: { backgroundColor: Signal.ink },
  chipText: { fontSize: 14, fontWeight: '600', color: Signal.ink },
  chipTextOn: { color: Signal.bg },

  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: GRID_INSET },
  gridCell: { padding: 4 },
  shortcut: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: SHORTCUT_ART,
    borderRadius: Radius.chip,
    overflow: 'hidden',
    backgroundColor: SURFACE,
  },
  shortcutArt: { width: SHORTCUT_ART, height: SHORTCUT_ART, alignSelf: 'flex-start' },
  shortcutCopy: { flex: 1, minWidth: 0, paddingHorizontal: Space.sm - 2, paddingVertical: Space.xxs },
  shortcutTitle: { fontSize: TypeScale.secondary, lineHeight: 17, fontWeight: '600', color: Signal.ink },
  shortcutMeta: { fontSize: TypeScale.caption, lineHeight: 16, color: Signal.inkMuted, marginTop: 1 },

  columns: { paddingHorizontal: GUTTER, gap: Space.xs },
  row: { flexDirection: 'row', alignItems: 'center' },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingVertical: 6 },
  rowArt: { width: 52, height: 52, borderRadius: 6, overflow: 'hidden', backgroundColor: SURFACE_ON },
  rowTitle: { fontSize: 16, fontWeight: '600', color: Signal.ink },
  rowArtist: { fontSize: 14, color: Signal.inkMuted, marginTop: 2 },
  rowAction: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },

  shelf: { paddingHorizontal: GUTTER, gap: Space.sm },
  cover: { width: COVER },
  coverArt: { width: COVER, height: COVER, borderRadius: 8, overflow: 'hidden', backgroundColor: SURFACE_ON },
  coverTitle: { fontSize: 14, fontWeight: '600', color: Signal.ink, marginTop: 8 },
  coverArtist: { fontSize: 13, color: Signal.inkMuted, marginTop: 2 },
});
