'use client';

import { ArrowLeft, ArrowUpToLine, ChevronRight, Download, House, Heart as HeartIcon, Disc3, Pause, Play, SkipBack, SkipForward, Waves, Clock, Compass, Library as LibraryIcon, ListMusic, PanelLeftClose, PanelLeftOpen, Repeat, Repeat1, Search as SearchIcon, Settings as SettingsIcon, Shuffle, Users, Volume2, VolumeX, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent } from 'react';

import type { ArtistProfile, HomePayload, LyricLine, LyricsPayload, SharedPlaylist, UnifiedSong } from '@shared/types';
import { deriveMoodPrompts } from '@shared/moodPrompts';
import type { SongRef, SongSnapshot } from '@shared/songRef';
import { fromAllegraSong, parseSongRef } from '@shared/songRef';

import { AlbumPage } from './components/AlbumPage';
import { ArtistPage } from './components/ArtistPage';
import { LegalPage } from './components/LegalPage';
import { isLegalView } from './lib/routes';
import { CollectionPage } from './components/CollectionPage';
import { ArtistPreviewCard } from './components/ArtistPreviewCard';
import type { RelatedArtist } from './components/ArtistPage';
import { LibraryPage } from './components/LibraryPage';
import { ImportPage } from './components/import/ImportPage';
import { BlendJoinPage } from './components/blend/BlendJoinPage';
import { BlendPage } from './components/blend/BlendPage';
import { BlendsPage } from './components/blend/BlendsPage';
import { DynamicAura } from './components/DynamicAura';
import { AuthDialog } from './components/AuthDialog';
import { useSignIn } from './auth/SignInContext';
import { CommandPalette } from './components/CommandPalette';
import { DiscoverSections, HomePage } from './components/HomePage';
import { ConnectPicker, type ConnectPickerState } from './components/ConnectPicker';
import { PlayerPanel } from './components/PlayerPanel';
import { BarScrubber, FeatureProgress, FeatureRemaining } from './components/PlayheadViews';
import { SettingsPage } from './components/SettingsPage';
import { MusicFlowShader } from './components/shader/MusicFlowShader';
import type { ImmersivePlayerMode } from './components/PlayerPanel';
import { SearchResults, artistsFromSongs } from './components/SearchResults';
import { Artwork, EmptyState, IconButton, NoticeToast, OfflineToast, TactileButton } from './components/ui';
import { useAccount, useListenTracker } from './hooks/useAccount';
import { accountDisplayName, isResolvingAccount, recallAccountName, rememberAccountName } from './lib/accountState';
import { useAudioPlayer } from './hooks/useAudioPlayer';
import { useLiveKaraoke } from './hooks/useLiveKaraoke';
import { useMediaSession } from './hooks/useMediaSession';
import { useNarrowViewport } from './hooks/useNarrowViewport';
import { useSettings } from './hooks/useSettings';
import { PlaylistsContext, usePlaylists } from './hooks/usePlaylists';
import { QueueActionsContext, type QueueActions } from './hooks/useQueueActions';
import { collectAlbumTracks } from './lib/album';
import { tapHaptic } from './lib/haptics';
import { useLibraryArrival } from './lib/libraryArrival';
import { lockScroll } from './lib/scrollLock';
import { DEFAULT_PALETTE, extractPalette, shadePalette, paletteBrightness } from './lib/palette';
import type { Palette } from './lib/palette';
import { ApiError, applyLibraryOps, ensureSession, fetchArtist, fetchArtistFaces, fetchAiRecommendations, fetchHome, fetchLyrics, fetchLyricsAlternatives, fetchRecentlyPlayed, fetchSharedPlaylist, fetchSuggestions, recordRecentlyPlayed, saveSharedPlaylist, searchSongs, translateLyrics } from './lib/api';
import { shouldStartRadio, uniqueByIdentity } from './lib/songIdentity';
import { resolveSnapshotForPlayback, snapshotForSong, snapshotToDisplaySong, useConnect } from './hooks/useConnect';
import { useSnapshotArtworks } from './hooks/useSnapshotArtwork';
import { isControllingAnotherDevice } from '../../../packages/connect/src/index';
import type { LibrarySong } from './lib/libraryRows';
import { legacyHashToPath, parseRoute, paths } from './lib/routes';
import { flags } from './lib/flags';
import { pickTopResult } from './lib/topResult';
import { formatTime, titleAccent } from './lib/utils';
import { PlayheadStore, type Playhead } from './lib/playhead';
import { itemVariants, motionTokens, pageVariants, spring } from './motion';
import { InfoTour } from './components/InfoTour';
import { BROWSE_TOUR } from './components/pageTours';
import { browseScene } from './components/infoScenes';

const DEFAULT_QUERY = 'top songs';
type PlayerMode = 'mini' | ImmersivePlayerMode;

/** Every credited name on a song ("A, B & C feat. D"), in order. */
function creditedNames(song: UnifiedSong): string[] {
  return song.artist.split(/,|&| feat\.? /i).map((part) => part.trim()).filter(Boolean);
}

/** One entry per artist, each with a song to borrow artwork from. */
function uniqueArtists(songs: readonly UnifiedSong[], limit: number, exclude: string | null = null, allCredits = false): { name: string; song: UnifiedSong }[] {
  const seen = new Set<string>(exclude ? [exclude.toLocaleLowerCase()] : []);
  const list: { name: string; song: UnifiedSong }[] = [];
  for (const song of songs) {
    const names = allCredits ? creditedNames(song) : creditedNames(song).slice(0, 1);
    for (const name of names) {
      const key = name.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({ name, song });
      if (list.length >= limit) return list;
    }
  }
  return list;
}

function curatedSongs(songs: UnifiedSong[]): UnifiedSong[] {
  return uniqueByIdentity(songs).slice(0, 6);
}

function catalogSongId(song: UnifiedSong): string {
  const librarySong = song as Partial<LibrarySong>;
  const ref = librarySong.libraryRef ?? fromAllegraSong(song);
  const parsed = ref ? parseSongRef(ref) : null;
  if (parsed?.source === 'gaana') return `gaana:${parsed.id}`;
  if (parsed?.source === 'saavn') return parsed.id;
  return song.id;
}

function likedKey(song: UnifiedSong): string {
  const ref = (song as Partial<LibrarySong>).libraryRef ?? fromAllegraSong(song);
  return ref?.startsWith('gaana:') ? `library:${ref}` : song.id;
}

