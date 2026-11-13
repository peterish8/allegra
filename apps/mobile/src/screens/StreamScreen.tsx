import { AppScreen } from '../components/AppScreen';
import { TypeScale } from '../constants/allegraTheme';
/**
 * Stream: pinned title/device/update controls above a scrolling, typed home feed.
 * The current cover supplies the static glow. Songs retain the existing streaming,
 * download and action handlers; collection cards open real mix pages.
 */
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  useWindowDimensions,
  Keyboard,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Toast } from '../components/Toast';
import { ProfileButton } from '../components/nav/ProfileButton';
import { InfoTour } from '../components/allegra/InfoTour';
import { AuraMood } from '../components/allegra/MusicFlowField';
import { PrimaryButton, SectionHeading } from '../components/allegra/home';
import { STREAM_TOUR, streamScene } from '../components/allegra/infoTours';
import { RiseIn } from '../components/allegra/motion';
import { Control } from '../ui';
import { useHeaderGlow } from '../hooks/useHeaderGlow';
import { BrowseShelf } from '../components/browse/BrowseShelf';
import { ConnectDropdown } from '../components/connect/ConnectDropdown';
import { GUTTER, MoodChips, QuickPicks, ShortcutGrid, SongRow, TrackItem } from '../components/stream/StreamHome';
import { RecentShelf, RecentSwitch } from '../components/stream/RecentShelf';
import { ShimmerBlock } from '../components/stream/StreamItems';
import { recentPlaylists, type RecentView } from '../services/stream/recentItems';
import { usePlaylistStore } from '../store/playlistStore';
import { useStreamSongActions } from '../components/stream/useStreamSongActions';
import { Glass, Radius, Signal, Space, Surface } from '../constants/allegraTheme';
import { useBottomClearance } from '../hooks/useBottomClearance';
import { isDoubleTap } from '../navigation/tabs';
import { useLiveQuickPicks } from '../hooks/useLiveQuickPicks';
import { useAccount } from '../services/account/AccountProvider';
import { tasteSeeds } from '../services/luvsTaste';
import { StreamService } from '../services/stream/StreamService';
import { playYTSongs, resolveYTSong } from '../services/stream/browsePlay';
import { catalogShelfTitle } from '../services/stream/shelfTitles';
import { preloadedFeedCache, preloadFeedCache, writeFeedCache } from '../services/stream/feedCache';
import { buildHomeFeed, HomeFeed } from '../services/stream/homeFeed';
import { shouldLoadMoreHome } from '../services/stream/homePagination';
import { moodRecommendations } from '../services/stream/moodRecommendations';
import { Taste } from '../services/stream/moodMix';
import { searchOfficial } from '../services/stream/officialSearch';
import { recommendFor } from '../services/stream/recommend';
import { streamIdFor } from '../services/stream/streamSong';
import { YTMusicClient } from '../services/ytmusic/YTMusicClient';
import { HomeChip, HomePage, leadArtist, Shelf, YTItem, YTPageItem } from '../services/ytmusic/browse';
import { YTSong } from '../services/ytmusic/parsers';
import { useDownloadQueueStore } from '../store/downloadQueueStore';
import { useFollowedArtistsStore } from '../store/followedArtistsStore';
import { useLuvsPreferencesStore } from '../store/luvsPreferencesStore';
import { usePlayerStore } from '../store/playerStore';
import { useSongsStore } from '../store/songsStore';
import { useStreamHistoryStore } from '../store/streamHistoryStore';
import { TabParamList, type MixParams } from '../types/navigation';
import { UnifiedSong } from '../types/song';
import { Button, CollectionCard, HeaderGlow, IconButton, identityMeta, Sheet, SheetDivider, SheetIdentity, SheetOption, Text as UiText } from '../ui';
import { countOf } from '../utils/formatters';
import * as Haptics from '../utils/haptics';
import { shuffled } from '../utils/shuffle';

const HEADER_HEIGHT = 52;
const HOME_END_THRESHOLD = 0.6;
const MOODS = [
  { label: 'Chill', query: 'chill lofi' },
  { label: 'Energy', query: 'workout hits' },
  { label: 'Romance', query: 'romantic hits' },
  { label: 'Focus', query: 'instrumental focus' },
  { label: 'Party', query: 'party hits' },
  { label: 'Heartbreak', query: 'sad songs' },
] as const;
const MOOD_LABELS = MOODS.map(m => m.label);


