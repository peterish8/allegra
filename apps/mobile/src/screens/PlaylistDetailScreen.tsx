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
import { Share, StyleSheet, TextInput, useWindowDimensions, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
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
import { withoutCopies } from '../services/offlinePlaylistPlan';
import { OfflineControl } from '../components/playlist/OfflineControl';
import { CoverFlipCard } from '../components/playlist/CoverFlipCard';
import { ShareSheet } from '../components/share/ShareSheet';
import { coverSizeFor, FIND_BAR_HEIGHT, findFiller, PLAYLIST_WASH_STOPS, playlistLength, playlistShareText, playlistWash, settleFind } from '../components/playlist/playlistPage';
import { LIKED_PLAYLIST_ID } from '../services/sync/plan';
import { useOnlineLibraryStore } from '../store/onlineLibraryStore';
import { playerControls, usePlayerStore } from '../store/playerStore';
import { Song } from '../types/song';
import {
  Chip, ChipRow, Control, EmptyState, Glass, GUTTER, IconButton, ListRow, Motion, OnMedia, Radius, RowPlaceholder, Sheet, SheetOption, Signal, SongRow, Space, Tactile, Text, TextButton, TypeScale, useBottomClearance
} from '../ui';
import { LinearGradient } from 'expo-linear-gradient';
import { ShellFrost } from '../constants/allegraTheme';
import { countOf } from '../utils/formatters';
import { safeGoBack } from '../utils/navigationService';
import { shuffled } from '../utils/shuffle';
import * as Haptics from '../utils/haptics';
import { applySavedOrder, EDIT_ENTRY, PLAYLIST_DRAG, saveDraggedOrder } from '../components/playlist/playlistReorder';

type PlaylistDetailRouteProp = RouteProp<{ PlaylistDetail: { playlistId: string } }, 'PlaylistDetail'>;

// The drag list is never wrapped in createAnimatedComponent: the wrapper hands it a callback ref, and
// react-native-draggable-flatlist only autoscrolls through an object ref ("current" in ref), so a held
// row could not move past the first screen. It reports its scroll offset through onScrollOffsetChange.
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
  const isLiked = playlistId === LIKED_PLAYLIST_ID;
  // The cover leads the page at about 62% of the width (Spotify's).
  const { width: windowWidth } = useWindowDimensions();
  const coverSize = coverSizeFor(windowWidth);
  const bottom = useBottomClearance();

  const [songs, setSongs] = useState<Song[]>([]);
  const [playlistName, setPlaylistName] = useState('');
  // The stored name, for "Name and details" (the page shows it sentence-cased).
  const [storedName, setStoredName] = useState('');
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

  // ─── Find in playlist: hidden until you pull down ───────────────────────────
  // The list rests scrolled past the bar; a pull down scrolls it into view under the finger (the list's own scroll,
  // so it is tracked, interruptible and flings), and letting go on it opens the search with the keyboard up.
  const [listHeight, setListHeight] = useState(0);
  const [filler, setFiller] = useState(0);
  const fillerRef = React.useRef(0);
  const restedRef = React.useRef(false);

  // ─── Data ────────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      setLoadError(false);
      const playlists = await playlistQueries.getAllPlaylists();
      const playlist = playlists.find(p => p.id === playlistId);
      const playlistSongs = await playlistQueries.getPlaylistSongs(playlistId);
      setPlaylistName(playlist?.name ? displayPlaylistName(playlist.name) : 'Playlist');
      setStoredName(playlist?.name ?? '');
      setPlaylistCover(playlist?.coverImageUri || null);
      const onlineRows = playlistId === LIKED_PLAYLIST_ID
        ? useOnlineLibraryStore.getState().likes
        : await getOnlinePlaylistSongs(playlistId);
      // A streaming entry the phone holds a copy of (a downloaded playlist, or the same song saved) shows once: as
      // the copy. Ids never match across the two (a stream id vs a file's), so compare the catalog song and the key.
      const onlineSongs = withoutCopies(playlistSongs, onlineRows).map(onlineRowToSong);
      const savedOrder = await playlistQueries.getPlaylistItemOrder(playlistId);
      setSongs(applySavedOrder([...playlistSongs, ...onlineSongs], savedOrder));
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
  const wash = playlistWash(palette.primary);

  const totalLength = playlistLength(songs.reduce((acc, song) => acc + (song.duration || 0), 0));

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
    const result = await saveDraggedOrder(data.map(s => s.id), searchQuery.length > 0, {
      persist: ids => playlistQueries.updateSongOrder(playlistId, [...ids]),
      reload: loadData,
    });
    if (result === 'restored') {
      setToast({ visible: true, message: 'Could not save the new order. The saved order was restored.', type: 'error' });
    }
  }, [playlistId, searchQuery, loadData]);

  const enterEditMode = () => {
    // A drag edits the saved order, never a title sort or filtered subset.
    setSearchQuery(EDIT_ENTRY.searchQuery);
    setIsSearchActive(EDIT_ENTRY.searchActive);
    setSortOption(EDIT_ENTRY.sortOption);
    setSortDirection(EDIT_ENTRY.sortDirection);
    void saveSort(EDIT_ENTRY.sortOption, EDIT_ENTRY.sortDirection);
    setIsEditMode(true);
  };

  const onDragBegin = useCallback(() => { Haptics.toggle(); }, []);
  const onDragRelease = useCallback(() => { Haptics.tap(); }, []);
  // The drag list reports its offset on the JS thread; the header fade and the top button read scrollY.
  const onDragListScroll = useCallback((offset: number) => { scrollY.value = offset; }, [scrollY]);

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

  const go = (name: string, params: object) => (navigation as unknown as { navigate: (name: string, params: object) => void }).navigate(name, params);
  const openAddSongs = () => go('AddToPlaylist', { playlistId });
  // Spotify's "Name and details": the same screen that names a new playlist, opened on this one.
  const openNameAndDetails = () => go('CreatePlaylist', { playlistId, initialName: storedName });
  const [shareOpen, setShareOpen] = useState(false);

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
  // Where the big title sits: under the Find bar and the cover on a playlist, near the top on Liked songs.
  const titleAt = isLiked ? 40 : coverSize;
  const headerBacking = useAnimatedStyle(() => ({ opacity: interpolate(scrollY.value, [titleAt * 0.6, titleAt + 40], [0, 1], Extrapolation.CLAMP) }));
  const headerTitle = useAnimatedStyle(() => ({ opacity: interpolate(scrollY.value, [titleAt + 20, titleAt + 80], [0, 1], Extrapolation.CLAMP) }));
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

  // 1.43.0 (owner's Spotify screenshot): Liked songs has no cover. A forest-green wash runs from the top of the
  // screen into the page's black under a big left-aligned title, then download and sort on the left and a big round
  // Play on the right, then "Add to this playlist". Other playlists keep their cover header.
  const renderLikedHeader = () => (
    <View style={styles.likedHero}>
      <LinearGradient pointerEvents="none" colors={ShellFrost.likedWashColors} locations={ShellFrost.likedWashStops}
        start={ShellFrost.likedWashStart} end={ShellFrost.likedWashEnd} style={StyleSheet.absoluteFill} />
      <View style={{ height: topInset }} />
      {loadError ? <View><Text variant="secondary" tone="secondary">Couldn’t refresh this playlist. Saved songs are still here.</Text><TextButton label="Try again" onPress={() => { loadData(); }} /></View> : null}
      {/* 1.44.0 (owner: "a lil too big"): Spotify's sizes — a 28pt title, icon-sized tools, a 48dp Play. */}
      <Text variant="page" numberOfLines={2} accessibilityRole="header">{playlistName}</Text>
      <Text variant="secondary" tone="secondary" tabular>{countOf(songs.length, 'song')}</Text>
      <View style={styles.likedActions}>
        <View style={styles.tools}>
          <OfflineControl iconOnly playlistId={playlistId} name={playlistName} songs={songs} onChanged={loadData}
            onNotice={message => setToast({ visible: true, message, type: 'info' })} />
          {songs.length > 0 ? <IconButton icon="swap-vertical" label={`Sort liked songs, ${sortLabel}`} variant="plain" onPress={() => setSortOpen(true)} /> : null}
        </View>
        {songs.length > 0 ? (
          <View style={styles.tools}>
            <IconButton icon="shuffle" label="Shuffle liked songs" variant="plain" onPress={shufflePlaylist} haptic="select" />
            {renderRoundPlay('liked songs')}
          </View>
        ) : null}
      </View>
      {isEditMode ? <TextButton label="Done" tone="accent" onPress={() => setIsEditMode(false)} /> : (
        <ListRow title="Add to this playlist" icon="add" onPress={openAddSongs} style={styles.likedAdd} />
      )}
    </View>
  );

  // Spotify's big round Play, white here (the one filled control on the page).
  const renderRoundPlay = (what: string) => (
    <Tactile onPress={playOrPause} haptic="light" pressScale={0.94} accessibilityRole="button"
      accessibilityLabel={playingHere ? `Pause ${what}` : activeIsPlaying ? `Resume ${what}` : `Play ${what}`} style={styles.roundPlay}>
      <Ionicons name={playingHere ? 'pause' : 'play'} size={22} color={Signal.waveInk} style={playingHere ? undefined : styles.roundPlayGlyph} />
    </Tactile>
  );

  // The cover leads as on an album: the playlist's own, else a mosaic of four of its songs, as on the website.
  const coverFace = !playlistCover && songs.length >= 4 ? (
    <MosaicCover songs={songs.slice(0, 4)} size={coverSize} />
  ) : headerImageUri ? (
    <Image source={{ uri: headerImageUri }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={0} />
  ) : (
    <Artwork title={playlistName} size={coverSize} style={StyleSheet.absoluteFill} />
  );

  // 1.44.0 (owner's Spotify screenshots): Find in playlist, the cover centred over its own colour, the name on the left,
  // its length, then download and share on the left with shuffle and a round Play on the right, then Add / Edit /
  // Name and details / Sort as chips. The cover turns over into song cards on a double tap (CoverFlipCard).
  const renderPlaylistHeader = () => (
    <View style={styles.page}>
      <LinearGradient pointerEvents="none" colors={wash} locations={PLAYLIST_WASH_STOPS}
        style={[styles.pageWash, { height: topInset + FIND_BAR_HEIGHT + coverSize + Space.xxl * 2 }]} />
      <View style={{ height: topInset }} />
      {!isEditMode ? (
        <Tactile onPress={() => setIsSearchActive(true)} accessibilityRole="search" accessibilityLabel="Find in playlist" style={styles.findBar} wrapperStyle={styles.findTarget}>
          <Ionicons name="search" size={18} color={OnMedia.primary} />
          <Text variant="label">Find in playlist</Text>
        </Tactile>
      ) : null}
      <View style={styles.coverRow}>
        <CoverFlipCard size={coverSize} front={coverFace} name={playlistName} songs={filteredSongs}
          playingId={currentSongId} playingHere={activeIsPlaying} onPick={index => handleSongPress(filteredSongs[index], index)} />
      </View>
      {loadError ? <View><Text variant="secondary" tone="secondary">Couldn’t refresh this playlist. Saved songs are still here.</Text><TextButton label="Try again" onPress={() => { loadData(); }} /></View> : null}
      <Text variant="page" numberOfLines={2} accessibilityRole="header">{playlistName}</Text>
      <View style={styles.metaLine}>
        <Ionicons name="time-outline" size={16} color={OnMedia.muted} />
        <Text variant="secondary" tone="secondary" tabular>{countOf(songs.length, 'song')}{totalLength ? ` · ${totalLength}` : ''}</Text>
      </View>
      <View style={styles.likedActions}>
        <View style={styles.tools}>
          {/* 1.41.0: download the whole playlist to play it with no connection (Spotify's glyph since 1.44.0). */}
          <OfflineControl iconOnly playlistId={playlistId} name={playlistName} songs={songs} onChanged={loadData}
            onNotice={message => setToast({ visible: true, message, type: 'info' })} />
          <IconButton icon="share-social-outline" label="Share playlist" variant="plain" onPress={() => setShareOpen(true)} />
        </View>
        {songs.length > 0 ? (
          <View style={styles.tools}>
            <IconButton icon="shuffle" label="Shuffle playlist" variant="plain" onPress={shufflePlaylist} haptic="select" />
            {renderRoundPlay('playlist')}
          </View>
        ) : null}
      </View>
      <ChipRow gutter={GUTTER} style={styles.chips}>
        <Chip label="Add" icon="add" onPress={openAddSongs} accessibilityLabel="Add songs" />
        {songs.length > 1 || isEditMode ? (
          <Chip label={isEditMode ? 'Done' : 'Edit'} icon={isEditMode ? undefined : 'reorder-three-outline'} selected={isEditMode}
            onPress={isEditMode ? () => setIsEditMode(false) : enterEditMode} accessibilityLabel={isEditMode ? 'Done editing the order' : 'Edit the order'} />
        ) : null}
        <Chip label="Name and details" icon="pencil-outline" onPress={openNameAndDetails} />
        {songs.length > 0 ? <Chip label={sortOption === 'custom' || sortOption === 'recent' ? 'Sort' : sortLabel} icon="swap-vertical"
          onPress={() => setSortOpen(true)} accessibilityLabel={`Sort playlist, ${sortLabel}`} /> : null}
      </ChipRow>
    </View>
  );

  const renderHeader = () => isLiked ? renderLikedHeader() : renderPlaylistHeader();

  const renderEmpty = () => (loading ? (
    <View>{[0, 1, 2, 3, 4].map(i => <RowPlaceholder key={i} />)}</View>
  ) : loadError ? (
    <EmptyState icon="cloud-offline-outline" title="Couldn?t load this playlist" body="Check your connection and try again." action={{ label: 'Try again', onPress: () => { loadData(); } }} />
  ) : searchQuery ? (
    <EmptyState icon="search" title="No songs match" body={`Nothing in this playlist matches “${searchQuery}”.`} />
  ) : (
    <EmptyState icon="musical-notes-outline" title="No songs yet" body="Add songs you saved or streamed." action={{ label: 'Add songs', icon: 'add', onPress: openAddSongs }} />
  ));

  const hasFindBar = !isLiked && !isEditMode;
  const onListContent = useCallback((_w: number, h: number) => {
    const next = hasFindBar ? findFiller(listHeight, h - fillerRef.current) : 0;
    if (next !== fillerRef.current) { fillerRef.current = next; setFiller(next); }
    if (!restedRef.current && hasFindBar && listHeight > 0 && h - listHeight >= FIND_BAR_HEIGHT) {
      restedRef.current = true;
      flatListRef.current?.scrollToOffset({ offset: FIND_BAR_HEIGHT, animated: false });
    }
  }, [hasFindBar, listHeight]);
  const settleList = useCallback((offset: number, velocity: number) => {
    if (!hasFindBar) return;
    const action = settleFind(offset, velocity);
    if (action === 'rest') return;
    if (action === 'reveal' && !isSearchActive) { Haptics.tap(); setIsSearchActive(true); }
    flatListRef.current?.scrollToOffset({ offset: FIND_BAR_HEIGHT, animated: true });
  }, [hasFindBar, isSearchActive]);

  const listProps = {
    ref: flatListRef,
    onLayout: (e: LayoutChangeEvent) => setListHeight(e.nativeEvent.layout.height),
    onContentSizeChange: onListContent,
    onScrollEndDrag: (e: NativeSyntheticEvent<NativeScrollEvent>) => settleList(e.nativeEvent.contentOffset.y, e.nativeEvent.velocity?.y ?? 0),
    onMomentumScrollEnd: (e: NativeSyntheticEvent<NativeScrollEvent>) => settleList(e.nativeEvent.contentOffset.y, 0),
    ListFooterComponent: filler > 0 ? <View style={{ height: filler }} /> : null,
    data: filteredSongs,
    keyExtractor: (item: Song) => item.id,
    onScroll: scrollHandler,
    scrollEventThrottle: 16,
    // Both headers' washes start at the very top of the screen, so each carries the top inset itself.
    contentContainerStyle: { paddingBottom: bottom },
    ListHeaderComponent: renderHeader(),
    ListEmptyComponent: renderEmpty(),
  };
  // The drag list owns its onScroll (its autoscroll reads it) and needs the object ref itself.
  const dragListProps = { ...listProps, onScroll: undefined };

  return (
    <AppScreen style={styles.container}>

      {/* One list in both modes: a draggable one while editing (it keeps its rows), FlashList otherwise. */}
      {!isEditMode ? (
        <AnimatedFlashList
          {...listProps}
          renderItem={({ item, index }: { item: Song; index: number }) => renderItem({ item, getIndex: () => index, drag: () => undefined, isActive: false } as unknown as RenderItemParams<Song>)}
        />
      ) : (
        <DraggableFlatList
          {...dragListProps}
          activationDistance={PLAYLIST_DRAG.activationDistance}
          autoscrollThreshold={PLAYLIST_DRAG.autoscrollThreshold}
          autoscrollSpeed={PLAYLIST_DRAG.autoscrollSpeed}
          onScrollOffsetChange={onDragListScroll}
          dragItemOverflow
          onDragBegin={onDragBegin}
          onRelease={onDragRelease}
          onDragEnd={handleDragEnd}
          renderItem={renderItem}
        />
      )}

      {/* The header: clear at rest, a solid backing once the list passes under it. */}
      <View style={[styles.header, { paddingTop: insets.top, height: topInset }]}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.headerBacking, headerBacking]} pointerEvents="none" />
        {!isSearchActive ? (
          <>
            {/* Plain back arrow and ⋮ over the wash (owner, 2026-11-13: no round disc). Find sits above the cover, hidden until you pull down (and here on Liked songs). */}
            <IconButton icon="arrow-back" label="Back" variant="plain" onPress={() => safeGoBack(navigation)} />
            <Animated.View style={[styles.headerTitle, headerTitle]}>
              <Marquee text={playlistName} style={styles.headerTitleText} active={isFocused} containerStyle={styles.headerTitleBox} />
            </Animated.View>
            {isLiked ? <IconButton icon="search" label="Find in playlist" variant="plain" onPress={() => setIsSearchActive(true)} /> : null}
            <IconButton icon="ellipsis-vertical" label="Playlist options" variant="plain" onPress={() => setActionsOpen(true)} />
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
        {!isLiked ? <SheetOption label="Share" icon="share-social-outline" onPress={() => { setActionsOpen(false); setShareOpen(true); }} /> : null}
        {songs.length > 1 ? <SheetOption label="Edit order" icon="reorder-three-outline" onPress={() => { setActionsOpen(false); enterEditMode(); }} /> : null}
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

      <ShareSheet visible={shareOpen} onClose={() => setShareOpen(false)}
        target={{ kind: 'playlist', playlistId, name: playlistName, cover: headerImageUri ?? null, tint: palette.primary, songs }} />

      <Toast visible={toast?.visible || false} message={toast?.message || ''} type={toast?.type || 'info'} onDismiss={() => setToast(null)} action={toast?.action} duration={8000} />
    </AppScreen>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Signal.bgDeep },
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
  likedHero: { paddingHorizontal: GUTTER, paddingBottom: Space.sm, gap: Space.xxs },
  likedActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Space.md },
  // Icon tools sit close together, Spotify's spacing (each still a 48dp target).
  tools: { flexDirection: 'row', alignItems: 'center', gap: Space.xxs, flexShrink: 1 },
  // 1.44.0 (owner: "a lil too big"): a 48dp Play, Spotify's size, not 56.
  roundPlay: { width: Control.target, height: Control.target, borderRadius: Control.target / 2, backgroundColor: Signal.wave, alignItems: 'center', justifyContent: 'center' },
  // The play triangle's visual centre sits right of its box: nudge it so it reads centred in the disc.
  roundPlayGlyph: { marginLeft: 2 },
  likedAdd: { marginTop: Space.sm, marginHorizontal: -GUTTER },
  page: { paddingHorizontal: GUTTER, paddingBottom: Space.xs, gap: Space.xxs },
  pageWash: { position: 'absolute', top: 0, left: 0, right: 0 },
  // Spotify's search field: a light frosted bar, drawn 40 in a 48 touch row.
  findTarget: { alignSelf: 'stretch', height: FIND_BAR_HEIGHT, justifyContent: 'center' },
  findBar: { height: 40, flexDirection: 'row', alignItems: 'center', gap: Space.xs, paddingHorizontal: Space.sm, borderRadius: Radius.cover, backgroundColor: Glass.capsule },
  coverRow: { alignItems: 'center', marginTop: Space.lg, marginBottom: Space.lg },
  metaLine: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  chips: { marginHorizontal: -GUTTER, marginTop: Space.xs },
  fab: { position: 'absolute', right: GUTTER },
});

export default PlaylistDetailScreen;
