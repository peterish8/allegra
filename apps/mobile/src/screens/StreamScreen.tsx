import { AppScreen } from '../components/AppScreen';
import { TypeScale } from '../constants/allegraTheme';
/**
 * Stream: pinned title/device/update controls above a scrolling, typed home feed.
 * The current cover supplies the static glow. Songs retain the existing streaming,
 * download and action handlers; collection cards open real mix pages.
 */
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { PrefixCache, TYPEAHEAD_DEBOUNCE_MS } from '@shared/typeahead';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Keyboard,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Toast } from '../components/Toast';
import AboutSheet from '../components/about/AboutSheet';
import { InfoTitleRow, InfoTour } from '../components/allegra/InfoTour';
import { AuraMood } from '../components/allegra/MusicFlowField';
import { PrimaryButton, SectionHeading } from '../components/allegra/home';
import { STREAM_TOUR, streamScene } from '../components/allegra/infoTours';
import { Tactile } from '../components/allegra/motion';
import { useHeaderGlow } from '../hooks/useHeaderGlow';
import { BrowseShelf } from '../components/browse/BrowseShelf';
import { ConnectDropdown } from '../components/connect/ConnectDropdown';
import AddListSheet from '../components/stream/AddListSheet';
import { GUTTER, MoodChips, QuickPicks, ShortcutGrid, SongRow, TrackItem } from '../components/stream/StreamHome';
import { ShimmerBlock } from '../components/stream/StreamItems';
import { useStreamSongActions } from '../components/stream/useStreamSongActions';
import { Radius, Signal, Space } from '../constants/allegraTheme';
import { useBottomClearance } from '../hooks/useBottomClearance';
import { isDoubleTap } from '../navigation/tabs';
import { useAccount } from '../services/account/AccountProvider';
import { getRecommendations, toPlayableAllegraSong } from '../services/account/allegraApi';
import { tasteSeeds } from '../services/luvsTaste';
import { StreamService } from '../services/stream/StreamService';
import { playYTSongs } from '../services/stream/browsePlay';
import { preloadedFeedCache, preloadFeedCache, writeFeedCache } from '../services/stream/feedCache';
import { buildHomeFeed, HomeFeed } from '../services/stream/homeFeed';
import { shouldLoadMoreHome } from '../services/stream/homePagination';
import { personalMoodMix, Taste } from '../services/stream/moodMix';
import { searchOfficial } from '../services/stream/officialSearch';
import { recommendFor } from '../services/stream/recommend';
import { streamIdFor } from '../services/stream/streamSong';
import { onPlayReported } from '../services/sync/LibrarySync';
import { YTMusicClient } from '../services/ytmusic/YTMusicClient';
import { HomeChip, HomePage, leadArtist, Shelf, YTItem, YTPageItem } from '../services/ytmusic/browse';
import { YTSong } from '../services/ytmusic/parsers';
import { useDownloadQueueStore } from '../store/downloadQueueStore';
import { useFollowedArtistsStore } from '../store/followedArtistsStore';
import { useLuvsPreferencesStore } from '../store/luvsPreferencesStore';
import { usePlayerStore } from '../store/playerStore';
import { useSongsStore } from '../store/songsStore';
import { useStreamHistoryStore } from '../store/streamHistoryStore';
import { useUpdateStore } from '../store/updateStore';
import { TabParamList, type MixParams } from '../types/navigation';
import { UnifiedSong } from '../types/song';
import { CollectionCard, HeaderGlow, IconButton, Sheet, SheetOption, Text as UiText } from '../ui';
import { libraryKeys, matchKey } from '../utils/downloadState';
import * as Haptics from '../utils/haptics';
import { shuffled } from '../utils/shuffle';

const HEADER_HEIGHT = 52;
const HOME_END_THRESHOLD = 0.6;
/** Search answers for the session, so typing on (or backspacing) shows something at once. */
const searchAnswers = new PrefixCache<UnifiedSong>();
const songText = (song: UnifiedSong): string => `${song.title} ${song.artist}`;