export default function App() {
  const reduced = useReducedMotion();
  // Songs just landed (an import finished): the Library nav glows once per arrival.
  const libraryArrivals = useLibraryArrival();
  // Gates swipe-up-to-expand on the mini player: no equivalent gesture affordance
  // on desktop, so the drag only engages on the phone layout (see app.css's
  // matching `@media (max-width: 900px)` breakpoint).
  const isNarrowViewport = useNarrowViewport();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const mainRef = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState('');
  const [songs, setSongs] = useState<UnifiedSong[]>([]);
  const [featured, setFeatured] = useState<UnifiedSong[]>([]);
  const [home, setHome] = useState<HomePayload | null>(null);
  const [searching, setSearching] = useState(true);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [lyricsPayload, setLyricsPayload] = useState<LyricsPayload | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [lyricsError, setLyricsError] = useState<string | null>(null);
  const [lyricsAlternatives, setLyricsAlternatives] = useState<LyricsPayload[] | null>(null);
  const [lyricsAlternativesLoading, setLyricsAlternativesLoading] = useState(false);
  const [lyricsAlternativesError, setLyricsAlternativesError] = useState<string | null>(null);
  const [translatedLyrics, setTranslatedLyrics] = useState<LyricLine[] | null>(null);
  const [showTranslated, setShowTranslated] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [translateProvider, setTranslateProvider] = useState<string | null>(null);
  const [playerMode, setPlayerMode] = useState<PlayerMode>('mini');
  const [albumSeed, setAlbumSeed] = useState<UnifiedSong | null>(null);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [likedSongs, setLikedSongs] = useState<UnifiedSong[]>([]);
  const [recentlyPlayed, setRecentlyPlayed] = useState<UnifiedSong[]>([]);
  const [personalLoading, setPersonalLoading] = useState(true);
  const [personalError, setPersonalError] = useState<string | null>(null);
  const [personalActionError, setPersonalActionError] = useState<string | null>(null);
  const [aiPicks, setAiPicks] = useState<UnifiedSong[]>([]);
  const [aiPicksReasoning, setAiPicksReasoning] = useState<string | null>(null);
  const [aiPicksProvider, setAiPicksProvider] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const { view, artistName, playlistId, sharedCode, blendId, inviteCode } = useMemo(() => parseRoute(pathname), [pathname]);
  const [shared, setShared] = useState<SharedPlaylist | null>(null);
  const [sharedLoading, setSharedLoading] = useState(false);
  const [sharedError, setSharedError] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [artistSongs, setArtistSongs] = useState<UnifiedSong[]>([]);
  const [artistProfile, setArtistProfile] = useState<ArtistProfile | null>(null);
  const [artistLoading, setArtistLoading] = useState(false);
  // Artist photos by lower-cased name. An empty string means "looked up, no photo", so we never ask twice.
  const [faces, setFaces] = useState<Record<string, string>>({});
  /** Face lookups already in flight, so a re-render does not re-request them. */
  const requestedFacesRef = useRef<Set<string>>(new Set());
  const [artistError, setArtistError] = useState<string | null>(null);
  const [artistReload, setArtistReload] = useState(0);
  const [suggestions, setSuggestions] = useState<UnifiedSong[]>([]);
  const [palette, setPalette] = useState<Palette>(DEFAULT_PALETTE);
  const [ambientColor, setAmbientColor] = useState('#2d7fe4');
  const [settings, updateSettings] = useSettings();
  // Background motion is a saved setting; the header button is a shortcut to it.
  const motionPaused = !settings.animatedBackground;
  const [navCollapsed, setNavCollapsed] = useState(() => {
    try { return window.localStorage.getItem('allegra-nav-collapsed') === 'true'; } catch { return false; }
  });
  const toggleNavigation = (): void => {
    setNavCollapsed((current) => {
      const next = !current;
      try { window.localStorage.setItem('allegra-nav-collapsed', String(next)); } catch { /* storage unavailable: the choice just won't persist */ }
      return next;
    });
  };
  const [queueOpen, setQueueOpen] = useState(false);
  const queuePanelRef = useRef<HTMLDivElement | null>(null);
  const queueToggleRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!queueOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setQueueOpen(false);
    };
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (queuePanelRef.current?.contains(target)) return;
      if (queueToggleRef.current?.contains(target)) return;
      setQueueOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [queueOpen]);
  useEffect(() => {
    if (!queueOpen) return undefined;
    const frame = window.requestAnimationFrame(() => {
      queuePanelRef.current?.querySelector<HTMLElement>('button, [href], input')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [queueOpen]);
  const nowPlayingRef = useRef<HTMLElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const lyricsGeneration = useRef(0);
  const audio = useAudioPlayer();
  const connect = useConnect(audio);
  const connectView = connect.view;
  // Another device plays (or this browser's other tab does): this tab is its remote.
  const remotePlayback = isControllingAnotherDevice(connectView, connect.deviceId)
    || Boolean(connect.tabStatus === 'other-tab' && connectView?.activeDeviceId && connectView.activeDeviceOnline);
  // A song sent without a cover it could share is shown with the one looked up here.
  const remoteSongs = useMemo(
    () => (remotePlayback && connectView ? [connectView.song, ...connectView.queue] : []),
    [remotePlayback, connectView]
  );
  const remoteCovers = useSnapshotArtworks(remoteSongs);
  const shownRemote = (snapshot: SongSnapshot): LibrarySong => {
    const song = snapshotToDisplaySong(snapshot);
    const cover = remoteCovers.get(snapshot.ref);
    return cover && cover !== song.artwork ? { ...song, artwork: cover } : song;
  };
  const remoteSong = remotePlayback && connectView?.song ? shownRemote(connectView.song) : null;
  const playerSong = remotePlayback ? remoteSong : audio.currentSong;
  const playerQueue = remotePlayback && connectView
    ? [...(remoteSong ? [remoteSong] : []), ...connectView.queue.map(shownRemote)]
    : audio.queue;
  // Another device's position arrives once a second; the local one is the element's own store.
  const [remotePlayhead] = useState(() => new PlayheadStore());
  useEffect(() => remotePlayhead.set(connect.livePosition), [connect.livePosition, remotePlayhead]);
  const playhead: Playhead = remotePlayback ? remotePlayhead : audio.playhead;
  const playerDuration = remotePlayback ? (remoteSong?.duration ?? 0) : audio.duration;
  const playerIsPlaying = remotePlayback && connectView ? connectView.isPlaying : audio.isPlaying;
  const playerIsBuffering = remotePlayback ? false : audio.isBuffering;
  const playerError = remotePlayback ? connectView?.lastError ?? null : audio.error;
  const playerVolume = remotePlayback && connectView ? connectView.volume : audio.volume;
  const playerShuffle = remotePlayback && connectView ? connectView.shuffle : audio.shuffle;
  const playerRepeat = remotePlayback && connectView ? connectView.repeat : audio.repeat;
  const togglePlayer = (): void => {
    if (remotePlayback) connect.control({ kind: playerIsPlaying ? 'pause' : 'play' });
    else audio.togglePlayback();
  };
  const seekPlayer = (seconds: number): void => {
    if (remotePlayback) connect.control({ kind: 'seek', sec: seconds });
    else void audio.seek(seconds);
  };
  const previousPlayer = (): void => {
    if (remotePlayback) connect.control({ kind: 'prev' });
    else audio.skipPrevious();
  };
  const changePlayerVolume = (volume: number): void => {
    if (remotePlayback) connect.control({ kind: 'volume', v: volume });
    else audio.setVolume(volume);
  };
  // The bar's sliders follow the finger and act on release. Seeking on every step restarted the
  // stream a hundred times in a drag, and on another device each step is a command whose echo
  // pulled the thumb back. Volume on this device still changes as it is dragged, to be heard.
  const [barVolume, setBarVolume] = useState<number | null>(null);
  const dragBarVolume = (volume: number): void => {
    if (remotePlayback) setBarVolume(volume);
    else changePlayerVolume(volume);
  };
  const commitBarVolume = (): void => {
    if (barVolume === null) return;
    setBarVolume(null);
    changePlayerVolume(barVolume);
  };
  const togglePlayerShuffle = (): void => {
    if (remotePlayback) connect.control({ kind: 'shuffle', on: !playerShuffle });
    else audio.toggleShuffle();
  };
  const cyclePlayerRepeat = (): void => {
    if (remotePlayback) connect.control({ kind: 'repeat', mode: playerRepeat === 'off' ? 'all' : playerRepeat === 'all' ? 'one' : 'off' });
    else audio.cycleRepeat();
  };
  // A foreign active device owns the sound. Pause any stale browser stream while
  // keeping its local queue available for a later transfer back to this device.
  useEffect(() => {
    if (remotePlayback) void audio.requestPlayback(false);
  }, [audio.requestPlayback, remotePlayback]);
  const liveKaraoke = useLiveKaraoke(remotePlayback ? null : audio.currentSong, {
    audioRef: audio.audioRef,
    swapAudioSource: audio.swapAudioSource
  });
  const hasSongLoaded = playerSong !== null;
  const playlists = usePlaylists();
  const transportRef = useRef(audio);
  transportRef.current = audio;
  /** When true, Next keeps pulling similar-vibe tracks instead of remastered search hits. */
  const radioActiveRef = useRef(false);
  // A song another device sent here keeps going with similar ones, as Spotify's autoplay carries on
  // wherever the music is, when the listener has "keep playing similar songs" on.
  const autoplaySimilarRef = useRef(settings.autoplaySimilar);
  autoplaySimilarRef.current = settings.autoplaySimilar;
  useEffect(() => {
    if (connect.connectLoads > 0) radioActiveRef.current = autoplaySimilarRef.current;
  }, [connect.connectLoads]);
  const aiPicksRef = useRef<UnifiedSong[]>([]);
  const reloadPlaylists = playlists.reload;
  // Lock screen, media keys, headset buttons and car head units, all through the same funnel.
  const fillRadioQueue = useCallback(async (songId: string, signal?: AbortSignal): Promise<number> => {
    try {
      const related = await fetchSuggestions(songId, signal, 20);
      if (signal?.aborted) return 0;
      setSuggestions(related);
      let added = transportRef.current.appendQueue(related);
      if (added === 0 && aiPicksRef.current.length > 0) {
        added = transportRef.current.appendQueue(aiPicksRef.current);
      }
      return added;
    } catch {
      if (signal?.aborted) return 0;
      if (aiPicksRef.current.length > 0) return transportRef.current.appendQueue(aiPicksRef.current);
      return 0;
    }
  }, []);

  const skipNextSmart = useCallback((): void => {
    if (remotePlayback) {
      connect.control({ kind: 'next' });
      return;
    }
    const player = transportRef.current;
    const song = player.currentSong;
    if (!song) return;
    const next = player.skipNext();
    if (!next && radioActiveRef.current) {
      void fillRadioQueue(catalogSongId(song)).then((added) => {
        if (added > 0) player.skipNext();
      });
      return;
    }
    if (!next || !radioActiveRef.current) return;
    const live = player.queue;
    const index = live.findIndex((item) => item.id === next.id);
    const remaining = index >= 0 ? live.length - index - 1 : 0;
    if (remaining < 3) void fillRadioQueue(catalogSongId(next));
  }, [connect.control, fillRadioQueue, remotePlayback]);

  useMediaSession({
    song: playerSong,
    isPlaying: playerIsPlaying,
    playhead,
    duration: playerDuration,
    requestPlayback: async (playing) => {
      if (remotePlayback) connect.control({ kind: playing ? 'play' : 'pause' });
      else await audio.requestPlayback(playing);
    },
    seek: async (seconds) => seekPlayer(seconds),
    skipNext: skipNextSmart,
    skipPrevious: previousPlayer,
    stop: () => { if (remotePlayback) connect.control({ kind: 'pause' }); else audio.stop(); }
  });
  const collapsePlayer = useCallback(() => {
    setPlayerMode('mini');
  }, []);

  /**
   * YouTube Music pattern: route the page under the lyrics sheet first, then
   * slide the sheet down so the artist/album is already waiting underneath.
   */
  const revealFromListeningWorld = useCallback((go: () => void) => {
    go();
    window.requestAnimationFrame(() => {
      setPlayerMode('mini');
    });
  }, []);

  const openAlbum = useCallback((song: UnifiedSong) => {
    setAlbumSeed(song);
    router.push(paths.album);
  }, [router]);

  const openAlbumFromPlayer = useCallback((song: UnifiedSong) => {
    revealFromListeningWorld(() => openAlbum(song));
  }, [openAlbum, revealFromListeningWorld]);

  const openArtistFromPlayer = useCallback((name: string) => {
    revealFromListeningWorld(() => {
      router.push(paths.artist(name));
    });
  }, [revealFromListeningWorld, router]);

  const openLibrarySection = useCallback((event: MouseEvent<HTMLAnchorElement>, sectionId: string) => {
    event.preventDefault();
    const alreadyThere = pathname === paths.library;
    if (!alreadyThere) router.push(paths.library);
    // The library renders after the route changes; wait a beat before scrolling to the section.
    window.setTimeout(() => document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), alreadyThere ? 0 : 400);
  }, [pathname, router]);

  // Steps taken inside the app. Back only walks browser history when there is in-app history to walk,
  // so a page opened straight from a link falls back to a sensible parent instead of leaving the site.
  const navDepthRef = useRef(0);
  const goBack = useCallback((fallback: string) => {
    if (navDepthRef.current > 0) {
      navDepthRef.current -= 2;
      window.history.back();
    } else {
      router.push(fallback);
    }
  }, [router]);

  const openArtist = useCallback((name: string) => {
    router.push(paths.artist(name));
  }, [router]);

  /** Albums from the artist page: open the album when one of its songs is loaded, otherwise search for it. */
  const openAlbumByName = useCallback((albumName: string, seed: UnifiedSong | null) => {
    if (seed) {
      openAlbum(seed);
      return;
    }
    router.push(paths.discover);
    setQuery(`${albumName} ${artistName ?? ''}`.trim());
  }, [openAlbum, artistName, router]);

  const loadSearch = useCallback(async (value: string, signal?: AbortSignal): Promise<void> => {
    setSearching(true);
    setSearchError(null);
    try {
      const response = await searchSongs(value, signal);
      if (value === DEFAULT_QUERY) setFeatured(response.results);
      else setSongs(response.results);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setSearchError(error instanceof Error ? error.message : 'Something went wrong. Try again.');
    } finally {
      setSearching(false);
    }
  }, []);

  // What the home shelves are asked for: the listener's languages and the Top 10 region (set further down,
  // once the account and settings are known).
  const homeAsk = useRef<{ languages: readonly string[]; region: string }>({ languages: [], region: 'auto' });
  const loadHome = useCallback(async (signal?: AbortSignal): Promise<void> => {
    setSearching(true);
    setSearchError(null);
    try {
      const payload = await fetchHome(signal, homeAsk.current);
      setHome(payload);
      setFeatured(payload.trending);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      try {
        const response = await searchSongs(DEFAULT_QUERY, signal);
        setHome(null);
        setFeatured(response.results);
        setSearchError(null);
      } catch (fallbackError) {
        if (fallbackError instanceof DOMException && fallbackError.name === 'AbortError') return;
        setSearchError(fallbackError instanceof Error ? fallbackError.message : error instanceof Error ? error.message : 'Something went wrong. Try again.');
      }
    } finally {
      setSearching(false);
    }
  }, []);


  const loadPersonalSpace = useCallback(async (): Promise<void> => {
    setPersonalLoading(true);
    setPersonalError(null);
    try {
      await ensureSession();
      const [recent, liked] = await Promise.all([fetchRecentlyPlayed(), reloadPlaylists()]);
      setLikedSongs([...liked]);
      setLikedIds(new Set(liked.map(likedKey)));
      setRecentlyPlayed(recent);
    } catch (error) {
      setPersonalError(error instanceof Error ? error.message : 'Your listening room could not be loaded.');
    } finally {
      setPersonalLoading(false);
    }
  }, [reloadPlaylists]);

  useEffect(() => {
    void loadPersonalSpace();
  }, [loadPersonalSpace]);

  // Who is listening (guest or account) and what we have learned about their taste. Signing in or out reloads everything personal.
  const signIn = useSignIn();
  const account = useAccount(signIn.signedIn, () => {
    void loadPersonalSpace();
  });
  useListenTracker(audio.currentSong ?? null, audio.playhead, account.refresh);

  // Guest, account, or not known yet. Convex hands back a returning Google session some moments after the
  // page loads, and the profile a moment after that; showing "Guest" for that stretch made a signed-in
  // listener look signed out and then flip to their name. While it is not known, the chip says nothing
  // about it, using the name remembered from last time if there is one.
  const accountResolving = isResolvingAccount({ loading: signIn.loading, signedIn: signIn.signedIn, ready: account.ready, profile: account.profile });
  const [rememberedName, setRememberedName] = useState<string | null>(null);
  useEffect(() => {
    setRememberedName(recallAccountName(window.localStorage));
  }, []);
  useEffect(() => {
    if (accountResolving) return;
    if (account.profile && !account.profile.isGuest) {
      const name = accountDisplayName(account.profile);
      rememberAccountName(window.localStorage, name);
      setRememberedName(name);
    } else {
      rememberAccountName(window.localStorage, null);
      setRememberedName(null);
    }
  }, [accountResolving, account.profile]);
  const knownAccount = !accountResolving && account.profile && !account.profile.isGuest ? account.profile : null;
  const chipName = knownAccount ? accountDisplayName(knownAccount) : accountResolving ? rememberedName : null;

  // A remote track change can write recent history on the phone. Give that
  // write a moment to land, then refresh once for this track instead of polling.
  useEffect(() => {
    if (!remotePlayback) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void (async () => {
      try {
        await ensureSession();
        const recent = await fetchRecentlyPlayed(controller.signal);
        if (!controller.signal.aborted) {
          setRecentlyPlayed((current) => current.length === recent.length
            && current.every((song, index) => song.id === recent[index]?.id && song.source === recent[index]?.source)
            ? current
            : recent);
        }
      } catch {
        // Keep the last known library visible while the API is unavailable.
      }
      })();
    }, 3_000);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [playerSong?.id, playerSong?.source, remotePlayback]);

  /** Home/search mood chips: server-built prompts when taste is ready, else calm guest defaults. */
  const moodPrompts = useMemo(() => {
    if (account.taste?.prompts?.length) return [...account.taste.prompts];
    return deriveMoodPrompts(account.taste);
  }, [account.taste]);

  // The listener's languages for the home shelves: the ones they play most (within a third of the
  // top one, at most three), from the learned taste. A guest or a new account gets every language.
  const homeLanguages = useMemo(() => {
    const ranked = [...(account.taste?.languages ?? [])].sort((a, b) => b.score - a.score);
    const top = ranked[0]?.score ?? 0;
    return top > 0 ? ranked.filter((entry) => entry.score >= top / 3).slice(0, 3).map((entry) => entry.name.toLowerCase()) : [];
  }, [account.taste?.languages]);
  const homeKey = `${homeLanguages.join(',')}|${settings.chartRegion}`;
  useEffect(() => {
    homeAsk.current = { languages: homeLanguages, region: settings.chartRegion };
    const controller = new AbortController();
    void loadHome(controller.signal);
    return () => controller.abort();
    // homeKey carries both inputs; the arrays themselves change identity on every taste refresh.
  }, [homeKey, loadHome]);

  // A shared playlist opened by link: public, so it works before anyone has signed in.
  useEffect(() => {
    if (!sharedCode) {
      setShared(null);
      setSharedError(null);
      return undefined;
    }
    const controller = new AbortController();
    setSharedLoading(true);
    setSharedError(null);
    fetchSharedPlaylist(sharedCode, controller.signal)
      .then((payload) => setShared(payload))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setShared(null);
        setSharedError(error instanceof Error ? error.message : 'That playlist could not be opened.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setSharedLoading(false);
      });
    return () => controller.abort();
  }, [sharedCode]);

  // Links from before real URLs (`/#shared/abc`) still open the right view.
  useEffect(() => {
    const target = legacyHashToPath(window.location.hash);
    if (target) router.replace(target);
  }, [router]);

  // Count in-app steps so Back only walks history when there is some to walk.
  const seenPathRef = useRef<string | null>(null);
  useEffect(() => {
    if (seenPathRef.current !== null && seenPathRef.current !== pathname) navDepthRef.current += 1;
    seenPathRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    if (view !== 'discover') window.scrollTo({ top: 0, behavior: 'auto' });
    window.requestAnimationFrame(() => mainRef.current?.focus({ preventScroll: true }));
  }, [view]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setSongs([]);
      setSearchError(null);
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => void loadSearch(trimmed, controller.signal), 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadSearch, query]);

  useEffect(() => {
    const onOffline = (): void => setOffline(true);
    const onOnline = (): void => setOffline(false);
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, []);

  useEffect(() => {
    if (!hasSongLoaded) return undefined;
    // Space toggles playback and the arrows seek 5 s, unless a control that
    // already owns the key (a field, button, link or the scrubber) has focus.
    const onTransportKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest('input, textarea, select, button, a, [role="slider"], [role="checkbox"], [contenteditable="true"]')) return;
      if (event.key === ' ') {
        event.preventDefault();
        togglePlayer();
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        seekPlayer(playhead.get() + (event.key === 'ArrowRight' ? 5 : -5));
      }
    };
    window.addEventListener('keydown', onTransportKey);
    return () => window.removeEventListener('keydown', onTransportKey);
  }, [hasSongLoaded, playhead, seekPlayer, togglePlayer]);

  useEffect(() => {
    setTranslatedLyrics(null);
    setShowTranslated(false);
    setTranslateError(null);
    setTranslateProvider(null);
  }, [playerSong?.id, playerSong?.source]);

  useEffect(() => {
    const song = playerSong;
    if (!song) {
      setLyrics([]);
      setLyricsPayload(null);
      setLyricsError(null);
      setLyricsAlternatives(null);
      setLyricsAlternativesError(null);
      return undefined;
    }
    const generation = ++lyricsGeneration.current;
    const controller = new AbortController();
    setLyricsLoading(true);
    setLyricsError(null);
    setLyricsAlternatives(null);
    setLyricsAlternativesError(null);
    void fetchLyrics(song, controller.signal)
      .then((response) => {
        if (generation === lyricsGeneration.current) {
          setLyrics(response.lines);
          setLyricsPayload(response);
        }
      })
      .catch((error: unknown) => {
        if (generation !== lyricsGeneration.current || (error instanceof DOMException && error.name === 'AbortError')) return;
        if (error instanceof ApiError && error.status === 404) {
          // No lyrics is an answer, not an error: the panel shows its empty state.
          setLyrics([]);
          setLyricsPayload(null);
          setLyricsError(null);
        } else {
          setLyrics([]);
          setLyricsPayload(null);
          setLyricsError(error instanceof Error ? error.message : 'Lyrics could not be loaded.');
        }
      })
      .finally(() => {
        if (generation === lyricsGeneration.current) setLyricsLoading(false);
      });
    return () => controller.abort();
  }, [playerSong?.id, playerSong?.source, playerSong?.title, playerSong?.artist, playerSong?.artwork]);

  // Related tracks for the player sheet. A failure just leaves the AI picks in place,
  // so there is no error surface to drive here.
  useEffect(() => {
    const song = playerSong;
    if (playerMode === 'mini' || !song) {
      setSuggestions([]);
      return undefined;
    }
    const controller = new AbortController();
    void fetchSuggestions(catalogSongId(song), controller.signal)
      .then(setSuggestions)
      .catch(() => undefined);
    return () => controller.abort();
  }, [playerSong?.id, playerSong?.source, playerSong?.title, playerSong?.artist, playerMode]);

  // The recommender needs something to reason from. With a brand-new guest — no
  // likes, no history, no taste, nothing playing — it can only answer "not enough
  // listening history", so asking at all would just be a guaranteed 404 on every
  // first load. Wait until there is a signal worth sending.
  const hasTasteSignal =
    likedSongs.length > 0 ||
    recentlyPlayed.length > 0 ||
    (account.taste?.topArtists?.length ?? 0) > 0 ||
    Boolean(playerSong?.id);

  // Taste fingerprint, not now-playing id: skipping tracks must not re-bill Bedrock.
  const tasteFingerprint = useMemo(() => {
    const liked = likedSongs.map((song) => song.id).slice(0, 30).join(',');
    const recent = recentlyPlayed.map((song) => song.id).slice(0, 20).join(',');
    const artists = (account.taste?.topArtists ?? []).slice(0, 12).join(',');
    return `${liked}|${recent}|${artists}`;
  }, [likedSongs, recentlyPlayed, account.taste?.topArtists]);
  const currentSongIdRef = useRef(playerSong ? catalogSongId(playerSong) : undefined);
  currentSongIdRef.current = playerSong ? catalogSongId(playerSong) : undefined;

  useEffect(() => {
    if (personalLoading || !hasTasteSignal) return undefined;
    const controller = new AbortController();
    // Snapshot now-playing for prompt colouring on a cache miss; deps stay taste-stable.
    fetchAiRecommendations(currentSongIdRef.current, controller.signal)
      .then((response) => {
        aiPicksRef.current = response.songs;
        setAiPicks(response.songs);
        setAiPicksReasoning(response.reasoning);
        setAiPicksProvider(response.provider);
      })
      .catch(() => {
        // Optional enhancement — quietly stay empty if unavailable (no key configured, no history yet, etc).
        aiPicksRef.current = [];
        setAiPicks([]);
      });
    return () => controller.abort();
  }, [tasteFingerprint, personalLoading, hasTasteSignal]);

  const displaySongs = query.trim() ? uniqueByIdentity(songs) : curatedSongs(featured);
  // With nothing playing, the hero previews the results. During a search that means
  // the elected release rather than whatever the provider listed first, which was
  // regularly a compilation the song merely appears on.
  const activeSong = playerSong ?? pickTopResult(displaySongs, query) ?? null;
  // A translation sits under each original line (same order and timestamps), never in place of it.
  const lyricTranslations = showTranslated && translatedLyrics ? translatedLyrics.map((line) => line.text) : null;
  const queueSongs = playerQueue.length > 0 ? playerQueue : displaySongs;
  const nextSongs = queueSongs.filter((song) => song.id !== activeSong?.id).slice(0, 3);
  const queueDuration = useMemo(() => queueSongs.reduce((total, song) => total + song.duration, 0), [queueSongs]);
  const playingNext = useMemo(() => {
    const live = playerQueue;
    if (live.length === 0) return [] as UnifiedSong[];
    const currentIndex = live.findIndex((song) => song.id === playerSong?.id);
    const start = currentIndex >= 0 ? currentIndex + 1 : 0;
    return live.slice(start);
  }, [playerQueue, playerSong?.id]);
  const playingNextDuration = useMemo(
    () => playingNext.reduce((total, song) => total + song.duration, 0),
    [playingNext]
  );
  // Queue edits happen on the device that plays. On another device a row is named by its place
  // and its ref, so an edit made while the queue moved still lands on the right song.
  const queueEditable = remotePlayback ? connectView?.queueEditable ?? false : true;
  const removeQueued = (index: number): void => {
    if (!remotePlayback) { audio.replaceUpcoming(playingNext.filter((_, at) => at !== index)); return; }
    const queued = connectView?.queue[index];
    if (queued) connect.control({ kind: 'queue_remove', index, ref: queued.ref });
  };
  const moveQueuedToNext = (index: number): void => {
    if (index <= 0) return;
    if (remotePlayback) {
      const queued = connectView?.queue[index];
      if (queued) connect.control({ kind: 'queue_move', from: index, to: 0, ref: queued.ref });
      return;
    }
    const song = playingNext[index];
    if (song) audio.replaceUpcoming([song, ...playingNext.filter((_, at) => at !== index)]);
  };
  const clearQueued = (): void => {
    if (remotePlayback) connect.control({ kind: 'queue_clear' });
    else audio.replaceUpcoming([]);
  };
  // Popular artists: one avatar per lead artist, taken from what is already on screen.
  const knownSongs = useMemo(
    () => [...displaySongs, ...(home?.trending ?? []), ...(home?.madeForYou ?? []), ...(home?.recommended ?? []), ...likedSongs, ...recentlyPlayed],
    [displaySongs, home, likedSongs, recentlyPlayed]
  );
  const artists = useMemo(() => uniqueArtists(knownSongs, 6), [knownSongs]);

  // Artist page: the provider's profile (photo, followers, top songs, albums); plain search if it is unavailable.
  useEffect(() => {
    if (!artistName) return undefined;
    const controller = new AbortController();
    setArtistLoading(true);
    setArtistError(null);
    setArtistSongs([]);
    setArtistProfile(null);
    const searchFallback = async (): Promise<UnifiedSong[]> => {
      const [first, second] = await Promise.all([
        searchSongs(artistName, controller.signal, 0),
        searchSongs(artistName, controller.signal, 1).catch(() => ({ results: [] as UnifiedSong[] }))
      ]);
      return [...first.results, ...second.results];
    };
    // One quiet retry: the provider is occasionally slow, and the fallback below has no artist photo.
    fetchArtist(artistName, controller.signal)
      .catch(async (first: unknown) => {
        if (controller.signal.aborted) throw first;
        await new Promise((resolve) => window.setTimeout(resolve, 700));
        return fetchArtist(artistName, controller.signal);
      })
      .then((profile) => {
        if (controller.signal.aborted) return;
        setArtistProfile(profile);
        setArtistSongs(profile.songs);
      })
      .catch(async () => {
        if (controller.signal.aborted) return;
        try {
          const found = await searchFallback();
          if (!controller.signal.aborted) setArtistSongs(found);
        } catch (error: unknown) {
          if (!controller.signal.aborted) setArtistError(error instanceof Error ? error.message : 'We could not load this artist right now.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setArtistLoading(false);
      });
    return () => controller.abort();
  }, [artistName, artistReload]);

  const artistTracks = useMemo(() => {
    if (!artistName) return [];
    const seen = new Set<string>();
    const dedupe = (list: readonly UnifiedSong[]): UnifiedSong[] => list.filter((song) => {
      const base = song.title.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
      if (seen.has(`id:${song.id}`) || seen.has(base)) return false;
      seen.add(`id:${song.id}`);
      seen.add(base);
      return true;
    });
    // The provider already ranks its own top songs by popularity; keep that order.
    if (artistProfile) return dedupe(artistSongs);
    const key = artistName.toLocaleLowerCase();
    const mine = (list: readonly UnifiedSong[]): UnifiedSong[] => list.filter((song) => song.artist.toLocaleLowerCase().includes(key));
    const fromSearch = mine(artistSongs);
    // If the search only returned loosely related songs, still show them rather than an empty page.
    return dedupe([...(fromSearch.length > 0 ? fromSearch : artistSongs), ...mine(knownSongs)]).sort((left, right) => right.playCount - left.playCount);
  }, [artistName, artistProfile, artistSongs, knownSongs]);

  const collaborators = useMemo(
    () => (artistName ? uniqueArtists([...artistTracks, ...knownSongs], 8, artistName, true) : []),
    [artistName, artistTracks, knownSongs]
  );
  const relatedArtists = useMemo<RelatedArtist[]>(() => {
    if (!artistName) return [];
    if (artistProfile && artistProfile.similar.length > 0) {
      return artistProfile.similar.map((artist) => ({ name: artist.name, image: artist.image ?? (faces[artist.name.toLocaleLowerCase()] || null) }));
    }
    return collaborators.map((artist) => ({ name: artist.name, song: artist.song, image: faces[artist.name.toLocaleLowerCase()] || null }));
  }, [artistName, artistProfile, collaborators, faces]);

  // The room follows the surface the listener is looking at. An artist page gets
  // first dibs on its profile photo (then its lead cover); everywhere else the
  // currently playing song owns the palette. This prevents an old song colour
  // from lingering after navigating into an artist, and restores the song colour
  // as soon as the listener leaves that route.
  const atmosphereArtwork = useMemo(() => {
    if (view === 'artist' && artistName) return artistProfile?.image ?? artistTracks[0]?.artwork ?? activeSong?.artwork ?? null;
    return activeSong?.artwork ?? null;
  }, [activeSong?.artwork, artistName, artistProfile?.image, artistTracks, view]);

  const tasteArtistKey = (account.taste?.topArtists ?? []).slice(0, 10).map((artist) => artist.name).join('|');
  const tasteArtistNames = useMemo(() => (tasteArtistKey ? tasteArtistKey.split('|') : []), [tasteArtistKey]);

  /** Artists the search panel will render — they need faces too, or every card there
   *  stays an initial forever. */
  const searchArtistNames = useMemo(
    () => (query.trim() ? artistsFromSongs(displaySongs, 18).map((artist) => artist.name) : []),
    [displaySongs, query]
  );

  // Real artist photos for the avatars on screen (Popular artists, search results,
  // related artists and the listener's own). Fetched in batches: each batch resolves
  // more names, which re-runs this and picks up the next batch.
  //
  // Deliberately no AbortController. The effect depends on `faces`, so aborting on
  // cleanup cancelled the batch that was about to populate `faces` — the names never
  // got marked, the same request went out again, and cards sat on a placeholder
  // forever. A ref records what is already in flight so re-runs skip it instead.
  useEffect(() => {
    const wanted = [...new Set([...artists, ...collaborators].map((artist) => artist.name).concat(searchArtistNames, tasteArtistNames, artistName ? [artistName] : []))]
      .filter((name) => {
        const key = name.toLocaleLowerCase();
        return key.length > 0 && !(key in faces) && !requestedFacesRef.current.has(key);
      })
      .slice(0, 12);
    if (wanted.length === 0) return;
    for (const name of wanted) requestedFacesRef.current.add(name.toLocaleLowerCase());
    void fetchArtistFaces(wanted)
      .then((found) => {
        setFaces((current) => {
          const next = { ...current };
          // Mark every name we asked about, so a provider with no photo for someone
          // resolves to "looked, nothing there" rather than pending forever.
          for (const name of wanted) next[name.toLocaleLowerCase()] = '';
          for (const face of found) if (face.image) next[face.name.toLocaleLowerCase()] = face.image;
          return next;
        });
      })
      .catch(() => {
        // Release them so a later render can try again.
        for (const name of wanted) requestedFacesRef.current.delete(name.toLocaleLowerCase());
      });
  }, [artistName, artists, collaborators, faces, searchArtistNames, tasteArtistNames]);

  const activePlaylist = useMemo(() => (playlistId ? playlists.playlists.find((playlist) => playlist.id === playlistId) ?? null : null), [playlistId, playlists.playlists]);
  const activePlaylistSongs = useMemo(
    () => (activePlaylist ? activePlaylist.songIds.map((id) => playlists.songs.get(id)).filter((song): song is LibrarySong => song !== undefined) : []),
    [activePlaylist, playlists.songs]
  );
  // Collection pages follow the now-playing cover so the aura shifts with every
  // pick inside a playlist / likes / shared room. Artist & album keep their hero art.
  const collectionSongArt = playerSong?.artwork ?? null;
  const backdropSource = view === 'artist'
    ? (artistProfile?.image ?? artistTracks[0]?.artwork ?? null)
    : view === 'playlist'
      ? (collectionSongArt ?? activePlaylist?.coverUrl ?? activePlaylistSongs[0]?.artwork ?? null)
      : view === 'liked'
        ? (collectionSongArt ?? likedSongs[0]?.artwork ?? null)
        : view === 'album'
          ? (albumSeed?.artwork ?? null)
          : view === 'shared'
            ? (collectionSongArt ?? shared?.coverUrl ?? shared?.songs[0]?.artwork ?? null)
            : null;
  const [backdropPalette, setBackdropPalette] = useState<{ source: string; palette: Palette } | null>(null);
  useEffect(() => {
    if (!backdropSource) return undefined;
    const controller = new AbortController();
    void extractPalette(backdropSource, controller.signal).then((next) => {
      if (!controller.signal.aborted) setBackdropPalette({ source: backdropSource, palette: next });
    });
    return () => controller.abort();
  }, [backdropSource]);
  // Until the page's palette is ready keep the last colours, so the field never flashes another song's tint.
  const shaderPalette = backdropSource && backdropPalette?.source === backdropSource ? backdropPalette.palette : palette;

  // The banner glows in a dark shade of the cover colour over black.
  const bannerPalette = useMemo(() => shadePalette(palette, 0.6), [palette]);
  const isCurrent = activeSong !== null && playerSong?.id === activeSong.id;
  const featureState = !isCurrent
    ? 'Ready'
    : playerIsBuffering
      ? 'Buffering'
      : playerIsPlaying
        ? 'Live'
        : 'Paused';
  /** A live query swaps Browse over to the tabbed result surface. */
  const isSearching = query.trim().length > 0;

  useEffect(() => {
    const fallbackColor = titleAccent(artistName ?? activeSong?.title ?? 'Allegra');
    if (!atmosphereArtwork) {
      setPalette(DEFAULT_PALETTE);
      setAmbientColor(fallbackColor);
      return undefined;
    }
    setAmbientColor(fallbackColor);
    const controller = new AbortController();
    void extractPalette(atmosphereArtwork, controller.signal).then((next) => {
      if (controller.signal.aborted) return;
      setPalette(next);
      setAmbientColor(next.primary);
    });
    return () => controller.abort();
  }, [activeSong?.title, artistName, atmosphereArtwork]);

  // Backgrounds drift on a timer — never pulse with the beat.
  useEffect(() => {
    shellRef.current?.style.setProperty('--audio-level', '0');
  }, []);

  // Tap a lyric line → jump there and play from it. One funnel (invariant 1):
  // seek() then requestPlayback(true), never audio.play() beside a state setter.
  // Always requests play, so tapping a line on a paused track starts it.
  const activateLyricLine = (time: number): void => {
    if (remotePlayback) {
      connect.control({ kind: 'seek', sec: time });
      if (!playerIsPlaying) connect.control({ kind: 'play' });
      return;
    }
    void (async () => {
      await audio.seek(time);
      await audio.requestPlayback(true);
    })();
  };

  const playSong = async (song: UnifiedSong, queue: UnifiedSong[] = displaySongs): Promise<void> => {
    if (await connect.playRemote(song, queue)) {
      setPlayerMode('mini');
      tapHaptic();
      return;
    }
    let playable = song;
    if (!playable.streamUrl) {
      const snapshot = snapshotForSong(playable);
      const matched = snapshot ? await resolveSnapshotForPlayback(snapshot).catch(() => null) : null;
      if (!matched) {
        setPersonalActionError('Couldn’t find this song online, so it can’t play on this device.');
        return;
      }
      playable = matched;
    }
    // Active search → always radio. Title hits are remasters/remixes of the same
    // song; Next should pull similar-vibe tracks, not the next cover variant.
    const fromSearch = Boolean(query.trim()) && queue === displaySongs;
    const radio = settings.autoplaySimilar && (fromSearch || shouldStartRadio(playable, queue));
    radioActiveRef.current = radio;
    const playableQueue = queue.map((item) => item.id === song.id ? playable : item).filter((item) => Boolean(item.streamUrl));
    audio.selectSong(playable, radio ? [playable] : uniqueByIdentity(playableQueue));
    // Stay on the current surface — the persistent mini player appears in-place.
    setPlayerMode('mini');
    // Same cap as the server keeps (RECENTLY_PLAYED_LIMIT): 25 recent listens.
    setRecentlyPlayed((current) => [playable, ...current.filter((item) => item.id !== playable.id)].slice(0, 25));
    void recordRecentlyPlayed(playable, 0).catch(() => undefined);
    tapHaptic();
    if (radio) void fillRadioQueue(catalogSongId(playable));
  };

  // Play next / Add to queue, on whichever device is playing. With nothing playing, the song starts.
  const queueSong = async (song: UnifiedSong, next: boolean): Promise<void> => {
    const sent = connect.queueRemote(song, next);
    if (sent === 'unsupported') {
      setPersonalActionError('That song can’t be queued on the device that is playing.');
      return;
    }
    tapHaptic();
    if (sent === 'sent') return;
    if (!audio.currentSong) {
      await playSong(song, [song]);
      return;
    }
    let playable = song;
    if (!playable.streamUrl) {
      const snapshot = snapshotForSong(playable);
      const matched = snapshot ? await resolveSnapshotForPlayback(snapshot).catch(() => null) : null;
      if (!matched) {
        setPersonalActionError('Couldn’t find this song online, so it can’t play on this device.');
        return;
      }
      playable = matched;
    }
    const player = transportRef.current;
    const at = player.queue.findIndex((item) => item.id === player.currentSong?.id);
    const rest = (at >= 0 ? player.queue.slice(at + 1) : []).filter((item) => item.id !== playable.id);
    player.replaceUpcoming(next ? [playable, ...rest] : [...rest, playable]);
  };
  // One stable object: every song row reads this context, and the player re-renders several times a second.
  const queueSongRef = useRef(queueSong);
  queueSongRef.current = queueSong;
  const queueActions = useMemo<QueueActions>(() => ({ add: (song, next) => { void queueSongRef.current(song, next); } }), []);

  // Keep radio topped up so end-of-track advance always has a distinct next.
  useEffect(() => {
    const song = audio.currentSong;
    if (!song || !radioActiveRef.current) return undefined;
    const index = audio.queue.findIndex((item) => item.id === song.id);
    const remaining = index >= 0 ? audio.queue.length - index - 1 : 0;
    if (remaining >= 3) return undefined;
    const controller = new AbortController();
    void fillRadioQueue(catalogSongId(song), controller.signal);
    return () => controller.abort();
  }, [audio.currentSong?.id, audio.queue.length, fillRadioQueue]);

  const playAlbumTracks = (tracks: UnifiedSong[], shuffle = false): void => {
    if (tracks.length === 0) return;
    const ordered = shuffle ? [...tracks].sort(() => Math.random() - 0.5) : tracks;
    const first = ordered[0];
    if (!first) return;
    playSong(first, ordered);
  };

  const toggleLike = (song: UnifiedSong): void => {
    const snapshot: SongSnapshot | null = snapshotForSong(song);
    const ref: SongRef | null = snapshot?.ref ?? fromAllegraSong(song);
    if (!ref) {
      setPersonalActionError('This song can’t be synced to your library.');
      return;
    }
    const key = likedKey(song);
    const wasLiked = likedIds.has(key);
    const nextLiked = !wasLiked;
    setPersonalActionError(null);
    setLikedIds((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setLikedSongs((current) => nextLiked ? [song, ...current.filter((item) => likedKey(item) !== key)] : current.filter((item) => likedKey(item) !== key));
    const op = nextLiked
      ? { op: 'like' as const, ref, ...(snapshot ? { song: snapshot } : {}), at: Date.now() }
      : { op: 'unlike' as const, ref, at: Date.now() };
    void applyLibraryOps([op]).then((result) => {
      if (result.rejected.length > 0) throw new Error('That change could not be synced. Try again.');
    }).catch((error: unknown) => {
      setLikedIds((current) => {
        const rollback = new Set(current);
        if (wasLiked) rollback.add(key);
        else rollback.delete(key);
        return rollback;
      });
      setLikedSongs((current) => wasLiked ? [song, ...current.filter((item) => likedKey(item) !== key)] : current.filter((item) => likedKey(item) !== key));
      setPersonalActionError(error instanceof Error ? error.message : 'That change could not be saved.');
    });
  };

  const retryCurrentSearch = (): void => query.trim() ? void loadSearch(query.trim()) : void loadHome();
  const retryLyrics = (): void => {
    const song = playerSong;
    if (!song) return;
    setLyricsLoading(true);
    setLyricsError(null);
    void fetchLyrics(song)
      .then((response) => {
        setLyrics(response.lines);
        setLyricsPayload(response);
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 404) {
          // No lyrics is an answer, not an error: the panel shows its empty state.
          setLyrics([]);
          setLyricsPayload(null);
        }
        else setLyricsError(error instanceof Error ? error.message : 'Lyrics could not be loaded.');
      })
      .finally(() => setLyricsLoading(false));
  };

  const loadLyricsAlternatives = (): void => {
    const song = playerSong;
    if (!song || lyricsAlternativesLoading) return;
    const generation = lyricsGeneration.current;
    setLyricsAlternativesLoading(true);
    setLyricsAlternativesError(null);
    void fetchLyricsAlternatives(song)
      .then((versions) => {
        if (generation === lyricsGeneration.current) setLyricsAlternatives(versions);
      })
      .catch((error: unknown) => {
        if (generation === lyricsGeneration.current) {
          setLyricsAlternativesError(error instanceof Error ? error.message : 'Other lyric versions could not be loaded.');
        }
      })
      .finally(() => {
        if (generation === lyricsGeneration.current) setLyricsAlternativesLoading(false);
      });
  };

  const selectLyricsAlternative = (alternative: LyricsPayload): void => {
    setLyrics(alternative.lines);
    setLyricsPayload(alternative);
    setTranslatedLyrics(null);
    setShowTranslated(false);
    setTranslateError(null);
    setTranslateProvider(null);
  };

  const toggleTranslate = (): void => {
    const song = playerSong;
    if (!song || lyrics.length === 0) return;
    if (translatedLyrics) {
      setShowTranslated((current) => !current);
      return;
    }
    setTranslating(true);
    setTranslateError(null);
    void translateLyrics(song, lyrics)
      .then((response) => {
        setTranslatedLyrics(response.lines);
        setTranslateProvider(response.provider);
        setShowTranslated(true);
      })
      .catch((error: unknown) => {
        setTranslateError(error instanceof Error ? error.message : 'Could not translate this song right now.');
      })
      .finally(() => setTranslating(false));
  };

  const pageTransition = reduced ? { duration: motionTokens.duration.instant } : undefined;
  const albumTracks = useMemo(() => {
    if (!albumSeed) return [];
    return collectAlbumTracks(albumSeed, [
      displaySongs,
      featured,
      songs,
      likedSongs,
      recentlyPlayed,
      audio.queue,
      suggestions,
      aiPicks
    ]);
  }, [albumSeed, displaySongs, featured, songs, likedSongs, recentlyPlayed, audio.queue, suggestions, aiPicks]);

  // Album needs a song to be about; without one the route shows Browse, so it must not wear the detail chrome.
  // Artists get the full-bleed cinematic hero. Playlists, Liked Songs and albums sit directly on the shader.
  const isDetailView = view === 'artist';
  const isCollectionView = view === 'playlist' || view === 'liked' || view === 'shared' || (view === 'album' && albumSeed !== null);
  // Keep shader energy stable across play/pause — flipping it made the field surge.
  const playerEnergy = 0.42;
  const immersiveOpen = playerMode === 'immersive' || playerMode === 'workspace';

  useEffect(() => {
    if (immersiveOpen && queueOpen) setQueueOpen(false);
  }, [immersiveOpen, queueOpen]);

  useEffect(() => {
    if (!immersiveOpen) return undefined;
    return lockScroll();
  }, [immersiveOpen]);

  useEffect(() => {
    if (view !== 'album' || albumSeed) return;
    // An album is about a song: use the playing one, or fall back to Browse rather than an empty route.
    if (playerSong) setAlbumSeed(playerSong);
    else window.location.replace('#discover');
  }, [view, albumSeed, playerSong]);

  const shellPalette = shaderPalette;
  // Light words over a bright background disappear (an ochre cover lights the top bar up). Past this, the
  // top bar's words go full white with a soft dark halo, which reads on bright and deep colours alike.
  const topbarBright = paletteBrightness(shellPalette) > 0.18;
  const shellStyle = {
    '--ambient-accent': shellPalette.primary || ambientColor,
    '--hero-art': activeSong?.artwork ? `url(${JSON.stringify(activeSong.artwork)})` : 'none',
    '--art-primary': shellPalette.primary,
    '--art-secondary': shellPalette.secondary,
    '--art-tertiary': shellPalette.tertiary
  } as CSSProperties;

  // "Listen on": one state for the mini player's devices button and the full player's.
  const playingElsewhere = Boolean(connectView?.activeDeviceId && connectView.activeDeviceId !== connect.deviceId);
  const pickerSong = playingElsewhere ? connectView?.song : audio.currentSong ?? undefined;
  const connectPicker: ConnectPickerState = {
    connected: connect.connected,
    otherTab: connect.tabStatus === 'other-tab',
    deviceId: connect.deviceId,
    devices: connectView?.devices ?? [],
    ...(connectView?.activeDeviceId ? { activeDeviceId: connectView.activeDeviceId } : {}),
    ...(connectView?.activeDevice ? { activeDeviceName: connectView.activeDevice.name } : {}),
    activeDeviceOnline: connectView?.activeDeviceOnline ?? true,
    isPlaying: playingElsewhere && connectView ? connectView.isPlaying : audio.isPlaying,
    ...(pickerSong ? { songTitle: pickerSong.title, songArtist: pickerSong.artist } : {}),
    autoplayBlocked: connectView?.autoplayBlocked ?? false,
    ...(connectView?.lastError ? { lastError: connectView.lastError } : {}),
    volume: playerVolume,
    onTransfer: connect.transferTo,
    onSignIn: () => setAuthOpen(true),
    onResume: () => {
      if (remotePlayback && connect.deviceId) void connect.transferTo(connect.deviceId);
      else if (connectView) connect.control({ kind: 'play' });
      else void audio.requestPlayback(true);
    },
    onVolume: changePlayerVolume,
    onRename: connect.rename
  };

  return (
    <PlaylistsContext.Provider value={playlists}>
    <QueueActionsContext.Provider value={queueActions}>
    <div ref={shellRef} className={`app-shell ${motionPaused ? 'is-motion-paused' : ''} ${navCollapsed ? 'is-nav-collapsed' : ''}`} data-theme="dark" data-motion-paused={motionPaused ? 'true' : undefined} style={shellStyle}>
      {immersiveOpen ? null : (
        <DynamicAura paused={motionPaused} energy={0.55} mood="energy" palette={shaderPalette} variant={settings.appBackground} />
      )}
      <a className="skip-link" href="#main-content">Skip to content</a>
      <AuthDialog open={authOpen} account={account} onClose={() => setAuthOpen(false)} />
      <header className="site-header">
          <div className="site-header-top"><Link className="brand" href={paths.home} aria-label="Allegra home"><img className="brand-mark" src="/allegra-logo.png" alt="" width={25} height={25} /><span className="brand-word">Allegra<i>.</i></span><span className="brand-mono" aria-hidden="true">A<i>.</i></span></Link><button className="icon-button nav-collapse-toggle" type="button" aria-label={navCollapsed ? 'Expand navigation' : 'Collapse navigation'} title={navCollapsed ? 'Expand navigation' : 'Collapse navigation'} onClick={toggleNavigation}>{navCollapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}</button></div>
          <nav className="desktop-nav" aria-label="Primary navigation">
            <Link className={`nav-link ${view === 'home' || view === 'shared' ? 'is-active' : ''}`} aria-current={view === 'home' ? 'page' : undefined} href={paths.home} title="Home"><House size={22} strokeWidth={1.5} aria-hidden="true" /><span className="nav-label">Home</span></Link>
            <Link className={`nav-link ${view === 'discover' || view === 'album' || view === 'artist' ? 'is-active' : ''}`} aria-current={view === 'discover' ? 'page' : undefined} href={paths.discover} title="Browse"><Compass size={22} strokeWidth={1.5} aria-hidden="true" /><span className="nav-label">Browse</span></Link>
            <Link className={`nav-link ${view === 'library' || view === 'playlist' ? 'is-active' : ''}`} aria-current={view === 'library' ? 'page' : undefined} href={paths.library} title="Your library">{libraryArrivals > 0 ? <span key={libraryArrivals} className="nav-arrival" aria-hidden="true" /> : null}<LibraryIcon size={22} strokeWidth={1.5} aria-hidden="true" /><span className="nav-label">Your library</span></Link>
            <span className="nav-divider" role="separator" />
            <Link className="nav-link" href={paths.library} title="Recently played" onClick={(event) => openLibrarySection(event, 'library-played-lately')}><Clock size={22} strokeWidth={1.5} aria-hidden="true" /><span className="nav-label">Recently played</span></Link>
            <Link className={`nav-link ${view === 'liked' ? 'is-active' : ''}`} aria-current={view === 'liked' ? 'page' : undefined} href={paths.liked} title="Favorite songs"><HeartIcon size={22} strokeWidth={1.5} aria-hidden="true" /><span className="nav-label">Favorite songs</span></Link>
            <Link className="nav-link" href={paths.library} title="Playlists" onClick={(event) => openLibrarySection(event, 'library-playlists')}><ListMusic size={22} strokeWidth={1.5} aria-hidden="true" /><span className="nav-label">Playlists</span></Link>
            {flags.blend ? <Link className={`nav-link ${view === 'blends' || view === 'blend' ? 'is-active' : ''}`} aria-current={view === 'blends' ? 'page' : undefined} href={paths.blends} title="Blends"><Users size={22} strokeWidth={1.5} aria-hidden="true" /><span className="nav-label">Blends</span></Link> : null}
          </nav>
          <div className="header-actions">
            <button type="button" className={`session-chip${accountResolving && !chipName ? ' is-pending' : ''}`} onClick={() => setAuthOpen(true)} aria-busy={accountResolving || undefined} aria-label={chipName ? 'Open your account' : accountResolving ? 'Checking your account' : 'Sign in or create an account'}>
              <span className="session-avatar" aria-hidden="true">{chipName ? chipName.slice(0, 1).toUpperCase() : accountResolving ? '' : 'G'}</span>
              <span className="session-copy">
                {chipName
                  ? <><strong>{chipName}</strong><small>{accountResolving ? 'Checking…' : <><i aria-hidden="true" /> Signed in</>}</small></>
                  : accountResolving
                    ? <><span className="session-skeleton" aria-hidden="true" /><span className="session-skeleton is-short" aria-hidden="true" /></>
                    : <><strong>Guest</strong><small>Sign in to keep your music</small></>}
              </span>
            </button>
            <div className="header-buttons"><Link className="icon-button app-download-link" href={`${paths.settings}#settings-android`} aria-label="Get the Android app" title="Get the Android app"><Download size={15} aria-hidden="true" /></Link><button className="motion-toggle icon-button" type="button" aria-label={motionPaused ? 'Resume background motion' : 'Pause background motion'} title={motionPaused ? 'Resume background motion' : 'Pause background motion'} onClick={() => updateSettings((current) => ({ animatedBackground: !current.animatedBackground }))}>{motionPaused ? <Play size={15} fill="currentColor" aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}</button><Link className={`icon-button settings-link${view === 'settings' ? ' is-active' : ''}`} href={paths.settings} aria-label="Settings" title="Settings" aria-current={view === 'settings' ? 'page' : undefined}><SettingsIcon size={15} aria-hidden="true" /></Link></div>
          </div>
      </header>

      <main id="main-content" ref={mainRef} tabIndex={-1} aria-label={view === 'home' ? 'Home' : view === 'library' ? 'Your listening library' : view === 'album' ? 'Album' : view === 'settings' ? 'Settings' : view === 'import' ? 'Import' : view === 'blends' || view === 'blend' || view === 'blendJoin' ? 'Blend' : isLegalView(view) ? 'Policies' : 'Discover music'} className={`content-wrap ${view !== 'discover' ? 'inner-page-wrap' : ''} ${isDetailView ? 'is-detail' : ''} ${isCollectionView ? 'is-collection' : ''}`}>
        <div className="panel-topbar" data-tone={topbarBright ? 'bright' : undefined}>
            {isDetailView || isCollectionView ? <button type="button" className="topbar-back" onClick={() => goBack(view === 'liked' || view === 'playlist' ? '#library' : view === 'shared' ? '#home' : '#discover')} aria-label="Back"><ArrowLeft size={17} aria-hidden="true" /><span>Back</span></button> : null}
            <nav className="crumbs" aria-label="Breadcrumb"><span>{view === 'home' || view === 'shared' ? 'Home' : view === 'library' || view === 'liked' || view === 'playlist' || view === 'import' || view === 'blends' || view === 'blend' || view === 'blendJoin' ? 'Library' : view === 'settings' || isLegalView(view) ? 'Allegra' : 'Browse'}</span><ChevronRight size={14} aria-hidden="true" /><strong>{view === 'home' ? 'For you' : view === 'shared' ? 'Shared playlist' : view === 'library' ? 'Your music' : view === 'album' ? 'Album' : view === 'artist' ? 'Artist' : view === 'liked' ? 'Liked Songs' : view === 'playlist' ? 'Playlist' : view === 'settings' ? 'Settings' : view === 'import' ? 'Import' : view === 'blends' ? 'Blends' : view === 'blend' ? 'Blend' : view === 'blendJoin' ? 'Join a Blend' : isLegalView(view) ? ({ privacy: 'Privacy policy', terms: 'Terms of use', copyright: 'Copyright and complaints' }[view]) : query.trim() ? 'Search' : 'Made for you'}</strong>{view === 'discover' ? <InfoTour className="crumbs-info" label="About Browse" steps={BROWSE_TOUR} stage={browseScene} /> : null}</nav>
            <div className="mood-pills" role="group" aria-label="Quick picks"><span className="mood-pills-label" aria-hidden="true">Quick picks</span>{moodPrompts.map((prompt) => <button key={prompt} type="button" className="mood-pill" aria-pressed={query === prompt} onClick={() => { if (view !== 'discover') router.push(paths.discover); setQuery(query === prompt ? '' : prompt); }}><span>{prompt}</span></button>)}</div>
            <CommandPalette
              open={paletteOpen}
              onOpen={() => setPaletteOpen(true)}
              onClose={() => setPaletteOpen(false)}
              activeQuery={query.trim()}
              recent={recentlyPlayed}
              onPlaySong={(song, queue) => playSong(song, queue)}
              onOpenArtist={openArtist}
              onNavigate={(path) => { router.push(path); }}
              onSearchAll={(value) => { if (view !== 'discover') router.push(paths.discover); setQuery(value); }}
              onClearSearch={() => setQuery('')}
            />
        </div>
        {view === 'home' ? (
          <HomePage
            profile={accountResolving ? null : account.profile}
            taste={account.taste}
            recentlyPlayed={recentlyPlayed}
            likedSongs={likedSongs}
            picks={aiPicks}
            picksReason={aiPicksReasoning}
            picksProvider={aiPicksProvider}
            trending={home?.trending ?? []}
            madeForYou={home?.madeForYou ?? []}
            recommended={home?.recommended ?? []}
            faces={faces}
            currentSongId={playerSong?.id ?? null}
            isPlaying={playerIsPlaying}
            likedIds={likedIds}
            loading={personalLoading || playlists.loading}
            onPlay={(song, queue) => playSong(song, queue)}
            onToggle={togglePlayer}
            onLike={toggleLike}
            onOpenArtist={openArtist}
            onSeedTaste={(artistNames, languageNames) => account.seed(artistNames, languageNames)}
            onOpenAuth={() => setAuthOpen(true)}
          />
        ) : view === 'shared' ? (
          sharedError ? (
            <EmptyState title="This link is not working" copy={sharedError} action={<TactileButton variant="primary" onClick={() => { router.push(paths.home); }}>Go to Home</TactileButton>} />
          ) : (
            <CollectionPage
              kind="shared"
              {...(sharedCode && shared ? { sharedCode } : {})}
              title={shared?.name ?? 'Shared playlist'}
              songs={shared?.songs ?? []}
              loading={sharedLoading}
              ownerName={shared?.ownerName ?? 'a listener'}
              {...(shared?.coverUrl ? { coverUrl: shared.coverUrl } : {})}
              currentSongId={playerSong?.id ?? null}
              isPlaying={playerIsPlaying}
              likedIds={likedIds}
              onToggle={togglePlayer}
              onPlayTrack={(song, queue) => playSong(song, queue)}
              onPlayAll={(shuffle) => playAlbumTracks(shared?.songs ?? [], shuffle)}
              onLike={toggleLike}
              onOpenAlbum={openAlbum}
              onDiscover={() => { router.push(paths.discover); }}
              onSaveCopy={async () => {
                if (!sharedCode) return;
                const copy = await saveSharedPlaylist(sharedCode);
                await playlists.reload();
                router.push(paths.playlist(copy.id));
              }}
            />
          )
        ) : isLegalView(view) ? (
          <LegalPage doc={view} />
        ) : view === 'import' ? (
          <ImportPage accountKey={knownAccount?.userId ?? null} signedIn={knownAccount !== null} onSignIn={() => setAuthOpen(true)} likedIds={likedIds} onSaved={() => void loadPersonalSpace()} />
        ) : view === 'blends' ? (
          <BlendsPage key={knownAccount?.userId ?? 'guest'} accountKey={knownAccount?.userId ?? null} signedIn={knownAccount !== null} onSignIn={() => setAuthOpen(true)} />
        ) : view === 'blend' && blendId ? (
          <BlendPage key={`${knownAccount?.userId ?? 'guest'}:${blendId}`} blendId={blendId} currentSongId={playerSong?.id ?? null} isPlaying={playerIsPlaying} likedIds={likedIds} onPlay={(song, queue) => void playSong(song, queue)} onLike={toggleLike} />
        ) : view === 'blendJoin' && inviteCode ? (
          <BlendJoinPage key={`${knownAccount?.userId ?? 'guest'}:${inviteCode}`} code={inviteCode} signedIn={knownAccount !== null} onSignIn={() => setAuthOpen(true)} />
        ) : view === 'settings' ? (
          <SettingsPage
            account={account.profile && !accountResolving ? { isGuest: account.profile.isGuest, name: account.profile.displayName ?? null, email: account.profile.email ?? null } : null}
            signInAvailable={signIn.available}
            onOpenAccount={() => setAuthOpen(true)}
            karaokeBackend={liveKaraoke.backend}
            karaokeActive={liveKaraoke.active}
          />
        ) : view === 'library' ? <LibraryPage key={knownAccount?.userId ?? 'guest'} signedIn={knownAccount !== null} onSignIn={() => setAuthOpen(true)} likedSongs={likedSongs} recentlyPlayed={recentlyPlayed} likedIds={likedIds} loading={personalLoading} error={personalError} actionError={personalActionError} currentSongId={playerSong?.id} isPlaying={playerIsPlaying} onPlay={playSong} onLike={toggleLike} onRetry={() => void loadPersonalSpace()} onDiscover={() => { router.push(paths.discover); window.setTimeout(() => setPaletteOpen(true), 0); }} /> : view === 'liked' ? <CollectionPage kind="liked" title="Liked Songs" songs={likedSongs} loading={personalLoading} currentSongId={playerSong?.id ?? null} isPlaying={playerIsPlaying} likedIds={likedIds} onToggle={togglePlayer} onPlayTrack={(song, queue) => playSong(song, queue)} onPlayAll={(shuffle) => playAlbumTracks(likedSongs, shuffle)} onLike={toggleLike} onOpenAlbum={openAlbum} onDiscover={() => { router.push(paths.discover); window.setTimeout(() => setPaletteOpen(true), 0); }} /> : view === 'playlist' ? <CollectionPage kind="playlist" title={activePlaylist?.name ?? (playlists.loading ? 'Playlist' : 'Playlist not found')} songs={activePlaylistSongs} loading={playlists.loading || (activePlaylist !== null && activePlaylistSongs.length < activePlaylist.songIds.length)} currentSongId={playerSong?.id ?? null} isPlaying={playerIsPlaying} likedIds={likedIds} onToggle={togglePlayer} onPlayTrack={(song, queue) => playSong(song, queue)} onPlayAll={(shuffle) => playAlbumTracks(activePlaylistSongs, shuffle)} onLike={toggleLike} onOpenAlbum={openAlbum} onDiscover={() => { router.push(paths.discover); window.setTimeout(() => setPaletteOpen(true), 0); }} {...(activePlaylist ? { onDelete: () => { void playlists.remove(activePlaylist.id); router.push(paths.library); }, share: { libraryId: activePlaylist.id, isPublic: activePlaylist.isPublic, onChanged: () => { void playlists.reload(); } }, cover: { libraryId: activePlaylist.id, ...(activePlaylist.coverUrl ? { coverUrl: activePlaylist.coverUrl } : {}), onUpload: playlists.setCover } } : {})} /> : view === 'artist' && artistName ? <ArtistPage name={artistName} profile={artistProfile} photoFallback={faces[artistName.toLocaleLowerCase()] || null} songs={artistTracks} related={relatedArtists} loading={artistLoading && artistTracks.length === 0} error={artistTracks.length === 0 ? artistError : null} currentSongId={playerSong?.id ?? null} isPlaying={playerIsPlaying} likedIds={likedIds} onBack={() => goBack(paths.discover)} onRetry={() => setArtistReload((count) => count + 1)} onToggle={togglePlayer} onPlayTrack={(song, queue) => playSong(song, queue)} onPlayAll={(shuffle) => playAlbumTracks(artistTracks, shuffle)} onLike={toggleLike} onOpenAlbum={openAlbumByName} onOpenArtist={openArtist} /> : view === 'album' && albumSeed ? <AlbumPage seed={albumSeed} tracks={albumTracks} palette={palette} currentSongId={playerSong?.id ?? null} isPlaying={playerIsPlaying} likedIds={likedIds} onPlayTrack={(song, queue) => playSong(song, queue)} onPlayAll={() => playAlbumTracks(albumTracks, false)} onShuffle={() => playAlbumTracks(albumTracks, true)} onLike={toggleLike} onLikeAlbum={() => toggleLike(albumSeed)} albumLiked={likedIds.has(likedKey(albumSeed))} /> : <>
        <div className="browse-grid">
          <div className="browse-main">
            <motion.section className="hero-banner" variants={pageVariants} initial="hidden" animate="visible" transition={pageTransition} aria-label="Featured track" data-live={playerIsPlaying ? 'true' : undefined} data-searching={isSearching ? 'true' : undefined}>
                 <div className="hero-banner-shader" aria-hidden="true"><MusicFlowShader energy={0.55} palette={bannerPalette} /></div>
              <motion.div className="hero-banner-copy" variants={itemVariants}>
                <span className="hero-banner-eyebrow">{isCurrent ? 'Now playing' : 'Curated playlist'}</span>
                <h1>{activeSong ? activeSong.title.replace(/\s*\([^)]*\)\s*/g, ' ').trim() : 'Good music, ready when you are'}</h1>
                <p>{activeSong ? `${activeSong.artist}${activeSong.album ? ` · ${activeSong.album}` : ''}` : 'Search a song, an artist, or a mood and press play.'}</p>
                <div className="hero-banner-actions">
                  <TactileButton variant="primary" icon={isCurrent && playerIsPlaying ? Pause : Play} onClick={() => { if (!activeSong) setPaletteOpen(true); else if (isCurrent) togglePlayer(); else void playSong(activeSong); }}>{isCurrent && playerIsPlaying ? 'Pause' : activeSong ? 'Play' : 'Start searching'}</TactileButton>
                  <span className="hero-banner-meta">{displaySongs.length} tracks · {formatTime(queueDuration)}</span>
                </div>
              </motion.div>
              {activeSong ? <motion.div className="hero-banner-art" variants={itemVariants}><Artwork song={activeSong} size="large" /></motion.div> : null}
            </motion.section>

            {!isSearching && artists.length > 0 ? <section className="artist-section" aria-labelledby="artists-heading"><div className="section-heading"><h2 id="artists-heading">Popular artists</h2></div><div className="artist-list">{artists.map((artist) => <ArtistPreviewCard key={artist.name} name={artist.name} image={faces[artist.name.toLocaleLowerCase()] || null} photoPending={!(artist.name.toLocaleLowerCase() in faces)} currentSongId={playerSong?.id ?? null} isPlaying={playerIsPlaying} onPlayTrack={(song, queue) => playSong(song, queue)} onOpenArtist={openArtist} />)}</div></section> : null}


            {isSearching ? (
              <SearchResults
                query={query.trim()}
                songs={displaySongs}
                playlists={playlists.playlists}
                faces={faces}
                searching={searching}
                error={searchError}
                currentSongId={playerSong?.id ?? null}
                isPlaying={playerIsPlaying}
                likedIds={likedIds}
                onPlayTrack={(song, queue) => playSong(song, queue)}
                onLike={toggleLike}
                onOpenAlbum={openAlbum}
                onOpenArtist={openArtist}
                onOpenPlaylist={(id) => { router.push(paths.playlist(id)); }}
                onRetry={retryCurrentSearch}
              />
            ) : (
              <DiscoverSections
                trending={home?.trending ?? []}
                madeForYou={home?.madeForYou ?? []}
                recommended={home?.recommended ?? []}
                chart={home?.chart ?? null}
                languages={homeLanguages}
                picks={aiPicks}
                currentSongId={playerSong?.id ?? null}
                isPlaying={playerIsPlaying}
                likedIds={likedIds}
                onPlay={(song, queue) => playSong(song, queue)}
                onToggle={togglePlayer}
                onLike={toggleLike}
                onExplore={(value) => setQuery(value)}
              />
            )}

          </div>

          <aside id="queue" ref={nowPlayingRef} className="now-panel" aria-label="Now playing">
            <div className="now-panel-head"><h2>Now Playing</h2><span className="now-panel-state" data-live={playerIsPlaying && isCurrent ? 'true' : undefined}>{featureState}</span></div>
            {activeSong ? <>
              <button type="button" className="now-panel-art" onClick={() => { if (isCurrent) togglePlayer(); else void playSong(activeSong); }} aria-label={`${isCurrent && playerIsPlaying ? 'Pause' : 'Play'} ${activeSong.title}`}>
                <Artwork song={activeSong} size="large" layoutId={`art-${activeSong.id}`} />
                <span className="now-panel-play">{playerIsBuffering && isCurrent ? <Disc3 size={20} className="spin" aria-hidden="true" /> : isCurrent && playerIsPlaying ? <Pause size={20} fill="currentColor" aria-hidden="true" /> : <Play size={20} fill="currentColor" aria-hidden="true" />}</span>
              </button>
              <div className="now-panel-info"><div><h3>{activeSong.title}</h3><p>{activeSong.artist}</p></div><IconButton icon={HeartIcon} label={likedIds.has(likedKey(activeSong)) ? 'Remove from likes' : 'Add to likes'} active={likedIds.has(likedKey(activeSong))} onClick={() => toggleLike(activeSong)} /></div>
              <FeatureProgress playhead={playhead} duration={playerDuration} current={isCurrent} />
              <div className="now-panel-foot"><FeatureRemaining playhead={playhead} duration={isCurrent && playerDuration > 0 ? playerDuration : activeSong.duration} current={isCurrent && playerDuration > 0} /><button type="button" className="feature-open" onClick={() => { if (playerSong) setPlayerMode('immersive'); else void playSong(activeSong); }}>View player</button></div>
            </> : <div className="feature-loading"><Disc3 size={24} className="spin" aria-hidden="true" /><span>Loading your first song</span></div>}
            <div className="now-panel-queue">
              <div className="queue-heading"><h3>Up next</h3><span>{queueSongs.length} tracks · {formatTime(queueDuration)}</span></div>
              <div className="queue-items">{queueSongs.filter((song) => song.id !== activeSong?.id).slice(0, 4).map((song) => <button className="queue-item" key={song.id} onClick={() => playSong(song)}><Artwork song={song} size="small" /><span className="queue-item-copy"><strong>{song.title}</strong><small>{song.artist}</small></span><span className="queue-item-time">{formatTime(song.duration)}</span></button>)}{nextSongs.length === 0 ? <div className="queue-empty"><Disc3 size={19} /><span>Choose a song to build your queue.</span></div> : null}</div>
            </div>
          </aside>
        </div>
        </>}
      </main>

      <AnimatePresence>
        {queueOpen && playerSong && !immersiveOpen ? (
          <motion.button
            key="am-queue-scrim"
            type="button"
            className="am-queue-scrim"
            aria-label="Close playing next"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? motionTokens.duration.instant : motionTokens.duration.fast, ease: motionTokens.ease.standard }}
            onClick={() => setQueueOpen(false)}
          />
        ) : null}
      </AnimatePresence>

      {/* Phone tab bar (Apple HIG / Material navigation-bar pattern): four labelled destinations,
          navigation only. CSS shows it under 900px, where the mini player docks on top of it as a
          shelf and the desktop rail's links give way to it. */}
      <nav className="bottom-nav" aria-label="Primary">
        <Link className={`bottom-nav__item${view === 'home' || view === 'shared' ? ' is-active' : ''}`} href={paths.home} aria-current={view === 'home' ? 'page' : undefined}>
          <House size={22} strokeWidth={1.7} aria-hidden="true" /><span>Home</span>
        </Link>
        <Link className={`bottom-nav__item${view === 'discover' || view === 'album' || view === 'artist' ? ' is-active' : ''}`} href={paths.discover} aria-current={view === 'discover' ? 'page' : undefined}>
          <Compass size={22} strokeWidth={1.7} aria-hidden="true" /><span>Browse</span>
        </Link>
        <Link className={`bottom-nav__item${view === 'library' || view === 'playlist' || view === 'liked' ? ' is-active' : ''}`} href={paths.library} aria-current={view === 'library' ? 'page' : undefined}>
          {libraryArrivals > 0 ? <span key={libraryArrivals} className="nav-arrival" aria-hidden="true" /> : null}
          <LibraryIcon size={22} strokeWidth={1.7} aria-hidden="true" /><span>Library</span>
        </Link>
        <button type="button" className={`bottom-nav__item${paletteOpen ? ' is-active' : ''}`} aria-haspopup="dialog" onClick={() => setPaletteOpen(true)}>
          <SearchIcon size={22} strokeWidth={1.7} aria-hidden="true" /><span>Search</span>
        </button>
      </nav>

      {playerSong && !immersiveOpen ? (
        <motion.div
          className={`mini-player${queueOpen ? ' is-queue-open' : ''}`}
          role="region"
          aria-label="Player bar"
          // Centred with translateX(-50%). Motion writes its own inline transform once a drag
          // starts (any tap on play/pause), which would drop the CSS one and shove the bar right;
          // handing it the offset keeps both in the one transform it writes.
          style={{ x: '-50%' }}
          drag={isNarrowViewport && !reduced ? 'y' : false}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0.3, bottom: 0 }}
          onDragEnd={(_event, info) => {
            if (info.offset.y < -80 || info.velocity.y < -500) setPlayerMode('immersive');
          }}
        >
          <div className="am-transport">
            <button type="button" className={`am-btn ${playerShuffle ? 'is-on' : ''}`} aria-pressed={playerShuffle} aria-label={playerShuffle ? 'Shuffle on' : 'Shuffle off'} title="Shuffle" onClick={togglePlayerShuffle}><Shuffle size={16} aria-hidden="true" /></button>
            <button type="button" className="am-btn am-btn--skip" aria-label="Previous track" title="Previous" onClick={previousPlayer}><SkipBack size={20} fill="currentColor" aria-hidden="true" /></button>
            <button type="button" className="am-play" onClick={togglePlayer} aria-label={playerIsPlaying ? 'Pause' : 'Play'}>
              {playerIsBuffering ? <Disc3 size={20} className="spin" aria-hidden="true" /> : playerIsPlaying ? <Pause size={22} fill="currentColor" aria-hidden="true" /> : <Play size={22} fill="currentColor" aria-hidden="true" />}
            </button>
            <button type="button" className="am-btn am-btn--skip" aria-label="Next track" title="Next" onClick={skipNextSmart}><SkipForward size={20} fill="currentColor" aria-hidden="true" /></button>
            <button type="button" className={`am-btn ${playerRepeat !== 'off' ? 'is-on' : ''}`} aria-pressed={playerRepeat !== 'off'} aria-label={`Repeat ${playerRepeat}`} title={playerRepeat === 'one' ? 'Repeat this song' : playerRepeat === 'all' ? 'Repeat all' : 'Repeat off'} onClick={cyclePlayerRepeat}>{playerRepeat === 'one' ? <Repeat1 size={16} aria-hidden="true" /> : <Repeat size={16} aria-hidden="true" />}</button>
          </div>

          <div className="am-now">
            <button type="button" className="am-art" onClick={() => setPlayerMode('immersive')} aria-label="Expand player"><Artwork song={playerSong} size="small" /></button>
            <div className="am-now-body">
              <button type="button" className="am-meta" onClick={() => setPlayerMode('immersive')}>
                <strong>{playerSong.title}</strong>
                <span>{[playerSong.artist, playerSong.album].filter(Boolean).join(' \u2014 ')}</span>
              </button>
              <BarScrubber playhead={playhead} duration={playerDuration} onSeek={seekPlayer} />
            </div>
            <IconButton icon={HeartIcon} label={likedIds.has(likedKey(playerSong)) ? 'Remove from likes' : 'Add to likes'} active={likedIds.has(likedKey(playerSong))} onClick={() => toggleLike(playerSong)} />
          </div>

          <div className="am-right">
            <button type="button" className="am-btn am-btn--mute" aria-label={playerVolume === 0 ? 'Unmute' : 'Mute'} title={playerVolume === 0 ? 'Unmute' : 'Mute'} onClick={() => changePlayerVolume(playerVolume === 0 ? 1 : 0)}>{playerVolume === 0 ? <VolumeX size={17} aria-hidden="true" /> : <Volume2 size={17} aria-hidden="true" />}</button>
            <input
              type="range"
              className="am-range am-volume"
              aria-label="Volume"
              min={0}
              max={1}
              step={0.01}
              value={barVolume ?? playerVolume}
              style={{ '--fill': `${(barVolume ?? playerVolume) * 100}%` } as CSSProperties}
              onChange={(event) => dragBarVolume(Number(event.target.value))}
              onPointerUp={commitBarVolume}
              onPointerCancel={() => setBarVolume(null)}
              onKeyUp={commitBarVolume}
              onBlur={commitBarVolume}
            />
            <ConnectPicker connect={connectPicker} variant="bar" />
            <button type="button" className="am-btn am-btn--lyrics" aria-label="Lyrics" title="Lyrics" onClick={() => setPlayerMode('workspace')}><Waves size={17} aria-hidden="true" /></button>
            <button
              ref={queueToggleRef}
              type="button"
              className={`am-btn am-btn--queue ${queueOpen ? 'is-on' : ''}`}
              aria-pressed={queueOpen}
              aria-expanded={queueOpen}
              aria-controls="am-playing-next"
              aria-label="Playing next"
              title="Playing next"
              onClick={() => setQueueOpen((open) => !open)}
            >
              <ListMusic size={17} aria-hidden="true" />
              {playingNext.length > 0 ? <span className="am-queue-badge" aria-hidden="true">{Math.min(playingNext.length, 99)}</span> : null}
            </button>
          </div>

          <AnimatePresence>
            {queueOpen ? (
              <motion.div
                key="am-queue"
                ref={queuePanelRef}
                id="am-playing-next"
                className="am-queue"
                role="dialog"
                aria-modal="true"
                aria-label="Playing next"
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
                animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
                transition={reduced ? { duration: motionTokens.duration.instant } : spring.sheet}
              >
                <div className="am-queue-head">
                  <div className="am-queue-title">
                    <strong>Playing Next</strong>
                    <span>
                      {playingNext.length === 0
                        ? 'Queue empty'
                        : `${playingNext.length} ${playingNext.length === 1 ? 'song' : 'songs'} · ${formatTime(playingNextDuration)}`}
                    </span>
                  </div>
                  <div className="am-queue-tools">
                    {queueEditable && playingNext.length > 0 ? (
                      <button type="button" className="am-queue-clear" onClick={clearQueued}>Clear</button>
                    ) : null}
                    <button type="button" className="am-btn am-queue-close" aria-label="Close playing next" onClick={() => setQueueOpen(false)}>
                      <X size={16} aria-hidden="true" />
                    </button>
                  </div>
                </div>

                {playerSong ? (
                  <div className="am-queue-now" aria-label="Now playing">
                    <span className="am-queue-eyebrow">Now playing</span>
                    <div className="am-queue-row is-current">
                      <Artwork song={playerSong} size="small" />
                      <span className="am-queue-copy">
                        <strong>{playerSong.title}</strong>
                        <small>{playerSong.artist}</small>
                      </span>
                      <span className="am-queue-meta">{playerIsPlaying ? 'Playing' : 'Paused'}</span>
                    </div>
                  </div>
                ) : null}

                <div className="am-queue-section">
                  <span className="am-queue-eyebrow">Up next</span>
                  <div className="am-queue-list">
                    {playingNext.length === 0 ? (
                      <div className="am-queue-empty">
                        <ListMusic size={18} aria-hidden="true" />
                        <span>Nothing queued after this song. Play an album or search to build a queue.</span>
                      </div>
                    ) : (
                      playingNext.slice(0, 16).map((song, index) => (
                        <div key={`${song.id}-${index}`} className="am-queue-item">
                          <button
                            type="button"
                            className="am-queue-row"
                            aria-label={`Play ${song.title} by ${song.artist}`}
                            onClick={() => {
                              void playSong(song, playerQueue);
                              setQueueOpen(false);
                            }}
                          >
                            <span className="am-queue-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                            <Artwork song={song} size="small" />
                            <span className="am-queue-copy">
                              <strong>{song.title}</strong>
                              <small>{song.artist}</small>
                            </span>
                            <span className="am-queue-time">{formatTime(song.duration)}</span>
                          </button>
                          {queueEditable ? (
                            <span className="am-queue-edit">
                              {index > 0 ? (
                                <button type="button" className="am-btn" aria-label={`Play ${song.title} next`} title="Play next" onClick={() => moveQueuedToNext(index)}>
                                  <ArrowUpToLine size={15} aria-hidden="true" />
                                </button>
                              ) : null}
                              <button type="button" className="am-btn" aria-label={`Remove ${song.title} from the queue`} title="Remove" onClick={() => removeQueued(index)}>
                                <X size={15} aria-hidden="true" />
                              </button>
                            </span>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </motion.div>
      ) : null}
      <p className="sr-only" aria-live="polite">{playerSong ? `${playerIsPlaying ? 'Playing' : 'Paused'} ${playerSong.title} by ${playerSong.artist}` : ''}</p>
      <audio ref={audio.audioRef} className="audio-element" crossOrigin="anonymous" preload="metadata" aria-hidden="true" />
      <PlayerPanel
        mode={playerMode === 'workspace' ? 'workspace' : 'immersive'}
        song={immersiveOpen ? playerSong : null}
        queue={playerQueue}
        playhead={playhead}
        duration={playerDuration}
        isPlaying={playerIsPlaying}
        isBuffering={playerIsBuffering}
        playbackError={playerError}
        liked={playerSong ? likedIds.has(likedKey(playerSong)) : false}
        lyrics={{
          lines: lyrics,
          translations: lyricTranslations,
          playhead,
          playing: playerIsPlaying,
          loading: lyricsLoading,
          error: lyricsError,
          onRetry: retryLyrics,
          onSeek: seekPlayer,
          onActivateLine: activateLyricLine,
          artworkUrl: playerSong?.artwork,
          translating,
          translated: showTranslated,
          translateError,
          translateProvider,
          onToggleTranslate: toggleTranslate,
          source: lyricsPayload?.source,
          matchReason: lyricsPayload?.matchReason,
          alternatives: lyricsAlternatives,
          alternativesLoading: lyricsAlternativesLoading,
          alternativesError: lyricsAlternativesError,
          onLoadAlternatives: loadLyricsAlternatives,
          onSelectAlternative: selectLyricsAlternative,
          songId: playerSong?.id ?? null
        }}
        palette={palette}
        energy={playerEnergy}
        suggestions={suggestions.length > 0 ? suggestions : aiPicks}
        muted={remotePlayback ? playerVolume <= 0 : audio.isMuted}
        onMute={() => { if (remotePlayback) changePlayerVolume(playerVolume <= 0 ? 1 : 0); else audio.toggleMute(); }}
        liveKaraoke={remotePlayback ? undefined : liveKaraoke}
        onCollapse={collapsePlayer}
        onOpenWorkspace={() => setPlayerMode('workspace')}
        onOpenImmersive={() => setPlayerMode('immersive')}
        onToggle={togglePlayer}
        onNext={skipNextSmart}
        onPrevious={previousPlayer}
        repeat={playerRepeat}
        onCycleRepeat={cyclePlayerRepeat}
        shuffle={playerShuffle}
        onToggleShuffle={togglePlayerShuffle}
        onSeek={seekPlayer}
        onLike={() => { if (playerSong) toggleLike(playerSong); }}
        onPlayQueueSong={(song) => void playSong(song, playerQueue.length > 0 ? playerQueue : displaySongs)}
        connect={connectPicker}
        onOpenAlbum={openAlbumFromPlayer}
        onOpenArtist={openArtistFromPlayer}
      />
      <OfflineToast visible={offline} />
      <NoticeToast notice={connect.notice} onDone={connect.dismissNotice} />
    </div>
    </QueueActionsContext.Provider>
    </PlaylistsContext.Provider>
  );
}
