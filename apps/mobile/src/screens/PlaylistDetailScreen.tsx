import { fromMobileId } from '@shared/songRef';
import { AppScreen } from '../components/AppScreen';
import { addOnlineSongToPlaylist } from '../services/sync/onlinePlaylist';
import { snapshotOfLocal } from '../services/sync/plan';
import { usePlaylistStore } from '../store/playlistStore';
import { playlistUndoOrder } from '../utils/playlistUndoOrder';
/**
 * A playlist's page: the cover, its name and length, Play / Shuffle / Add, then the songs. Built from src/ui:
 *
 * - The cover's own colours wash the top of the page and fade to black, the way an album page reads. No aurora.
 * - The header is clear at rest and gains a solid backing as the list scrolls under it (a scrim's opacity,
 *   never an animated colour).
 * - ••• opens the playlist's actions (sort, edit order, change cover); a song's long press or ••• opens the
 *   song's actions. Edit mode is a pencil, not the •••.
 * - Removing a song asks first (ConfirmSheet).
 *
 * Audio loading is not this page's job: MiniPlayer and NowPlaying own it (CLAUDE.md, "Audio load ownership"). An
 * inline loader that listed `isPlaying` in its dependencies and called play() used to live here.
 */

import { Ionicons } from '@expo/vector-icons';
import { RouteProp, useFocusEffect, useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import DraggableFlatList, { RenderItemParams } from 'react-native-draggable-flatlist';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MosaicCover } from '../components/MosaicCover';
import { displayPlaylistName } from '../utils/sentenceCase';

import Artwork from '../components/allegra/Artwork';
import Marquee from '../components/allegra/Marquee';
import { useArtworkPalette } from '../components/allegra/useArtworkPalette';
import { useSongActions } from '../components/library/useSongActions';
import { PlaylistItem } from '../components/PlaylistItem';
import { Toast } from '../components/Toast';
import * as playlistQueries from '../database/playlistQueries';
import { getOnlinePlaylistSongs } from '../database/syncQueries';
import { useSortedSongs, type SortDirection, type SortOption } from '../hooks/useSortedSongs';
import { onlineRowToSong, playList, removeOnlineFromPlaylist } from '../services/sync/onlineSongs';
import { LIKED_PLAYLIST_ID } from '../services/sync/plan';
import { useOnlineLibraryStore } from '../store/onlineLibraryStore';
import { playerControls, usePlayerStore } from '../store/playerStore';
import { Song } from '../types/song';
import {
  Button, EmptyState, Glass, GUTTER, IconButton, Motion, OnMedia, Radius, RowPlaceholder, Sheet, SheetOption, Signal, SongRow, Space, Text, TextButton, TypeScale, useBottomClearance
} from '../ui';
import { countOf } from '../utils/formatters';
import { safeGoBack } from '../utils/navigationService';
import { shuffled } from '../utils/shuffle';

type PlaylistDetailRouteProp = RouteProp<{ PlaylistDetail: { playlistId: string } }, 'PlaylistDetail'>;

const AnimatedDraggableFlatList = Animated.createAnimatedComponent(DraggableFlatList) as unknown as typeof DraggableFlatList;
// FlashList's generic props don't survive createAnimatedComponent; the one cast the project allows (CLAUDE.md).
const AnimatedFlashList = Animated.createAnimatedComponent(FlashList) as unknown as React.FC<any>;

const HEADER_HEIGHT = 56;
const SORT_LABELS: Record<Exclude<SortOption, 'recent'>, string> = {
  custom: 'Custom order',
  title: 'Title',
  artist: 'Artist',
  date: 'Recently added',
};

