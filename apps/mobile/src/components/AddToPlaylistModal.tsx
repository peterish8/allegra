import { Ionicons } from '@expo/vector-icons';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  View,
  type FlatListProps,
} from 'react-native';

import { Glass, Radius, Signal } from '../constants/allegraTheme';
import * as playlistQueries from '../database/playlistQueries';
import { usePlayerStore } from '../store/playerStore';
import { usePlaylistStore } from '../store/playlistStore';
import { useSongsStore } from '../store/songsStore';
import { RootStackParamList } from '../types/navigation';
import { Song } from '../types/song';
import { Button, IconButton, Sheet, SheetScrollable, TactileRow } from '../ui';
import * as Haptics from '../utils/haptics';
import { safeGoBack } from '../utils/navigationService';
import Artwork from './allegra/Artwork';

type AddToPlaylistNavigationProp = NativeStackNavigationProp<RootStackParamList>;
type AddToPlaylistRouteProp = RouteProp<RootStackParamList, 'AddToPlaylist'>;

const SCREEN_WIDTH = Dimensions.get('window').width;
const GRID_ITEM_WIDTH = (SCREEN_WIDTH - 48 - 12) / 3;

/** A FlatList inside the sheet: a drag down at its top moves the sheet. */
function SheetList<T>(props: FlatListProps<T>): React.ReactElement {
  return (
    <SheetScrollable>
      <FlatList<T> {...props} />
    </SheetScrollable>
  );
}