const MOODS = [
  { label: 'Chill', query: 'chill lofi' },
  { label: 'Energy', query: 'workout hits' },
  { label: 'Romance', query: 'romantic hits' },
  { label: 'Focus', query: 'instrumental focus' },
  { label: 'Party', query: 'party hits' },
  { label: 'Heartbreak', query: 'sad songs' },
] as const;
const MOOD_LABELS = MOODS.map(m => m.label);


type StreamSection =
  | { id: string; kind: 'content' | 'home-content'; content: React.ReactNode }
  | { id: string; kind: 'search-result'; song: UnifiedSong; index: number };

const StreamScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
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
  const [aboutOpen, setAboutOpen] = useState(false);
  // A newer build was found in the background: mark About, where the update is.
  const updateWaiting = useUpdateStore(s => s.available !== null);
  const [query, setQuery] = useState('');
  const queryRef = useRef(query);
  queryRef.current = query;
  const [results, setResults] = useState<UnifiedSong[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [accountPicks, setAccountPicks] = useState<UnifiedSong[]>([]);
  const accountPicksRequest = useRef(0);
  const [mood, setMood] = useState<string | null>(null);
  const searchSeq = useRef(0);

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
  const searchRef = useRef<TextInput>(null);
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
      setTimeout(() => searchRef.current?.focus(), 60);
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
  const [ytChip, setYtChip] = useState<HomeChip | null>(null);
  const [chipShelves, setChipShelves] = useState<Shelf[] | null>(null);
  const [artists, setArtists] = useState<YTPageItem<'artist'>[]>([]);
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
  const [moodMix, setMoodMix] = useState<YTSong[] | null>(null);
  const mixSeq = useRef(0);
  const loadMoodMix = useCallback((label: string) => {
    const seq = ++mixSeq.current;
    setMoodMix(null);
    const seen = new Set<string>();
    const artistsInOrder = [
      ...followed.map(a => a.name),
      ...tasteSeeds(historyRef.current, localRef.current, Date.now(), 8).map(s => leadArtist(s.artist)),
    ].filter(a => a && !/^unknown artist$/i.test(a) && !seen.has(a.toLowerCase()) && seen.add(a.toLowerCase()));
    const taste: Taste = { artists: artistsInOrder, languages: preferred };
    personalMoodMix(label, taste, q => YTMusicClient.searchSongs(q))
      .then(songs => { if (seq === mixSeq.current) setMoodMix(songs); })
      .catch(() => { if (seq === mixSeq.current) setMoodMix([]); });
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

  const loadAccountPicks = useCallback(async () => {
    const request = ++accountPicksRequest.current;
    const token = account.signedIn ? account.token : null;
    if (!token) {
      setAccountPicks([]);
      return;
    }
    const songs = await getRecommendations(token);
    if (request !== accountPicksRequest.current) return;
    setAccountPicks(songs.map(toPlayableAllegraSong).filter((song): song is UnifiedSong => song !== null));
  }, [account.signedIn, account.token]);

  useEffect(() => {
    const requestCounter = accountPicksRequest;
    if (isFocused) loadAccountPicks().catch(() => undefined);
    return () => { requestCounter.current++; };
  }, [isFocused, loadAccountPicks]);

  useEffect(() => onPlayReported(() => {
    if (isFocused) loadAccountPicks().catch(() => undefined);
  }), [isFocused, loadAccountPicks]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    loadFeed().finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [loadFeed]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadFeed(), loadAccountPicks()]);
    setRefreshing(false);
  }, [loadFeed, loadAccountPicks]);

  // `live`: a keystroke search. It keeps the keyboard up and the rows showing until new ones land.
  const runSearch = useCallback(async (text?: string, moodLabel: string | null = null, live = false) => {
    const q = (text ?? query).trim();
    if (!q) return;
    resetHomePagination();
    continuationGeneration.current++;
    // A mood chip searches its own query without writing it into the field.
    if (text !== undefined && !moodLabel && !live) {
      queryRef.current = text;
      setQuery(text);
    }
    setMood(moodLabel);
    if (!live) Keyboard.dismiss();
    const seq = ++searchSeq.current;
    // The longest prefix already answered shows at once, narrowed; the live answer replaces it.
    const known = moodLabel ? null : searchAnswers.instant(q, songText);
    setResults(prev => (known ? [...known.items] : live && prev ? prev : []));
    if (!live) setArtists([]);
    if (!moodLabel) YTMusicClient.searchArtists(q).then(a => { if (seq === searchSeq.current) setArtists(a); }).catch(() => {});
    if (known?.exact) { setSearching(false); return; }
    setSearching(true);
    const found = await searchOfficial(q).catch(() => []);
    if (found.length > 0) searchAnswers.set(q, found);
    if (seq !== searchSeq.current) return; // a newer search won
    setResults(found);
    setSearching(false);
  }, [query, resetHomePagination]);

  // Results follow the typing (Spotify's rule); the keyboard's Search answers at once.
  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const t = setTimeout(() => { runSearch(q, null, true).catch(() => undefined); }, TYPEAHEAD_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, resetHomePagination]); // eslint-disable-line react-hooks/exhaustive-deps -- runSearch changes with query

  const clearSearch = useCallback(() => {
    resetHomePagination();
    continuationGeneration.current++;
    queryRef.current = '';
    searchSeq.current++;
    setArtists([]);
    setYtChip(null);
    setChipShelves(null);
    mixSeq.current++;
    setMoodMix(null);
    setQuery('');
    setMood(null);
    setResults(null);
    setSearching(false);
  }, [resetHomePagination]);

  const play = useCallback((list: UnifiedSong[], index: number) => {
    Haptics.selectionAsync().catch(() => {});
    StreamService.play(list, index);
  }, []);

  const playHit = useCallback((song: UnifiedSong) => {
    Haptics.selectionAsync().catch(() => {});
    Keyboard.dismiss();
    StreamService.playFromSearch(song);
  }, []);



  const save = useCallback((song: UnifiedSong) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    addToDownloads([song]);
    setToast(`Saving “${song.title}” to your library`);
  }, [addToDownloads]);

  // Save all: every result that is not already on the phone. (Ones already queued are skipped by the queue.)
  const unsavedResults = useMemo(() => {
    const have = libraryKeys(localSongs);
    return (results ?? []).filter(song => !have.has(matchKey(song.title, song.artist)));
  }, [results, localSongs]);
  const saveAll = useCallback(() => {
    if (unsavedResults.length === 0) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    addToDownloads(unsavedResults);
    setToast(`Saving ${unsavedResults.length} ${unsavedResults.length === 1 ? 'song' : 'songs'} to your library`);
  }, [unsavedResults, addToDownloads]);
  const [listOpen, setListOpen] = useState(false);

  // A long press opens the song's actions (Play next first), as everywhere in the app.
  const songActions = useStreamSongActions({ onDone: setToast });
  const queueNext = songActions.open;
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
    // YouTube Music's chips open their own shelves, as in Echo.
    const chip = ytChips.find(c => c.title === label);
    if (chip?.browse) {
      continuationGeneration.current++;
      clearSearch();
      setMood(chip.title);
      setYtChip(chip);
      loadMoodMix(chip.title);
      YTMusicClient.home(chip.browse).then(page => setChipShelves(page.shelves)).catch(() => setChipShelves([]));
      return;
    }
    const picked = MOODS.find(m => m.label === label);
    if (!picked) clearSearch();
    else {
      runSearch(picked.query, picked.label);
      loadMoodMix(picked.label);
    }
  }, [clearSearch, runSearch, ytChips, loadMoodMix]);

  // Clear the tab bar pill plus the mini player pill stacked above it (only while a song is loaded).
  const bottomClearance = useBottomClearance(Space.lg);


  // The shader takes its colours from whatever is playing (or the top pick).

  const searchActive = results !== null || searching;
  const searchActiveRef = useRef(searchActive);
  searchActiveRef.current = searchActive;
  const chipActive = ytChip !== null && !searchActive;
  const chipActiveRef = useRef(chipActive);
  chipActiveRef.current = chipActive;

  const onScrollBeginDrag = useCallback(() => {
    didUserScroll.current = !searchActiveRef.current
      && !chipActiveRef.current
      && queryRef.current.trim().length === 0;
  }, []);
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
      searchActive: searchActiveRef.current || queryRef.current.trim().length > 0,
      chipActive: chipActiveRef.current,
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
        || searchActiveRef.current
        || queryRef.current.trim().length > 0
        || chipActiveRef.current
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
    const showingSearch = query.length > 0 || results !== null || mood !== null || ytChip !== null;
    if (showingSearch) { clearSearch(); Keyboard.dismiss(); }
    // From a search, or a tap while already on Stream: back to the top of the home page at once.
    if (showingSearch || isFocused) {
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
  const mixSection = useMemo(() => (mood ? (
    moodMix === null ? (
      <View>
        <SectionHeading title={`Your ${mood.toLowerCase()} mix`} />
        <ActivityIndicator color={Signal.wave} style={styles.spinner} />
      </View>
    ) : moodMix.length > 0 ? (
      <BrowseShelf
        shelf={{ title: `Your ${mood.toLowerCase()} mix`, strapline: 'From artists you play, in your languages', items: moodMix.map(song => ({ kind: 'song' as const, song })) }}
        rows
        maxRows={8}
        onMore={() => playYT(moodMix, 0)}
        onOpen={openItem}
        onPlay={playYT}
        pendingId={pendingSong}
      />
    ) : null
  ) : null), [mood, moodMix, playYT, openItem, pendingSong]);

  const homeSections = useMemo(() => {
    const sections: StreamSection[] = [];
    const add = (id: string, content: React.ReactNode) => sections.push({ id, kind: 'home-content', content });
    const listenAgain = feed?.keepListening.slice(0, 6) ?? [];
    if (listenAgain.length) add('jump-back-in', <><SectionHeading title="Jump back in" /><ShortcutGrid items={listenAgain.map(track)} onPress={i => play(listenAgain, i)} onLongPress={i => queueNext(listenAgain[i])} /></>);
    const quick = accountPicks.length ? accountPicks : feed?.quickPicks ?? [];
    if (quick.length) add('quick-picks', <><SectionHeading title="Quick picks" action="Play all" onAction={() => play(quick, 0)} /><QuickPicks items={quick.map(track)} onPress={i => play(quick, i)} onLongPress={i => queueNext(quick[i])} onSave={i => save(quick[i])} /></>);
    const mixes: MixParams[] = [];
    if (feed?.dailyDiscover.length) mixes.push({ title: 'Daily discover', kind: 'stream', songs: feed.dailyDiscover.map(item => item.recommendation) });
    for (const related of feed?.similar ?? []) if (related.songs.length) mixes.push({ title: `More like ${related.artist}`, kind: 'stream', songs: related.songs });
    if (feed?.forgottenFavorites.length) mixes.push({ title: 'Forgotten favourites', kind: 'local', songs: feed.forgottenFavorites });
    if (mixes.length) add('made-for-you', <><SectionHeading title="Made for you" /><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: GUTTER, gap: Space.sm }}>
      {mixes.map(mix => <CollectionCard key={mix.title} title={mix.title} meta={`Mix ? ${mix.songs.length} songs`} uri={mix.kind === 'stream' ? mix.songs[0].highResArt : mix.songs[0].coverImageUri} onPress={() => openMix(mix)} onActions={() => setMixActions(mix)} />)}
    </ScrollView></>);
    if (followedShelf) add('your-artists', <BrowseShelf shelf={followedShelf} onOpen={openItem} onPlay={playYT} />);
    (ytHome?.shelves ?? []).forEach((shelf, index) => add(`catalog:${index}:${shelf.title}`, <BrowseShelf shelf={shelf} onOpen={openItem} onPlay={playYT} pendingId={pendingSong} />));
    if (loading && !quick.length && !ytHome?.shelves.length) add('loading', <View style={styles.skeleton}>{[0, 1, 2, 3].map(i => <ShimmerBlock key={i} width="100%" height={64} />)}</View>);
    if (!loading && !quick.length && !ytHome?.shelves.length) add('catalog-unavailable', <View style={styles.emptyCard}><UiText variant="lead">Can?t reach the catalog</UiText><UiText tone="secondary">Pull down to try again. Your saved songs still play.</UiText><PrimaryButton label="Open Library" icon="library-outline" onPress={openDownloads} /></View>);
    return sections;
  }, [feed, track, play, queueNext, accountPicks, save, openMix, followedShelf, openItem, playYT, ytHome, pendingSong, loading, openDownloads]);

  const chipSections = useMemo(() => {
    if (!ytChip || searchActive) return [];
    const sections: StreamSection[] = [
      { id: 'chip-title', kind: 'content', content: <SectionHeading title={ytChip.title} action="Clear" onAction={clearSearch} /> },
    ];
    if (mixSection) sections.push({ id: 'chip-mix', kind: 'content', content: mixSection });
    if (chipShelves === null) sections.push({ id: 'chip-loading', kind: 'content', content: <ActivityIndicator color={Signal.wave} style={styles.spinner} /> });
    if (chipShelves?.length === 0) sections.push({ id: 'chip-empty', kind: 'content', content: <Text style={styles.empty}>Nothing here right now. Try another mood.</Text> });
    (chipShelves ?? []).forEach((shelf, index) => sections.push({
      id: `chip:${index}:${shelf.title}`,
      kind: 'content',
      content: <BrowseShelf shelf={shelf} onOpen={openItem} onPlay={playYT} pendingId={pendingSong} />,
    }));
    return sections;
  }, [chipShelves, clearSearch, mixSection, openItem, pendingSong, playYT, searchActive, ytChip]);

  const searchSections = useMemo(() => {
    if (!searchActive) return [];
    const sections: StreamSection[] = [];
    const count = results?.length ?? 0;
    sections.push({
      id: 'search-title',
      kind: 'content',
      content: <SectionHeading
        title={mood ?? `“${query.trim()}”`}
        subtitle={searching ? 'Searching…' : `${count} ${count === 1 ? 'song' : 'songs'}`}
        action="Clear"
        onAction={clearSearch}
      />,
    });
    if (mixSection) sections.push({ id: 'search-mix', kind: 'content', content: mixSection });
    if (artists.length > 0) sections.push({
      id: 'search-artists', kind: 'content',
      content: <BrowseShelf shelf={{ title: 'Artists', items: artists }} onOpen={openItem} onPlay={playYT} pendingId={pendingSong} />,
    });
    if (unsavedResults.length >= 2 && !searching) sections.push({
      id: 'search-save-all', kind: 'content',
      content: <View style={styles.saveAllRow}>
        <IconButton icon="arrow-down-circle-outline" label="Save all" onPress={saveAll} />
      </View>,
    });
    if (searching) sections.push({ id: 'search-loading', kind: 'content', content: <ActivityIndicator color={Signal.wave} style={styles.spinner} /> });
    if (!searching && count === 0) sections.push({
      id: 'search-empty', kind: 'content',
      content: <Text style={styles.empty}>Nothing streamable for that. Try the artist name or a different spelling.</Text>,
    });
    (results ?? []).forEach((song, index) => sections.push({
      id: `search-result:${streamIdFor(song)}:${index}`,
      kind: 'search-result',
      song,
      index,
    }));
    return sections;
  }, [artists, clearSearch, mixSection, mood, openItem, pendingSong, playYT, query, results, saveAll, searching, searchActive, unsavedResults]);

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
  const feedSections = chipActive ? chipSections : searchActive ? searchSections : homeSections;
  const sections = useMemo(() => [moodsSection, ...feedSections], [moodsSection, feedSections]);
  const renderSection = useCallback(({ item }: { item: StreamSection }) => {
    if (item.kind === 'search-result') {
      return <View style={styles.list}>
        <SongRow
          item={track(item.song)}
          // A search hit plays with its own song radio after it, not the rest of the results.
          onPress={() => (mood ? play(results ?? [], item.index) : playHit(item.song))}
          onLongPress={() => queueNext(item.song)}
          onSave={() => save(item.song)}
        />
      </View>;
    }
    // No Reanimated `entering` here: a layout animation inside a recycled FlashList cell can hand FlashList a stale
    // size, which left a tall blank gap under a short "Jump back in" (owner report, 2026-11-06).
    return <View>{item.content}</View>;
  }, [mood, play, playHit, queueNext, results, save, track]);

  return (
    <AppScreen style={styles.screen} staticGlow={false}>
      <HeaderGlow {...glow.props} />
      {/* Keep the update entry reachable while feed sections hydrate or scroll. */}
      <View style={{ paddingTop: insets.top + Space.xs }}>
        <View style={styles.header}>
          <InfoTitleRow>
            <Text style={styles.title} accessibilityRole="header">Stream</Text>
            <InfoTour label="About Stream" steps={STREAM_TOUR} scene={streamScene} />
          </InfoTitleRow>
          <View style={styles.headerActions}>
            <ConnectDropdown />
            <Tactile
              onPress={() => { Haptics.selectionAsync().catch(() => {}); setAboutOpen(true); }}
              hitSlop={8}
              pressScale={0.9}
              accessibilityRole="button"
              accessibilityLabel={updateWaiting ? 'About LuvLyrics, update available' : 'About LuvLyrics'}
              style={styles.aboutBtn}
            >
              <Image source={require('../../assets/luvlyrics-logo-white-mark.png')} style={{ width: 26, height: 26 }} resizeMode="contain" accessibilityIgnoresInvertColors />
              {updateWaiting ? <View style={styles.aboutDot} /> : null}
            </Tactile>
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
      <Sheet visible={mixActions !== null} onClose={() => setMixActions(null)} title={mixActions?.title}>
        <SheetOption icon="play" label="Play mix" onPress={() => { if (mixActions) playMix(mixActions); }} />
        <SheetOption icon="shuffle" label="Shuffle mix" onPress={() => { if (mixActions) playMix(mixActions, true); }} />
        <SheetOption icon="open-outline" label="Open mix" onPress={() => { if (mixActions) { openMix(mixActions); setMixActions(null); } }} />
      </Sheet>
      {songActions.element}
      {toast ? <Toast visible message={toast} type="info" duration={2200} onDismiss={() => setToast(null)} /> : null}
      <AboutSheet visible={aboutOpen} onClose={() => setAboutOpen(false)} />
      <AddListSheet visible={listOpen} onClose={() => setListOpen(false)} onSaved={setToast} />
    </AppScreen>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Signal.bg },
  content: {},
  header: { height: HEADER_HEIGHT, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: GUTTER },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  aboutBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  aboutDot: { position: 'absolute', top: 5, right: 5, width: 10, height: 10, borderRadius: 5, backgroundColor: Signal.wave, borderWidth: 2, borderColor: Signal.bg },
  title: { fontSize: TypeScale.page, fontWeight: '700', color: Signal.ink },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    marginHorizontal: GUTTER,
    marginTop: Space.xs,
    height: 44,
    paddingHorizontal: Space.sm,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.09)',
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
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
    gap: Space.sm,
  },
  emptyTitle: { fontWeight: '700', fontSize: TypeScale.section, color: Signal.ink },
  emptyBody: { fontSize: TypeScale.body, color: Signal.inkMuted, textAlign: 'center' },
  statusScrim: { position: 'absolute', top: 0, left: 0, right: 0 },
});

export default StreamScreen;