export const PlaylistDetailScreen: React.FC = () => {
  const route = useRoute<PlaylistDetailRouteProp>();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const { playlistId } = route.params;
  // The cover leads the page, about two thirds of the width as on an album page.
  const { width: windowWidth } = useWindowDimensions();
  const coverSize = Math.round(Math.min(windowWidth - GUTTER * 2, 184));
  const bottom = useBottomClearance();

  const [songs, setSongs] = useState<Song[]>([]);
  const [playlistName, setPlaylistName] = useState('');
  const [playlistCover, setPlaylistCover] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [toast, setToast] = useState<{ visible: boolean; message: string; type: 'success' | 'error' | 'info'; action?: { label: string; onPress: () => void } } | null>(null);

  const currentSongId = usePlayerStore(state => state.currentSongId);
  const currentPlaylistId = usePlayerStore(state => state.currentPlaylistId);
  const currentSong = usePlayerStore(state => state.currentSong);
  const { play } = playerControls;
  const isPlaying = usePlayerStore(state => state.isPlaying);
  const activeIsPlaying = currentPlaylistId === playlistId;

  // A song's actions (Play next, Find lyrics, cover, version, remove from this playlist): the same sheet as Library.
  const songActions = useSongActions();

  // ─── Sort, remembered per playlist ───────────────────────────────────────
  const [sortOption, setSortOption] = useState<SortOption>('custom');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const SORT_PREF_KEY = `playlist_sort_${playlistId}`;

  useEffect(() => {
    const loadSort = async () => {
      try {
        const AsyncStorage = require('@react-native-async-storage/async-storage').default;
        const saved = await AsyncStorage.getItem(SORT_PREF_KEY);
        if (saved) {
          const { option, direction } = JSON.parse(saved);
          setSortOption(option);
          setSortDirection(direction);
        }
      } catch (e) {
        if (__DEV__) console.log('Failed to load sort settings', e);
      }
    };
    loadSort();
  }, [playlistId, SORT_PREF_KEY]);

  const saveSort = async (option: SortOption, direction: SortDirection) => {
    try {
      const AsyncStorage = require('@react-native-async-storage/async-storage').default;
      await AsyncStorage.setItem(SORT_PREF_KEY, JSON.stringify({ option, direction }));
    } catch (e) {
      if (__DEV__) console.log('Failed to save sort settings', e);
    }
  };

  /** Picking the current option again flips its direction; a new one starts A–Z (newest first for dates). */
  const handleSortChange = (option: SortOption) => {
    const direction: SortDirection = option === sortOption
      ? (sortDirection === 'asc' ? 'desc' : 'asc')
      : option === 'date' ? 'desc' : 'asc';
    setSortOption(option);
    setSortDirection(direction);
    saveSort(option, direction);
    setSortOpen(false);
  };

  const sortLabel = sortOption === 'custom' || sortOption === 'recent'
    ? SORT_LABELS.custom
    : `${SORT_LABELS[sortOption]} ${sortDirection === 'asc' ? '↑' : '↓'}`;

  // ─── Scroll ──────────────────────────────────────────────────────────────
  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler(event => {
    scrollY.value = event.contentOffset.y;
  });
  const flatListRef = React.useRef<any>(null);

  // ─── Data ────────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      setLoadError(false);
      const playlists = await playlistQueries.getAllPlaylists();
      const playlist = playlists.find(p => p.id === playlistId);
      const playlistSongs = await playlistQueries.getPlaylistSongs(playlistId);
      setPlaylistName(playlist?.name ? displayPlaylistName(playlist.name) : 'Playlist');
      setPlaylistCover(playlist?.coverImageUri || null);
      const onlineRows = playlistId === LIKED_PLAYLIST_ID
        ? useOnlineLibraryStore.getState().likes
        : await getOnlinePlaylistSongs(playlistId);
      const localIds = new Set(playlistSongs.map(local => local.id));
      const onlineSongs = onlineRows.map(onlineRowToSong).filter(song => !localIds.has(song.id));
      setSongs([...playlistSongs, ...onlineSongs]);
    } catch (e) {
      setLoadError(true);
      if (__DEV__) console.log('Failed to load playlist', e);
    } finally {
      setLoading(false);
    }
  }, [playlistId]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  // Songs that arrive from another device while the screen is open.
  const onlineVersion = useOnlineLibraryStore(state => state.playlistVersion + state.likes.length);
  useEffect(() => { loadData(); }, [onlineVersion, loadData]);

  const filteredSongs = useSortedSongs(songs, searchQuery, sortOption, sortDirection);

  // While this playlist plays, a new sort reorders what comes next (a search never does).
  useEffect(() => {
    if (activeIsPlaying && !searchQuery) usePlayerStore.getState().updateQueue(filteredSongs);
  }, [filteredSongs, activeIsPlaying, searchQuery]);

  // The playlist's own cover leads; the playing track only takes over while it belongs to this playlist.
  const isSongInPlaylist = currentSong && songs.some(s => s.id === currentSong.id);
  const activeSongInPlaylist = activeIsPlaying && isSongInPlaylist ? currentSong : null;
  const headerImageUri = playlistCover || activeSongInPlaylist?.coverImageUri || songs[0]?.coverImageUri;
  const palette = useArtworkPalette(headerImageUri ?? undefined);

  const totalDuration = songs.reduce((acc, song) => acc + (song.duration || 0), 0);
  const formatTotalDuration = () => {
    const hours = Math.floor(totalDuration / 3600);
    const mins = Math.floor((totalDuration % 3600) / 60);
    return hours > 0 ? `${hours} hr ${mins} min` : `${mins} min`;
  };

  // ─── Actions ─────────────────────────────────────────────────────────────
  // Play from the top, or pause / resume when this playlist is already the one playing.
  const playOrPause = useCallback(() => {
    if (activeIsPlaying) {
      usePlayerStore.getState().requestPlayback(!usePlayerStore.getState().isPlaying);
    } else if (songs.length > 0) {
      playList(playlistId, songs, 0).then(ok => {
        if (!ok) setToast({ visible: true, message: 'Couldn’t find these songs online', type: 'error' });
      });
    }
  }, [activeIsPlaying, songs, playlistId]);

  const shufflePlaylist = useCallback(() => {
    if (songs.length > 0) playList(playlistId, shuffled(songs), 0);
  }, [songs, playlistId]);

  const handleSongPress = useCallback((song: Song, index: number) => {
    // A filtered list queues what you see, so Next matches the page.
    playList(playlistId, filteredSongs, index).then(ok => {
      if (ok) play();
      else setToast({ visible: true, message: 'Couldn’t find this song online', type: 'error' });
    });
  }, [playlistId, filteredSongs, play]);

  const handleDeleteSong = useCallback(async (songId: string) => {
    const song = songs.find(item => item.id === songId);
    if (!song) return;
    const originalOrder = songs.map(item => item.id);
    try {
      if (songId.startsWith('stream:') && playlistId !== LIKED_PLAYLIST_ID) await removeOnlineFromPlaylist(playlistId, songId);
      else if (songId.startsWith('stream:')) await (await import('../store/songsStore')).useSongsStore.getState().toggleLike(songId);
      else await usePlaylistStore.getState().removeSongFromPlaylist(playlistId, songId);
      await loadData();
      setToast({ visible: true, message: 'Removed from the playlist', type: 'success', action: { label: 'Undo', onPress: () => {
        setToast(null);
        (async () => {
          const ref = fromMobileId(song.id);
          if (ref) {
            const result = await addOnlineSongToPlaylist(playlistId, snapshotOfLocal(song, ref));
            if (result === 'error') throw new Error('Could not restore this song');
          } else {
            await usePlaylistStore.getState().addSongToPlaylist(playlistId, songId);
            // Restore surviving rows without dropping songs added since the removal.
            const currentRows = await playlistQueries.getPlaylistSongs(playlistId);
            await playlistQueries.updateSongOrder(playlistId, playlistUndoOrder(originalOrder, currentRows.map(item => item.id)));
          }
          await loadData();
        })().catch(() => setToast({ visible: true, message: 'Could not restore the song. Try adding it again.', type: 'error' }));
      } } });
    } catch {
      setToast({ visible: true, message: 'Could not remove the song. Try again.', type: 'error' });
    }
  }, [songs, playlistId, loadData]);

  const openSongActions = useCallback((song: Song) => {
    songActions.open(song, { onRemoveFromPlaylist: () => { handleDeleteSong(song.id); } });
  }, [songActions, handleDeleteSong]);

  const handleDragEnd = useCallback(async ({ data }: { data: Song[] }) => {
    setSongs(data);
    if (searchQuery) return; // A filtered order isn't the playlist's order
    try {
      await playlistQueries.updateSongOrder(playlistId, data.map(s => s.id));
    } catch (e) {
      if (__DEV__) console.log('Reorder failed', e);
    }
  }, [playlistId, searchQuery]);

  const handleResetCover = async () => {
    setActionsOpen(false);
    setPlaylistCover(null);
    await playlistQueries.updatePlaylist(playlistId, { coverImageUri: '' });
  };

  const handlePickCover = async () => {
    setActionsOpen(false);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.5,
    });
    if (!result.canceled && result.assets && result.assets.length > 0) {
      const uri = result.assets[0].uri;
      setPlaylistCover(uri);
      await playlistQueries.updatePlaylist(playlistId, { coverImageUri: uri });
    }
  };

  const openAddSongs = () => (navigation as unknown as { navigate: (name: string, params: object) => void }).navigate('AddToPlaylist', { playlistId });

  // ─── Rows ────────────────────────────────────────────────────────────────
  const renderItem = useCallback(({ item, drag, isActive, getIndex }: RenderItemParams<Song>) => (
    !isEditMode ? <SongRow title={item.title} artist={item.artist} artwork={item.coverImageUri} playing={item.id === currentSongId}
      onPress={() => handleSongPress(item, getIndex?.() ?? 0)} onActions={() => openSongActions(item)} /> : <PlaylistItem
      item={item}
      drag={drag}
      isActive={isActive}
      getIndex={getIndex}
      currentSongId={currentSongId}
      isPlaying={isPlaying}
      isEditMode={isEditMode}
      onPress={handleSongPress}
      onMore={openSongActions}
      onDelete={handleDeleteSong}
      displayIndex={getIndex ? getIndex() ?? 0 : 0}
    />
  ), [currentSongId, isPlaying, isEditMode, handleSongPress, handleDeleteSong, openSongActions]);

  // ─── Motion ──────────────────────────────────────────────────────────────
  // The header gains a solid backing as the list passes under it, and its title fades in once the big one is gone.
  const headerBacking = useAnimatedStyle(() => ({ opacity: interpolate(scrollY.value, [coverSize * 0.6, coverSize + 40], [0, 1], Extrapolation.CLAMP) }));
  const headerTitle = useAnimatedStyle(() => ({ opacity: interpolate(scrollY.value, [coverSize + 20, coverSize + 80], [0, 1], Extrapolation.CLAMP) }));
  // The cover's wash scrolls away with the page.

  const fabStyle = useAnimatedStyle(() => {
    const show = scrollY.value > 600;
    return {
      opacity: withTiming(show ? 1 : 0, { duration: Motion.duration.fast }),
      transform: [{ translateY: withTiming(show ? 0 : 12, { duration: Motion.duration.base, easing: Motion.ease.decelerate }) }],
    };
  });

  const topInset = insets.top + HEADER_HEIGHT;
  const playingHere = activeIsPlaying && isPlaying;

  const renderHeader = () => (
    <View style={styles.hero}>
      <View style={[styles.cover, { width: coverSize, height: coverSize, shadowColor: palette.primary }]}>
        <View style={styles.coverClip}>
          {/* The cover leads as on an album: the playlist's own, else a mosaic of four of its songs, as on the website. */}
          {!playlistCover && songs.length >= 4 ? (
            <MosaicCover songs={songs.slice(0, 4)} size={coverSize} />
          ) : headerImageUri ? (
            <Image source={{ uri: headerImageUri }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={0} />
          ) : (
            <Artwork title={playlistName} size={coverSize} style={StyleSheet.absoluteFill} />
          )}
        </View>
      </View>

      {loadError ? <View><Text variant="secondary" tone="secondary">Couldn’t refresh this playlist. Saved songs are still here.</Text><TextButton label="Try again" onPress={() => { loadData(); }} /></View> : null}
      <Text variant="detail" align="center" numberOfLines={2} style={styles.heroTitle} accessibilityRole="header">{playlistName}</Text>
      <Text variant="secondary" tone="secondary" tabular>
        {countOf(songs.length, 'song')}{songs.length > 0 ? ` · ${formatTotalDuration()}` : ''}
      </Text>
      {/* Round 7 item 4: the same pair as the artist page. Play is the one filled capsule, Shuffle the smaller frosted one. */}
      <View style={styles.heroActions}>

      {songs.length > 0 ? (
        <>
          <Button
            label={playingHere ? 'Pause' : activeIsPlaying ? 'Resume' : 'Play'}
            accessibilityLabel={playingHere ? 'Pause playlist' : activeIsPlaying ? 'Resume playlist' : 'Play playlist'}
            icon={playingHere ? 'pause' : 'play'}
            variant="primary"
            onPress={playOrPause}
            haptic="light"
          />
          <Button label="Shuffle" accessibilityLabel="Shuffle playlist" icon="shuffle" size="compact" onPress={shufflePlaylist} haptic="select" />
        </>
      ) : null}
      </View>

      {songs.length > 0 ? (
        <View style={styles.listBar}>
          <TextButton label={sortLabel} icon="chevron-down" onPress={() => setSortOpen(true)} accessibilityLabel={`Sort playlist, ${sortLabel}`} />
          {isEditMode ? <TextButton label="Done" tone="accent" onPress={() => setIsEditMode(false)} /> : <TextButton label="Add songs" icon="add" onPress={openAddSongs} />}
        </View>
      ) : null}
    </View>
  );

  const renderEmpty = () => (loading ? (
    <View>{[0, 1, 2, 3, 4].map(i => <RowPlaceholder key={i} />)}</View>
  ) : loadError ? (
    <EmptyState icon="cloud-offline-outline" title="Couldn?t load this playlist" body="Check your connection and try again." action={{ label: 'Try again', onPress: () => { loadData(); } }} />
  ) : searchQuery ? (
    <EmptyState icon="search" title="No songs match" body={`Nothing in this playlist matches “${searchQuery}”.`} />
  ) : (
    <EmptyState icon="musical-notes-outline" title="No songs yet" body="Add songs you saved or streamed." action={{ label: 'Add songs', icon: 'add', onPress: openAddSongs }} />
  ));

  const listProps = {
    ref: flatListRef,
    data: filteredSongs,
    keyExtractor: (item: Song) => item.id,
    onScroll: scrollHandler,
    scrollEventThrottle: 16,
    contentContainerStyle: { paddingBottom: bottom, paddingTop: topInset },
    ListHeaderComponent: renderHeader(),
    ListEmptyComponent: renderEmpty(),
  };

  return (
    <AppScreen style={styles.container}>

      {/* One list in both modes: a draggable one while editing (it keeps its rows), FlashList otherwise. */}
      {!isEditMode ? (
        <AnimatedFlashList
          {...listProps}
          renderItem={({ item, index }: { item: Song; index: number }) => renderItem({ item, getIndex: () => index, drag: () => undefined, isActive: false } as unknown as RenderItemParams<Song>)}
        />
      ) : (
        <AnimatedDraggableFlatList {...listProps} onDragEnd={handleDragEnd} renderItem={renderItem} />
      )}

      {/* The header: clear at rest, a solid backing once the list passes under it. */}
      <View style={[styles.header, { paddingTop: insets.top, height: topInset }]}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.headerBacking, headerBacking]} pointerEvents="none" />
        {!isSearchActive ? (
          <>
            <IconButton icon="chevron-back" label="Back" variant="plain" onPress={() => safeGoBack(navigation)} />
            <Animated.View style={[styles.headerTitle, headerTitle]}>
              <Marquee text={playlistName} style={styles.headerTitleText} active={isFocused} containerStyle={styles.headerTitleBox} />
            </Animated.View>
            <IconButton icon="search" label="Find in playlist" variant="plain" onPress={() => setIsSearchActive(true)} />
            <IconButton icon="ellipsis-horizontal" label="Playlist options" variant="plain" onPress={() => setActionsOpen(true)} />
          </>
        ) : (
          <View style={styles.search}>
            <Ionicons name="search" size={18} color={OnMedia.muted} />
            <TextInput
              style={styles.searchInput}
              placeholder="Find in playlist"
              placeholderTextColor={OnMedia.muted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoFocus
              returnKeyType="search"
            />
            <TextButton label="Cancel" onPress={() => { setIsSearchActive(false); setSearchQuery(''); }} />
          </View>
        )}
      </View>

      {/* Back to the top, once you're well down the list. */}
      <Animated.View style={[styles.fab, { bottom: bottom - Space.lg }, fabStyle]} pointerEvents="box-none">
        <IconButton icon="arrow-up" label="Back to the top" size="lg" onPress={() => flatListRef.current?.scrollToOffset({ offset: 0, animated: true })} />
      </Animated.View>

      <Sheet visible={actionsOpen} onClose={() => setActionsOpen(false)} title={playlistName}>
        <SheetOption label="Add songs" icon="add" onPress={() => { setActionsOpen(false); openAddSongs(); }} />
        {songs.length > 1 ? <SheetOption label="Edit order" icon="reorder-three-outline" onPress={() => { setActionsOpen(false); setIsEditMode(true); }} /> : null}
        <SheetOption label="Cover from your photos" icon="image-outline" onPress={handlePickCover} />
        {playlistCover ? <SheetOption label="Use the songs’ covers" icon="grid-outline" onPress={handleResetCover} /> : null}
      </Sheet>

      <Sheet visible={sortOpen} onClose={() => setSortOpen(false)} title="Sort by">
        {(Object.keys(SORT_LABELS) as Exclude<SortOption, 'recent'>[]).map(option => (
          <SheetOption
            key={option}
            label={SORT_LABELS[option]}
            hint={option === sortOption && option !== 'custom' ? (sortDirection === 'asc' ? 'Ascending · tap to reverse' : 'Descending · tap to reverse') : undefined}
            selected={option === sortOption}
            onPress={() => handleSortChange(option)}
          />
        ))}
      </Sheet>



      {songActions.element}

      <Toast visible={toast?.visible || false} message={toast?.message || ''} type={toast?.type || 'info'} onDismiss={() => setToast(null)} action={toast?.action} duration={8000} />
    </AppScreen>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Signal.bgDeep },
  wash: { position: 'absolute', top: 0, left: 0, right: 0 },
  // Keeps the cover's colours under white text.
  washShade: { backgroundColor: 'rgba(0,0,0,0.35)' },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xxs,
    paddingHorizontal: Space.xs,
    zIndex: 10,
  },
  headerBacking: { backgroundColor: Signal.bgDeep, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Glass.hairline },
  headerTitle: { flex: 1, marginHorizontal: Space.xxs, justifyContent: 'center' },
  headerTitleBox: { alignSelf: 'stretch' },
  headerTitleText: { fontSize: TypeScale.row, fontWeight: '700', color: OnMedia.primary },
  search: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    height: 40,
    paddingLeft: Space.sm,
    paddingRight: Space.xs,
    borderRadius: Radius.pill,
    backgroundColor: Glass.fillLight,
  },
  searchInput: { flex: 1, color: OnMedia.primary, fontSize: TypeScale.body, paddingVertical: 0 },
  hero: { alignItems: 'center', paddingHorizontal: GUTTER, paddingTop: Space.xs, paddingBottom: Space.sm, gap: Space.xxs },
  cover: {
    borderRadius: Radius.well,
    backgroundColor: Signal.bgSubtle,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
    elevation: 14,
    marginBottom: Space.md,
  },
  coverClip: { ...StyleSheet.absoluteFillObject, borderRadius: Radius.well, overflow: 'hidden' },
  heroTitle: { marginBottom: 2 },
  heroActions: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Space.xs, marginTop: Space.sm },
  playButton: { minWidth: 132 },
  listBar: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Space.md, paddingHorizontal: Space.xxs },
  fab: { position: 'absolute', right: GUTTER },
});

export default PlaylistDetailScreen;