type StreamSection = { id: string; kind: 'content' | 'home-content'; content: React.ReactNode };

const StreamScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const navigation = useNavigation<BottomTabNavigationProp<TabParamList>>();
  const localSongs = useSongsStore(s => s.songs);
  const history = useStreamHistoryStore(s => s.plays);
  const languages = useLuvsPreferencesStore(s => s.preferredLanguages);
  const currentSongId = usePlayerStore(s => s.currentSongId);
  const addToDownloads = useDownloadQueueStore(s => s.addToQueue);
  const account = useAccount();
  const isFocused = useIsFocused();

  // The page kept from last time, already read during launch: the first frame shows it, not placeholders.
  const [feed, setFeed] = useState<HomeFeed | null>(() => preloadedFeedCache()?.feed ?? null);
  const [loading, setLoading] = useState(() => !preloadedFeedCache()?.feed);
  const [refreshing, setRefreshing] = useState(false);
  const livePicks = useLiveQuickPicks(feed?.quickPicks, !!feed);
  const [recentView, setRecentView] = useState<RecentView>('songs');
  const playlists = usePlaylistStore(s => s.playlists);
  const [toast, setToast] = useState<string | null>(null);
  const [mood, setMood] = useState<string | null>(null);

  // Double-tap the Stream tab: straight to the search field with the keyboard
  // up. The first tap still switches tabs at once — nothing waits on a timer.
  const scrollRef = useRef<FlashListRef<StreamSection>>(null);
  const didUserScroll = useRef(false);
  const distanceFromEnd = useRef(Number.POSITIVE_INFINITY);
  const viewportHeight = useRef(0);
  const homeGeneration = useRef(0);
  const continuationGeneration = useRef(0);
  const homeMoreRequest = useRef<string | null>(null);
  const resetHomePagination = useCallback(() => {
    didUserScroll.current = false;
    distanceFromEnd.current = Number.POSITIVE_INFINITY;
    viewportHeight.current = 0;
  }, []);
  const lastTabPress = useRef(0);
  // A tap on the Stream tab is "take me home": any search or mood view clears and the page goes to the top.
  const backHome = useRef<() => void>(() => {});
  useEffect(() => navigation.addListener('tabPress', () => {
    backHome.current();
    const now = Date.now();
    if (isDoubleTap(lastTabPress.current, now)) {
      lastTabPress.current = 0;
      Haptics.selectionAsync().catch(() => {});
      didUserScroll.current = false;
      scrollRef.current?.scrollToOffset({ offset: 0, animated: true });
      // After the tab switch has settled, or focus is lost to the transition.
      navigation.navigate('Search');
    } else {
      lastTabPress.current = now;
    }
  }), [navigation]);

  // Settings mounts lazily and its first open showed one empty frame while it
  // laid out; once launch has settled, build it in the background instead.
  useEffect(() => {
    const t = setTimeout(() => navigation.preload('Settings'), 8000);
    return () => clearTimeout(t);
  }, [navigation]);

  // YouTube Music's own home (Echo's feed): mood chips and shelves.
  const [ytHome, setYtHome] = useState<HomePage | null>(() => preloadedFeedCache()?.home ?? null);
  const ytHomeRef = useRef(ytHome);
  ytHomeRef.current = ytHome;
  const [pendingSong, setPendingSong] = useState<string | null>(null);
  const followed = useFollowedArtistsStore(s => s.artists);


  // The last page opens at once from the phone (services/stream/feedCache) while the network answers; whichever
  // half has already arrived fresh is never replaced by the cached one.
  const freshFeed = useRef(false);
  const freshHome = useRef(false);
  useEffect(() => {
    let alive = true;
    preloadFeedCache().then(cached => {
      if (!alive || !cached) return;
      if (cached.feed && !freshFeed.current) {
        setFeed(cached.feed);
        setLoading(false);
      }
      if (cached.home && !freshHome.current) {
        ytHomeRef.current = cached.home;
        setYtHome(cached.home);
      }
    });
    return () => { alive = false; };
  }, []);

  const loadYtHome = useCallback(async () => {
    const generation = ++homeGeneration.current;
    continuationGeneration.current++;
    const first = await YTMusicClient.home().catch(() => null);
    if (!first || generation !== homeGeneration.current) return;
    freshHome.current = true;
    ytHomeRef.current = first;
    setYtHome(first);
    writeFeedCache(null, first);
  }, []);
  useEffect(() => { loadYtHome(); }, [loadYtHome]);

  const openItem = useCallback((item: Exclude<YTItem, { kind: 'song' }>) => {
    if (item.kind === 'artist') navigation.navigate('Browse', { screen: 'Artist', params: { browseId: item.browseId } });
    else navigation.navigate('Browse', { screen: 'Collection', params: { browseId: item.browseId, title: item.title, thumbnail: item.thumbnail } });
  }, [navigation]);

  const playYT = useCallback(async (songs: YTSong[], index: number) => {
    Haptics.selectionAsync().catch(() => {});
    setPendingSong(songs[index]?.videoId ?? null);
    const ok = await playYTSongs(songs, index);
    setPendingSong(null);
    if (!ok) setToast('That one isn\u2019t available to stream');
  }, []);

  const preferred = useMemo(
    () => [...languages].filter(l => l.weight > 0).sort((a, b) => b.weight - a.weight).map(l => l.language),
    [languages],
  );

  // History changes on every stream — read it at load time instead of rebuilding
  // the feed (and refetching radio) each time a song starts.
  const historyRef = useRef(history);
  historyRef.current = history;
  const localRef = useRef(localSongs);
  localRef.current = localSongs;

  // "Your <mood> mix": the chip's mood by the artists you follow and play,
  // in your languages (services/stream/moodMix).
  const [moodError, setMoodError] = useState(false);
  const [moodPersonalized, setMoodPersonalized] = useState(false);
  const [moodMix, setMoodMix] = useState<YTSong[] | null>(null);
  const mixSeq = useRef(0);
  const loadMoodMix = useCallback((label: string) => {
    const seq = ++mixSeq.current;
    setMoodMix(null);
    setMoodError(false);
    const seen = new Set<string>();
    const artistsInOrder = [
      ...followed.map(a => a.name),
      ...tasteSeeds(historyRef.current, localRef.current, Date.now(), 8).map(s => leadArtist(s.artist)),
    ].filter(a => a && !/^unknown artist$/i.test(a) && !seen.has(a.toLowerCase()) && seen.add(a.toLowerCase()));
    const taste: Taste = { artists: artistsInOrder, languages: preferred };
    moodRecommendations(label, taste, q => YTMusicClient.searchSongs(q))
      .then(result => { if (seq === mixSeq.current) { setMoodMix(result.songs); setMoodPersonalized(result.personalized); } })
      .catch(() => { if (seq === mixSeq.current) { setMoodMix([]); setMoodError(true); } });
  }, [followed, preferred]);

  const loadFeed = useCallback(async () => {
    const next = await buildHomeFeed(
      { localSongs: localRef.current, history: historyRef.current, languages: preferred },
      { searchMusic: q => searchOfficial(q), recommend: seed => recommendFor(seed, 12) },
    ).catch(() => null);
    // A failed refresh keeps the page that is showing (cached or earlier) instead of blanking it.
    if (!next) return;
    freshFeed.current = true;
    setFeed(next);
    writeFeedCache(next, null);
  }, [preferred]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    loadFeed().finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [loadFeed]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadFeed(), livePicks.refresh(true)]);
    setRefreshing(false);
  }, [loadFeed, livePicks.refresh]);

  const play = useCallback((list: UnifiedSong[], index: number) => {
    Haptics.selectionAsync().catch(() => {});
    StreamService.play(list, index);
  }, []);

  // One song's Download button (Round 7 item 9 restores it beside the ⋮ on Stream and Search rows).
  const save = useCallback((song: UnifiedSong) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    addToDownloads([song]);
    setToast(`Saving \u201c${song.title}\u201d to your library`);
  }, [addToDownloads]);

  // A long press opens the song's actions (Play next first), as everywhere in the app.
  const songActions = useStreamSongActions({ onDone: setToast });
  const queueNext = songActions.open;
  // A long press on a YouTube Music song: its catalog audio first (the same lookup a tap makes), then the sheet.
  const openSongActions = songActions.open;
  const ytActions = useCallback(async (song: YTSong) => {
    setPendingSong(song.videoId);
    const resolved = await resolveYTSong(song);
    setPendingSong(null);
    if (resolved) openSongActions(resolved);
    else setToast('That one isn’t available to stream');
  }, [openSongActions]);
  const [mixActions, setMixActions] = useState<MixParams | null>(null);
  const openMix = useCallback((mix: MixParams) => navigation.navigate('Browse', { screen: 'Mix', params: mix }), [navigation]);
  const playMix = useCallback((mix: MixParams, random = false) => {
    setMixActions(null);
    if (mix.kind === 'stream') StreamService.play(random ? shuffled(mix.songs) : mix.songs, 0);
    else usePlayerStore.getState().setPlaylistQueue(`mix:${mix.title}`, random ? shuffled(mix.songs) : mix.songs, 0);
  }, []);


    const openDownloads = useCallback(() => {
    // Downloads are the Library tab now.
    navigation.navigate('Library', { screen: 'LibraryHome' });
  }, [navigation]);

  const ytChips = useMemo(() => ytHome?.chips ?? [], [ytHome]);
  const selectMood = useCallback((label: string | null) => {
    Haptics.selectionAsync().catch(() => {});
    mixSeq.current++;
    setMood(label);
    setMoodError(false);
    if (label) loadMoodMix(label);
    else setMoodMix(null);
  }, [loadMoodMix]);

  // Clear the tab bar pill plus the mini player pill stacked above it (only while a song is loaded).
  const bottomClearance = useBottomClearance(Space.lg);


  // The shader takes its colours from whatever is playing (or the top pick).

  const onScrollBeginDrag = useCallback(() => { didUserScroll.current = true; }, []);
  // The header glow leaves and returns with the feed's own scroll offset.
  const glow = useHeaderGlow();
  const glowScrolled = glow.onScroll;
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    distanceFromEnd.current = Math.max(0, contentSize.height - contentOffset.y - layoutMeasurement.height);
    viewportHeight.current = layoutMeasurement.height;
    glowScrolled(contentOffset.y);
  }, [glowScrolled]);
  const loadMoreHome = useCallback(async () => {
    const current = ytHomeRef.current;
    const continuation = current?.continuation;
    const generation = homeGeneration.current;
    const pageGeneration = continuationGeneration.current;
    const requestId = `${generation}:${pageGeneration}:${continuation ?? ''}`;
    if (!continuation || !shouldLoadMoreHome({
      hasScrolled: didUserScroll.current,
      hasContinuation: true,
      isLoading: homeMoreRequest.current !== null,
      distanceFromEnd: distanceFromEnd.current,
      nearEndThreshold: viewportHeight.current * HOME_END_THRESHOLD,
      searchActive: false,
      chipActive: false,
    })) return;

    homeMoreRequest.current = requestId;
    try {
      const more = await YTMusicClient.homeMore(continuation);
      const latest = ytHomeRef.current;
      if (
        !latest
        || generation !== homeGeneration.current
        || pageGeneration !== continuationGeneration.current
        || latest.continuation !== continuation
      ) return;

      const next = { ...latest, shelves: [...latest.shelves, ...more.shelves], continuation: more.continuation };
      ytHomeRef.current = next;
      setYtHome(next);
    } catch {
      // Keep the current shelves and continuation; another scroll can retry.
    } finally {
      if (homeMoreRequest.current === requestId) homeMoreRequest.current = null;
    }
  }, []);
  // loadMoreHome catches its own failures; the catch only satisfies the floating promise.
  const onEndReached = useCallback(() => { loadMoreHome().catch(() => undefined); }, [loadMoreHome]);

  backHome.current = () => {
    if (isFocused) {
      didUserScroll.current = false;
      scrollRef.current?.scrollToOffset({ offset: 0, animated: false });
    }
  };

  // The shelves below are memoised on what they show: a keystroke in search, the scroll, or lyrics landing for the
  // playing song re-render this page, and every shelf used to rebuild its items each time.
  const track = useCallback((s: UnifiedSong): TrackItem => ({
    key: streamIdFor(s),
    title: s.title,
    artist: s.artist,
    artwork: s.highResArt,
    isCurrent: currentSongId === streamIdFor(s),
    download: s,
  }), [currentSongId]);



  const followedShelf: Shelf | null = useMemo(() => (followed.length > 0
    ? { title: 'Your artists', items: followed.map(a => ({ kind: 'artist' as const, browseId: a.browseId, title: a.name, thumbnail: a.thumbnail })) }
    : null), [followed]);

  // Memoised so the list's sections below are not rebuilt on every render of the page.
  const mixSection = useMemo(() => mood ? (
    <View style={{ minHeight: Control.row * (8 * fontScale + 2) }}>
      <RiseIn key={`${mood}:${moodMix === null ? 'loading' : moodError ? 'error' : 'results'}`}>
      {moodMix === null ? <>
        <SectionHeading title={`${mood} picks`} />
        <View style={styles.skeleton}>{[0, 1, 2, 3].map(i => <ShimmerBlock key={i} width="100%" height={64} />)}</View>
      </> : moodError ? <View style={styles.emptyCard}>
        <UiText variant="lead">Could not load {mood.toLowerCase()} picks</UiText>
        <UiText tone="secondary">Check your connection and try again.</UiText>
        <Button label="Try again" onPress={() => loadMoodMix(mood)} />
      </View> : moodMix.length ? <BrowseShelf
        shelf={{ title: `${mood} picks`, strapline: moodPersonalized ? 'Based on artists and languages you listen to' : 'Songs for this mood', items: moodMix.map(song => ({ kind: 'song' as const, song })) }}
        rows maxRows={8} onOpen={openItem} onPlay={playYT} pendingId={pendingSong}
      /> : <View style={styles.emptyCard}><UiText>No songs found. Try another mood.</UiText></View>}
      </RiseIn>
    </View>
  ) : null, [fontScale, mood, moodMix, moodError, moodPersonalized, loadMoodMix, openItem, playYT, pendingSong]);

  const homeSections = useMemo(() => {
    const sections: StreamSection[] = [];
    const add = (id: string, content: React.ReactNode) => sections.push({ id, kind: 'home-content', content });
    const listenAgain = feed?.keepListening.slice(0, 6) ?? [];
    const recentLists = recentPlaylists(playlists);
    if (listenAgain.length || recentLists.length) {
      add('jump-back-in', <>
        <SectionHeading title="Jump back in" />
        <RecentShelf
          view={recentView}
          songs={listenAgain.map(track)}
          playlists={recentLists.map(list => ({ key: `playlist:${list.id}`, title: list.name,  artwork: list.coverImageUri, isCurrent: false }))}
          onPressSong={i => play(listenAgain, i)}
          onLongPressSong={i => queueNext(listenAgain[i])}
          onPressPlaylist={i => navigation.navigate('Library', { screen: 'PlaylistDetail', params: { playlistId: recentLists[i].id } })}
        />
      </>);
    }
    const quick = livePicks.entry?.songs ?? feed?.quickPicks ?? [];
    if (quick.length) add('quick-picks', <><SectionHeading title="Quick picks" action="Open playlist" onAction={() => navigation.navigate('Browse', { screen: 'QuickPicks' })} /><QuickPicks items={quick.map(track)} onPress={i => play(quick, i)} onLongPress={i => queueNext(quick[i])} onSave={i => save(quick[i])} /></>);
    const mixes: MixParams[] = [];
    if (feed?.dailyDiscover.length) mixes.push({ title: 'Daily discover', kind: 'stream', songs: feed.dailyDiscover.map(item => item.recommendation) });
    for (const related of feed?.similar ?? []) if (related.songs.length) mixes.push({ title: `More like ${related.artist}`, kind: 'stream', songs: related.songs });
    if (feed?.forgottenFavorites.length) mixes.push({ title: 'Forgotten favourites', kind: 'local', songs: feed.forgottenFavorites });
    if (mixes.length) add('made-for-you', <><SectionHeading title="Made for you" /><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: GUTTER, gap: Space.sm }}>
      {mixes.map(mix => <CollectionCard key={mix.title} title={mix.title} meta={`Mix · ${mix.songs.length} songs`} uri={mix.kind === 'stream' ? mix.songs[0].highResArt : mix.songs[0].coverImageUri} onPress={() => openMix(mix)} onActions={() => setMixActions(mix)} />)}
    </ScrollView></>);
    if (followedShelf) add('your-artists', <BrowseShelf shelf={followedShelf} onOpen={openItem} onPlay={playYT} onSongActions={ytActions} />);
    // YouTube Music's own "Quick picks" sits under ours: it gets a title of its own (shelfTitles).
    const ours = ['Jump back in', quick.length ? 'Quick picks' : '', mixes.length ? 'Made for you' : '', followedShelf?.title ?? ''];
    (ytHome?.shelves ?? []).forEach((shelf, index) => add(`catalog:${index}:${shelf.title}`,
      <BrowseShelf shelf={{ ...shelf, title: catalogShelfTitle(shelf.title, ours) }} onOpen={openItem} onPlay={playYT} pendingId={pendingSong} onSongActions={ytActions} />));
    if (loading && !quick.length && !ytHome?.shelves.length) add('loading', <View style={styles.skeleton}>{[0, 1, 2, 3].map(i => <ShimmerBlock key={i} width="100%" height={64} />)}</View>);
    if (!loading && !quick.length && !ytHome?.shelves.length) add('catalog-unavailable', <View style={styles.emptyCard}><UiText variant="lead">Can\u2019t reach the catalog</UiText><UiText tone="secondary">Pull down to try again. Your saved songs still play.</UiText><PrimaryButton label="Open Library" icon="library-outline" onPress={openDownloads} /></View>);
    return sections;
  }, [feed, track, play, queueNext, livePicks.entry, save, openMix, followedShelf, openItem, playYT, ytActions, ytHome, pendingSong, loading, openDownloads, playlists, recentView, navigation]);

  // The mood chips are the feed's first item, not a ListHeaderComponent: FlashList places its first item from the
  // header's measured offset, and a header that settled after that offset was read drew "Jump back in" over the
  // chips (owner report, 2026-11-06). As an item, the chips are measured like every other section.
  const moodLabels = ytChips.length > 0 ? ytChips.map(c => c.title) : MOOD_LABELS;
  const moodKey = moodLabels.join('|');
  const moodsSection = useMemo<StreamSection>(() => ({
    id: 'moods',
    kind: 'content',
    content: <View style={styles.chips}><MoodChips moods={moodLabels} selected={mood} onSelect={selectMood} /></View>,
    // moodLabels is described by moodKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [moodKey, mood, selectMood]);
  const sections = useMemo(() => [moodsSection, ...(mixSection ? [{ id: 'inline-mood', kind: 'content' as const, content: mixSection }] : []), ...homeSections], [moodsSection, mixSection, homeSections]);
  const renderSection = useCallback(({ item }: { item: StreamSection }) => <View>{item.content}</View>, []);

  return (
    <AppScreen style={styles.screen} staticGlow={false}>
      <HeaderGlow {...glow.props} />
      {/* Keep the update entry reachable while feed sections hydrate or scroll. */}
      <View style={{ paddingTop: insets.top + Space.xs }}>
        <View style={styles.header}>
          {/* 1.42.0 (Spotify's place): your picture opens the profile menu, where About and updates now live. */}
          <View style={styles.headerLead}>
            <ProfileButton />
            <RecentSwitch view={recentView} onChange={setRecentView} />
          </View>
          <View style={styles.headerActions}>
            <InfoTour label="About Stream" steps={STREAM_TOUR} scene={streamScene} />
            <ConnectDropdown />
          </View>
        </View>
      </View>
      <FlashList
        ref={scrollRef}
        maintainVisibleContentPosition={{ disabled: true }}
        data={sections}
        keyExtractor={item => item.id}
        renderItem={renderSection}
        keyboardShouldPersistTaps="handled"
        onScroll={onScroll}
        onScrollBeginDrag={onScrollBeginDrag}
        scrollEventThrottle={16}
        onEndReached={onEndReached}
        onEndReachedThreshold={HOME_END_THRESHOLD}
        contentContainerStyle={[styles.content, { paddingTop: Space.xs, paddingBottom: bottomClearance }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Signal.wave} progressViewOffset={0} />}
      />
      {/* Keeps the status bar legible over scrolled content. */}
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(10, 11, 14, 0.4)', 'rgba(10, 11, 14, 0)']}
        style={[styles.statusScrim, { height: insets.top + 16 }]}
      />
      {/* Round 7 item 2: identity first, then the mix's one primary pair (Play, smaller Shuffle), then navigation. */}
      <Sheet visible={mixActions !== null} onClose={() => setMixActions(null)} tintUri={mixCover(mixActions)}>
        {mixActions ? <>
          <SheetIdentity title={mixActions.title} meta={identityMeta('Mix', countOf(mixActions.songs.length, 'song'), mixArtists(mixActions))}
            artwork={{ uri: mixCover(mixActions), title: mixActions.title }} onClose={() => setMixActions(null)} />
          <View style={styles.mixActions}>
            <Button label="Play" icon="play" variant="primary" haptic="select" onPress={() => playMix(mixActions)} />
            <Button label="Shuffle" icon="shuffle" size="compact" haptic="select" onPress={() => playMix(mixActions, true)} />
          </View>
          <SheetDivider />
          <SheetOption icon="albums-outline" label="Open mix" chevron onPress={() => { openMix(mixActions); setMixActions(null); }} />
        </> : null}
      </Sheet>
      {songActions.element}
      {toast ? <Toast visible message={toast} type="info" duration={2200} onDismiss={() => setToast(null)} /> : null}
    </AppScreen>
  );
};

/** A mix's cover in its actions sheet: its first song's. */
const mixCover = (mix: MixParams | null): string | undefined => {
  const first = mix?.songs[0];
  if (!first) return undefined;
  return 'highResArt' in first ? first.highResArt || first.thumbnail : first.coverImageUri;
};

/** The first two artists a mix leans on, for its identity line. */
const mixArtists = (mix: MixParams): string | undefined => {
  const names: string[] = [];
  for (const song of mix.songs) {
    const name = song.artist?.split(',')[0]?.trim();
    if (name && !names.includes(name)) names.push(name);
    if (names.length === 2) break;
  }
  return names.length ? names.join(', ') : undefined;
};

const styles = StyleSheet.create({
  mixActions: { flexDirection: 'row', alignItems: 'center', gap: Space.xs, paddingHorizontal: Space.xxs, paddingBottom: Space.xs },
  screen: { flex: 1, backgroundColor: Signal.bg },
  content: {},
  header: { height: HEADER_HEIGHT, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: GUTTER },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  // The picture sits in its 48dp target at the gutter's edge, so the title keeps Spotify's spacing from it.
  headerLead: { flexDirection: 'row', alignItems: 'center', gap: Space.xs, marginLeft: -Space.sm, flexShrink: 1 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    marginHorizontal: GUTTER,
    marginTop: Space.xs,
    height: 44,
    paddingHorizontal: Space.sm,
    borderRadius: 10,
    backgroundColor: Glass.chip,
  },
  searchInput: { flex: 1, color: Signal.ink, fontSize: TypeScale.body, paddingVertical: 0 },
  listButton: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  saveAllRow: { paddingHorizontal: GUTTER, marginTop: 4, marginBottom: 2, alignItems: 'flex-start' },
  chips: { marginTop: Space.sm },
  firstSection: { marginTop: Space.md },
  list: { paddingHorizontal: GUTTER },
  spinner: { marginTop: Space.lg },
  skeleton: { paddingHorizontal: GUTTER, gap: Space.sm, marginTop: Space.lg },
  skeletonGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: Space.xs, marginBottom: Space.md },
  empty: { color: Signal.inkMuted, fontSize: TypeScale.body, textAlign: 'center', marginTop: Space.lg, paddingHorizontal: Space.xl },
  emptyCard: {
    marginHorizontal: GUTTER,
    marginTop: Space.xl,
    padding: Space.lg,
    borderRadius: Radius.well,
    backgroundColor: Surface.divider,
    alignItems: 'center',
    gap: Space.sm,
  },
  emptyTitle: { fontWeight: '700', fontSize: TypeScale.section, color: Signal.ink },
  emptyBody: { fontSize: TypeScale.body, color: Signal.inkMuted, textAlign: 'center' },
  statusScrim: { position: 'absolute', top: 0, left: 0, right: 0 },
});

export default StreamScreen;