/** Add library songs to one playlist. A song into playlists is "Saved in" (`SavedInSheet`). */
export const AddToPlaylistModal = () => {
  const navigation = useNavigation<AddToPlaylistNavigationProp>();
  const route = useRoute<AddToPlaylistRouteProp>();
  const params = route.params;
  // The mini player pill floats over this sheet's button and last row; hide it while the sheet is in front.
  const setMiniPlayerHiddenSource = usePlayerStore(state => state.setMiniPlayerHiddenSource);
  useFocusEffect(useCallback(() => {
    setMiniPlayerHiddenSource('AddToPlaylist', true);
    return () => setMiniPlayerHiddenSource('AddToPlaylist', false);
  }, [setMiniPlayerHiddenSource]));

  const targetPlaylistId = params.playlistId;

  const addSongsToPlaylist = usePlaylistStore(state => state.addSongsToPlaylist);
  const songs = useSongsStore(state => state.songs);
  const fetchSongs = useSongsStore(state => state.fetchSongs);

  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [existingItems, setExistingItems] = useState<Set<string>>(new Set());

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        if (songs.length === 0) await fetchSongs();
        const currentSongs = await playlistQueries.getPlaylistSongs(targetPlaylistId);
        setExistingItems(new Set(currentSongs.map(s => s.id)));
      } catch (error) {
        console.error('Failed to init modal', error);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [targetPlaylistId, songs.length, fetchSongs]);

  const dataToRender = useMemo<Song[]>(() => {
    if (!searchQuery) return songs;
    const lower = searchQuery.toLowerCase();
    return songs.filter(s => s.title.toLowerCase().includes(lower) || s.artist?.toLowerCase().includes(lower));
  }, [songs, searchQuery]);

  const toggleSelection = useCallback((id: string) => {
    if (existingItems.has(id)) return;
    Haptics.selectionAsync().catch(() => {});
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }, [existingItems]);

  const handleDone = async () => {
    try {
      setLoading(true);
      await addSongsToPlaylist(targetPlaylistId, Array.from(selectedItems));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      safeGoBack(navigation);
    } catch (e) {
      console.error('Failed to save', e);
      setLoading(false);
    }
  };

  const renderSongItem = useCallback(({ item }: { item: Song }) => {
    const isSelected = selectedItems.has(item.id);
    const isExisting = existingItems.has(item.id);

    if (viewMode === 'grid') {
      return (
        <TactileRow
          style={[styles.gridItem, (isSelected || isExisting) && styles.gridItemSelected]}
          onPress={() => toggleSelection(item.id)}
          disabled={isExisting}
          accessibilityRole="checkbox"
          accessibilityLabel={item.title}
          accessibilityState={{ checked: isSelected || isExisting, disabled: isExisting }}
        >
          <View style={[styles.gridImage, isExisting && { opacity: 0.3 }]}>
            <Artwork uri={item.coverImageUri} title={item.title} artist={item.artist} size={GRID_ITEM_WIDTH} style={StyleSheet.absoluteFill} />
          </View>
          {isSelected && (
            <View style={styles.checkOverlay}>
              <Ionicons name="checkmark-circle" size={24} color={Signal.wave} />
            </View>
          )}
          {isExisting && (
            <View style={styles.checkOverlay}>
              <Ionicons name="checkmark-done-circle" size={24} color={Signal.inkMuted} />
            </View>
          )}
          <Text style={styles.gridText} numberOfLines={1}>{item.title}</Text>
        </TactileRow>
      );
    }

    return (
      <TactileRow
        style={[styles.listItem, (isSelected || isExisting) && styles.listItemSelected]}
        onPress={() => toggleSelection(item.id)}
        disabled={isExisting}
        accessibilityRole="checkbox"
        accessibilityLabel={item.title}
        accessibilityState={{ checked: isSelected || isExisting, disabled: isExisting }}
      >
        <View style={styles.listLeft}>
          <View style={[styles.listImage, isExisting && { opacity: 0.5 }]}>
            <Artwork uri={item.coverImageUri} title={item.title} artist={item.artist} size={48} style={StyleSheet.absoluteFill} />
          </View>
          <View style={styles.listTextContainer}>
            <Text style={[styles.listTitle, isExisting && styles.listTitleExisting]} numberOfLines={1}>{item.title}</Text>
            <Text style={styles.listSubtitle} numberOfLines={1}>{item.artist}</Text>
          </View>
        </View>
        <View style={styles.listCheckbox}>
          {isSelected && <Ionicons name="checkmark-circle" size={24} color={Signal.wave} />}
          {isExisting && <Ionicons name="checkmark-done-circle" size={24} color={Signal.inkMuted} />}
          {!isSelected && !isExisting && <View style={styles.emptyCircle} />}
        </View>
      </TactileRow>
    );
  }, [selectedItems, existingItems, viewMode, toggleSelection]);

  return (
    <Sheet
      visible
      presentation="inline"
      keyboard
      tall
      title="Add songs"
      onClose={() => safeGoBack(navigation)}
    >
      <View style={styles.subHeader}>
        <Text style={styles.subtitle}>{selectedItems.size} selected</Text>
        <IconButton
          icon={viewMode === 'grid' ? 'list' : 'grid'}
          label={viewMode === 'grid' ? 'Show as list' : 'Show as grid'}
          size="sm"
          onPress={() => setViewMode(prev => prev === 'grid' ? 'list' : 'grid')}
        />
      </View>

      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={Signal.inkMuted} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search your songs"
          placeholderTextColor={Signal.inkFaint}
          selectionColor={Signal.wave}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {loading ? (
        <ActivityIndicator color={Signal.wave} size="large" style={styles.loading} />
      ) : (
        <SheetList<Song>
          key={viewMode}
          data={dataToRender}
          keyExtractor={(item) => item.id}
          numColumns={viewMode === 'grid' ? 3 : 1}
          renderItem={renderSongItem}
          contentContainerStyle={styles.listContent}
          columnWrapperStyle={viewMode === 'grid' ? { gap: 6 } : undefined}
          initialNumToRender={20}
        />
      )}

      <View style={styles.footer}>
        <Button
          label={selectedItems.size === 1 ? 'Add 1 song' : selectedItems.size > 1 ? `Add ${selectedItems.size} songs` : 'Add songs'}
          variant="primary"
          block
          disabled={selectedItems.size === 0}
          onPress={handleDone}
        />
      </View>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  subHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  subtitle: { fontSize: 14, color: Signal.inkMuted },
  searchBar: { flexDirection: 'row', backgroundColor: Glass.fillLight, borderRadius: Radius.pill, paddingHorizontal: 14, height: 44, alignItems: 'center', marginBottom: 20 },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, color: Signal.ink, fontSize: 16 },
  loading: { marginVertical: 32 },
  listContent: { paddingBottom: 12 },
  gridItem: { width: GRID_ITEM_WIDTH, marginBottom: 12, alignItems: 'center', borderRadius: Radius.thumb },
  gridItemSelected: { opacity: 0.8 },
  gridImage: { width: GRID_ITEM_WIDTH, height: GRID_ITEM_WIDTH, borderRadius: Radius.thumb, overflow: 'hidden', marginBottom: 6 },
  gridText: { color: Signal.inkSoft, fontSize: 12, textAlign: 'center', width: '100%' },
  checkOverlay: { position: 'absolute', top: 4, right: 4, backgroundColor: Glass.scrimHeavy, borderRadius: 12 },
  // The border is always there (clear at rest) so selecting never shifts the row.
  listItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, backgroundColor: Glass.fillLight, padding: 8, borderRadius: Radius.well, borderWidth: 1, borderColor: 'transparent' },
  listItemSelected: { backgroundColor: Glass.selected, borderColor: Glass.selectedRim },
  listLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  listImage: { width: 48, height: 48, borderRadius: Radius.thumb, overflow: 'hidden', marginRight: 12 },
  listTextContainer: { flex: 1 },
  listTitle: { color: Signal.ink, fontSize: 16, fontWeight: '600', marginBottom: 2 },
  listTitleExisting: { color: Signal.inkFaint },
  listSubtitle: { color: Signal.inkMuted, fontSize: 13 },
  listCheckbox: { marginLeft: 12 },
  emptyCircle: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: Signal.inkFaint },
  footer: { marginTop: 12 },
});

export default AddToPlaylistModal;
