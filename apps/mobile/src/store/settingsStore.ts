/**
 * LyricFlow - Settings Store (Zustand)
 * Manages user preferences with AsyncStorage persistence
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { SortOption, ViewMode } from '../types/song';
import { createDebouncedStorage } from './debouncedStorage';

const settingsStorage = createDebouncedStorage(1000);

type Theme = 'dark' | 'light' | 'auto';
export type LyricsAlign = 'left' | 'center' | 'right';
/** How the sung line lights up: letter by letter as it is sung (Echo Music's karaoke fill), or the whole line at once. */
export type LyricsHighlight = 'letters' | 'lines';
type LineSpacing = 'compact' | 'normal' | 'relaxed';
type ScrollSpeed = 'slow' | 'medium' | 'fast';

/** The pill's own material: Echo's two, plus Apple-style liquid glass and plain black. */
export type MiniPlayerBackground = 'glow' | 'tint' | 'glass' | 'black';
/**
 * 'blend' is Apple + glow: the Apple Music room, gliding into the glow when lyrics open.
 * 'aura' is our own, "Cover glow": black through the middle with two tones of the
 * cover pouring in from the top and bottom edges, drifting slowly, and the artwork
 * as a card. (It was the "Shader wash" until 2026-10; the stored value stayed.)
 */
export type PlayerBackground = 'blend' | 'apple' | 'youtube' | 'aura';

/** The two styles that show the artwork as a card instead of a full-bleed cover. */
export const isCardPlayerBackground = (value: PlayerBackground): boolean => value === 'youtube' || value === 'aura';
/**
 * Behind every screen: the live shader, the lite frosted glass tinted by the
 * song, or the glow (the mini player's animated glow across the top, black below).
 */
export type AppBackground = 'shader' | 'glass' | 'glow';

/**
 * Settings â†’ Reduce effects. 'auto' lets the phone decide (utils/performanceTier: old CPU cores, low memory, or
 * frames that kept missing); 'on' always takes the light path; 'off' keeps the full visuals even on a slow phone.
 */
export type ReduceEffects = 'auto' | 'on' | 'off';
/** Settings → Library → Opens on. */
export type LibraryStartTab = 'Songs' | 'Playlists' | 'Artists' | 'Albums';
export const LIBRARY_START_TABS: readonly LibraryStartTab[] = ['Songs', 'Playlists', 'Artists', 'Albums'];
/** The home-screen widget holds at most this many pinned playlists. */
export const WIDGET_PIN_LIMIT = 4;

/** Pinned widget playlists: unique ids in the order chosen, at most four. */
export const normalizePinnedPlaylists = (ids: unknown): string[] => {
  if (!Array.isArray(ids)) return [];
  const out: string[] = [];
  for (const id of ids) {
    if (typeof id === 'string' && id.length > 0 && !out.includes(id)) out.push(id);
    if (out.length === WIDGET_PIN_LIMIT) break;
  }
  return out;
};

/** A pin toggled from Settings: added at the end while there is room, removed if it was pinned. */
export const togglePinnedPlaylist = (ids: readonly string[], id: string): string[] =>
  ids.includes(id) ? ids.filter(x => x !== id) : normalizePinnedPlaylists([...ids, id]);

export const normalizeLibraryStartTab = (tab: unknown): LibraryStartTab =>
  LIBRARY_START_TABS.includes(tab as LibraryStartTab) ? (tab as LibraryStartTab) : 'Songs';

/**
 * Stored settings from before "Glow animated" was retired still say 'glow';
 * the closest look left is Apple + glow. Anything unknown gets the default.
 */
/**
 * Settings â†’ Lyrics â†’ Timing, in seconds added to the playback position: 0 is "in sync" (the row says so).
 * The default used to be âˆ’1.2, a leftover from the first player, which lit every line 1.2 seconds after it
 * began and showed "Timing âˆ’1.2s" on a fresh install.
 */
export const DEFAULT_LYRICS_DELAY = 0;
/** The old default. A saved value of exactly this was never chosen, so settings v5 moves it to in sync. */
const OLD_DEFAULT_LYRICS_DELAY = -1.2;

/** The timing a saved setting should carry after migration: untouched old default â†’ in sync; any chosen value kept. */
export const migrateLyricsDelay = (version: number, saved: unknown): number => {
  if (typeof saved !== 'number' || !Number.isFinite(saved)) return DEFAULT_LYRICS_DELAY;
  return version < 5 && Math.abs(saved - OLD_DEFAULT_LYRICS_DELAY) < 1e-6 ? DEFAULT_LYRICS_DELAY : saved;
};

export const normalizePlayerBackground = (value: unknown): PlayerBackground =>
  (value === 'apple' || value === 'youtube' || value === 'aura' ? value : 'blend');

/** Choosing Cover glow shows its own layout, the artwork card on black; a tap on the cover still flips it. */
export const playerBackgroundChange = (playerBackground: PlayerBackground): Pick<SettingsState, 'playerBackground'> & Partial<Pick<SettingsState, 'playerCoverFull'>> =>
  (playerBackground === 'aura' ? { playerBackground, playerCoverFull: false } : { playerBackground });

export const normalizeMiniPlayerBackground = (value: unknown): MiniPlayerBackground =>
  (value === 'tint' || value === 'glass' || value === 'black' ? value : 'glow');

interface SettingsState {
  // Appearance
  theme: Theme;
  defaultGradientId: string;
  /** Lyric text size in points (LYRICS_SIZE_MIN..MAX). */
  lyricsSize: number;
  /** Where lyric lines sit; a song's own centre/right alignment (lyrics editor) wins. */
  lyricsAlign: LyricsAlign;
  /** Letter by letter uses a source's word timings, or estimates them for a line-synced song. */
  lyricsHighlight: LyricsHighlight;
  autoScrollPlainLyrics: boolean;
  lineSpacing: LineSpacing;

  // Playback
  scrollSpeed: ScrollSpeed;
  skipDuration: 10 | 15 | 30;
  keepScreenOn: boolean;
  /** Echo Music's "auto load more": a queue running out is topped up with songs like the one playing. */
  autoQueueRefill: boolean;
  /** The mini player's sideways swipe skips on Android's main thread (components/NativeSwipeSkip). Off by default. */
  nativeMiniSwipe: boolean;
  setNativeMiniSwipe: (v: boolean) => void;
  /** Listening stats (1.45.0): keep a log of what is heard on this phone. On by default; never leaves the phone. */
  listeningStats: boolean;
  hapticsEnabled: boolean;
  showTimeRemaining: boolean;
  playInMiniPlayerOnly: boolean;
  navBarStyle: 'classic' | 'modern-pill'; // NEW: Navbar style
  voiceMode: 'hold' | 'tap';
  micEnabled: boolean;
  libraryBackgroundMode: 'daily' | 'aurora' | 'current' | 'black' | 'grey' | 'theme-blue' | 'purest-black' | 'theme-subtle';
  classicBarBgMode: 'album-art' | 'song-gradient' | 'aurora' | 'purest-black' | 'grey' | 'theme-subtle' | 'theme-blue';
  animateBackground: boolean;
  libraryFocusMode: boolean; // Toggle for "Focus Mode" (Black Background)
  showPerformanceHUD: boolean; // Toggle for FPS counter
  applyThemeToOtherPages: boolean; // Option to apply theme to playlists and settings pages

  // Library
  defaultView: ViewMode;
  defaultSort: SortOption;
  /** Which Library tab opens first (Settings → Library). */
  libraryStartTab: LibraryStartTab;
  setLibraryStartTab: (tab: LibraryStartTab) => void;
  /** Holding the Library tab for 2 s opens this playlist; null leaves the long press alone. */
  libraryHoldPlaylistId: string | null;
  setLibraryHoldPlaylistId: (id: string | null) => void;
  /** Up to four playlists on the home-screen widget; a tap plays one without opening the app. */
  widgetPinnedPlaylistIds: string[];
  setWidgetPinnedPlaylistIds: (ids: string[]) => void;
  /** Playlists downloaded for offline play: songs added to them later download too. */
  offlinePlaylistIds: string[];
  setPlaylistOffline: (id: string, offline: boolean) => void;
  showThumbnails: boolean;

  // Persistence
  playlistHistory: Record<string, string>; // playlistId -> lastSongId

  // Downloads
  downloadDirectoryUri: string | null;

  // Actions
  setTheme: (theme: Theme) => void;
  setDefaultGradient: (gradientId: string) => void;
  setLyricsSize: (size: number) => void;
  setLyricsAlign: (align: LyricsAlign) => void;
  setLyricsHighlight: (highlight: LyricsHighlight) => void;
  setAutoScrollPlainLyrics: (enabled: boolean) => void;
  setLineSpacing: (spacing: LineSpacing) => void;
  setScrollSpeed: (speed: ScrollSpeed) => void;
  setSkipDuration: (duration: 10 | 15 | 30) => void;
  setKeepScreenOn: (enabled: boolean) => void;
  setAutoQueueRefill: (enabled: boolean) => void;
  setListeningStats: (enabled: boolean) => void;
  setHapticsEnabled: (enabled: boolean) => void;
  setShowTimeRemaining: (show: boolean) => void;
  setPlayInMiniPlayerOnly: (enabled: boolean) => void;
  setNavBarStyle: (style: 'classic' | 'modern-pill') => void; // NEW: Navbar action
  setVoiceMode: (mode: 'hold' | 'tap') => void;
  setMicEnabled: (enabled: boolean) => void;
  setLibraryBackgroundMode: (mode: 'daily' | 'aurora' | 'current' | 'black' | 'grey' | 'theme-blue' | 'purest-black' | 'theme-subtle') => void;
  setClassicBarBgMode: (mode: 'album-art' | 'song-gradient' | 'aurora' | 'purest-black' | 'grey' | 'theme-subtle' | 'theme-blue') => void;
  setAnimateBackground: (enabled: boolean) => void;
  setLibraryFocusMode: (enabled: boolean) => void;
  setShowPerformanceHUD: (enabled: boolean) => void;
  setDefaultView: (view: ViewMode) => void;
  setDefaultSort: (sort: SortOption) => void;
  setShowThumbnails: (show: boolean) => void;

  // History Actions
  updatePlaylistHistory: (playlistId: string, songId: string) => void;
  setDownloadDirectory: (uri: string | null) => void;
  setApplyThemeToOtherPages: (enabled: boolean) => void;

  // Quick pins (3 customizable shortcut slots on Settings home)
  quickPins: [string, string, string];
  setQuickPins: (pins: [string, string, string]) => void;

  // Advanced
  lyricsDelay: number;
  setLyricsDelay: (delay: number) => void;

  // Beta
  ytVideoPreview: boolean;
  setYtVideoPreview: (enabled: boolean) => void;
  youtubeApiKey: string;
  setYoutubeApiKey: (key: string) => void;

  // Canvas: looping motion artwork behind the player (Echo Music providers)
  canvasEnabled: boolean;
  appBackground: AppBackground;
  setAppBackground: (v: AppBackground) => void;
  /** Echo's mini player background: 'glow' (Glow animated) or 'tint' (calm cover tone). */
  miniPlayerBackground: MiniPlayerBackground;
  /** Echo's "Apple Music inspired" player: full-bleed cover. Off = a floating artwork card. */
  appleMusicInspired: boolean;
  /** Echo's "Hide volume slider" (Apple Music player only). */
  hidePlayerVolume: boolean;
  /** Experimental (1.49.0): the player follows the finger from the mini player and the cover glides into place. Off by default. */
  fluidPlayer: boolean;
  setFluidPlayer: (v: boolean) => void;
  /** 'blend' = Apple Music for the cover, Glow animated once lyrics open; 'youtube' = YouTube Music's colour wash with an artwork card; 'aura' = Cover glow, black with the cover's two tones drifting in from the top and bottom edges. */
  playerBackground: PlayerBackground;
  setMiniPlayerBackground: (v: MiniPlayerBackground) => void;
  setAppleMusicInspired: (v: boolean) => void;
  setHidePlayerVolume: (v: boolean) => void;
  setPlayerBackground: (v: PlayerBackground) => void;
  /** YouTube Music / Shader wash players: the cover runs full-bleed (the default) or is a card (tap the cover). */
  playerCoverFull: boolean;
  setPlayerCoverFull: (v: boolean) => void;
  setCanvasEnabled: (enabled: boolean) => void;
  /** Your own Apple MusicKit developer token â€” unlocks Apple motion artwork. */
  appleMusicToken: string;
  setAppleMusicToken: (token: string) => void;
  /** Optional Tidal client token â€” unlocks Tidal video covers. */
  tidalToken: string;
  setTidalToken: (token: string) => void;

  /** Luvs clips open on the song's hook instead of the intro (Spotify-style). */
  luvsStartAtHook: boolean;
  setLuvsStartAtHook: (enabled: boolean) => void;

  reduceEffects: ReduceEffects;
  setReduceEffects: (v: ReduceEffects) => void;

  resetToDefaults: () => void;
}

const DEFAULT_SETTINGS = {
  theme: 'dark' as Theme,
  defaultGradientId: 'aurora',
  lyricsSize: 28,
  lyricsAlign: 'left' as LyricsAlign,
  lyricsHighlight: 'letters' as LyricsHighlight,
  autoScrollPlainLyrics: true,
  lineSpacing: 'normal' as LineSpacing,
  scrollSpeed: 'medium' as ScrollSpeed,
  skipDuration: 15 as const,
  keepScreenOn: true,
  autoQueueRefill: true,
  nativeMiniSwipe: false,
  listeningStats: true,
  hapticsEnabled: true,
  showTimeRemaining: true,
  playInMiniPlayerOnly: false,
  navBarStyle: 'modern-pill' as const, // Default to modern pill navbar
  voiceMode: 'hold' as const,
  micEnabled: true,
  libraryBackgroundMode: 'daily' as const,
  classicBarBgMode: 'album-art' as const,
  animateBackground: true,
  libraryFocusMode: false, // Default disabled
  defaultView: 'grid' as ViewMode,
  defaultSort: 'recent' as SortOption,
  libraryStartTab: 'Songs' as LibraryStartTab,
  libraryHoldPlaylistId: null as string | null,
  widgetPinnedPlaylistIds: [] as string[],
  offlinePlaylistIds: [] as string[],
  showThumbnails: true,
  showPerformanceHUD: false, // Default disabled
  downloadDirectoryUri: null,
  applyThemeToOtherPages: false,
  lyricsDelay: DEFAULT_LYRICS_DELAY,
  quickPins: ['export', 'import', 'scan'] as [string, string, string],
  ytVideoPreview: false,
  youtubeApiKey: '',
  canvasEnabled: true,
  appBackground: 'shader' as AppBackground,
  miniPlayerBackground: 'glow' as MiniPlayerBackground,
  appleMusicInspired: false,
  fluidPlayer: false,
  hidePlayerVolume: true,
  playerBackground: 'blend' as PlayerBackground,
  playerCoverFull: false,
  appleMusicToken: '',
  tidalToken: '',
  luvsStartAtHook: true,
  reduceEffects: 'auto' as ReduceEffects,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      // Default values
      ...DEFAULT_SETTINGS,

      // Appearance actions
      setTheme: (theme) => set({ theme }),
      setDefaultGradient: (defaultGradientId) => set({ defaultGradientId }),
      setLyricsSize: (size) => set({ lyricsSize: clampLyricsSize(size) }),
      setLyricsAlign: (lyricsAlign) => set({ lyricsAlign }),
      setLyricsHighlight: (lyricsHighlight) => set({ lyricsHighlight }),
      setAutoScrollPlainLyrics: (autoScrollPlainLyrics) => set({ autoScrollPlainLyrics }),
      setLineSpacing: (lineSpacing) => set({ lineSpacing }),

      // Playback actions
      setScrollSpeed: (scrollSpeed) => set({ scrollSpeed }),
      setSkipDuration: (skipDuration) => set({ skipDuration }),
      setKeepScreenOn: (keepScreenOn) => set({ keepScreenOn }),
      setAutoQueueRefill: (autoQueueRefill) => set({ autoQueueRefill }),
      setNativeMiniSwipe: (nativeMiniSwipe) => set({ nativeMiniSwipe }),
      setListeningStats: (listeningStats) => set({ listeningStats }),
      setHapticsEnabled: (hapticsEnabled) => set({ hapticsEnabled }),
      setShowTimeRemaining: (showTimeRemaining) => set({ showTimeRemaining }),
      setPlayInMiniPlayerOnly: (playInMiniPlayerOnly) => set({ playInMiniPlayerOnly }),
      setNavBarStyle: (navBarStyle) => set({ navBarStyle }),
      setVoiceMode: (voiceMode) => set({ voiceMode }),
      setMicEnabled: (micEnabled) => set({ micEnabled }),
      setLibraryBackgroundMode: (libraryBackgroundMode) => set({ libraryBackgroundMode }),
      setClassicBarBgMode: (classicBarBgMode) => set({ classicBarBgMode }),
      setAnimateBackground: (animateBackground: boolean) => set({ animateBackground }),
      setLibraryFocusMode: (libraryFocusMode: boolean) => set({ libraryFocusMode }),
      setShowPerformanceHUD: (showPerformanceHUD: boolean) => set({ showPerformanceHUD }),
      setApplyThemeToOtherPages: (applyThemeToOtherPages: boolean) => set({ applyThemeToOtherPages }),

      // Library actions
      setDefaultView: (defaultView) => set({ defaultView }),
      setDefaultSort: (defaultSort) => set({ defaultSort }),
      setLibraryStartTab: (libraryStartTab) => set({ libraryStartTab: normalizeLibraryStartTab(libraryStartTab) }),
      setLibraryHoldPlaylistId: (libraryHoldPlaylistId) => set({ libraryHoldPlaylistId }),
      setWidgetPinnedPlaylistIds: (ids) => set({ widgetPinnedPlaylistIds: normalizePinnedPlaylists(ids) }),
      setPlaylistOffline: (id, offline) => set(state => ({
        offlinePlaylistIds: offline
          ? (state.offlinePlaylistIds.includes(id) ? state.offlinePlaylistIds : [...state.offlinePlaylistIds, id])
          : state.offlinePlaylistIds.filter(x => x !== id),
      })),
      setShowThumbnails: (showThumbnails) => set({ showThumbnails }),

      // History implementation
      playlistHistory: {},
      updatePlaylistHistory: (playlistId: string, songId: string) => set((state) => ({
          playlistHistory: {
              ...state.playlistHistory,
              [playlistId]: songId
          }
      })),

      setDownloadDirectory: (downloadDirectoryUri) => set({ downloadDirectoryUri }),

      // Quick pins
      setQuickPins: (quickPins) => set({ quickPins }),

      // Reset
      resetToDefaults: () => set(DEFAULT_SETTINGS),

      // Advanced
      lyricsDelay: DEFAULT_LYRICS_DELAY,
      setLyricsDelay: (lyricsDelay) => set({ lyricsDelay }),

      // Beta
      ytVideoPreview: false,
      setYtVideoPreview: (ytVideoPreview) => set({ ytVideoPreview }),
      youtubeApiKey: '',
      setYoutubeApiKey: (youtubeApiKey) => set({ youtubeApiKey }),

      canvasEnabled: true,
      setCanvasEnabled: (canvasEnabled) => set({ canvasEnabled }),
      appBackground: 'shader',
      setAppBackground: (appBackground) => set({ appBackground }),
      miniPlayerBackground: 'glow',
      setMiniPlayerBackground: (miniPlayerBackground) => set({ miniPlayerBackground }),
      appleMusicInspired: false,
      // As in Echo: turning the Apple Music player on also picks its background.
      setAppleMusicInspired: (appleMusicInspired) => set(s => (appleMusicInspired && isCardPlayerBackground(s.playerBackground) ? { appleMusicInspired, playerBackground: 'blend' } : { appleMusicInspired })),
      hidePlayerVolume: true,
      setHidePlayerVolume: (hidePlayerVolume) => set({ hidePlayerVolume }),
      fluidPlayer: false,
      setFluidPlayer: (fluidPlayer) => set({ fluidPlayer }),
      playerBackground: 'blend',
      setPlayerBackground: (playerBackground) => set(playerBackgroundChange(playerBackground)),
      playerCoverFull: false,
      setPlayerCoverFull: (playerCoverFull) => set({ playerCoverFull }),
      appleMusicToken: '',
      setAppleMusicToken: (appleMusicToken) => set({ appleMusicToken: appleMusicToken.trim() }),
      tidalToken: '',
      setTidalToken: (tidalToken) => set({ tidalToken: tidalToken.trim() }),
      luvsStartAtHook: true,
      setLuvsStartAtHook: (luvsStartAtHook) => set({ luvsStartAtHook }),
      reduceEffects: 'auto',
      setReduceEffects: (reduceEffects) => set({ reduceEffects }),
    }),
    {
      name: 'lyricflow-settings',
      // Every change rewrote the whole saved settings, and the playlist history changes with every song: writes are
      // coalesced to one a second and flushed when the app leaves the foreground.
      storage: createJSONStorage(() => settingsStorage),
      version: 7,
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Partial<SettingsState> & { lyricsFontSize?: string };
        const { lyricsFontSize, ...rest } = state;
        return {
          ...rest,
          // V6 has one shell. The three retired appearance controls cannot revive old chrome.
          navBarStyle: 'modern-pill',
          appBackground: 'glow',
          miniPlayerBackground: 'tint',
          hidePlayerVolume: true,
          // v3: the Small / Medium / Large text size became a size in points.
          lyricsSize: version < 3
            ? LYRICS_PRESET_SIZE[lyricsFontSize as keyof typeof LYRICS_PRESET_SIZE] ?? 28
            : clampLyricsSize(state.lyricsSize ?? 28),
          lyricsAlign: state.lyricsAlign ?? 'left',
          lyricsHighlight: state.lyricsHighlight === 'lines' ? 'lines' : 'letters',
          playerBackground: normalizePlayerBackground(state.playerBackground),
          // v2: hold-to-talk became the default. The old default was 'tap',
          // which kept listening after the finger lifted.
          voiceMode: version < 2 ? 'hold' : state.voiceMode ?? 'hold',
          // v6: the sharp card is the default; the selected room/background is retained.
          playerCoverFull: version < 6 ? false : state.playerCoverFull ?? false,
          appleMusicInspired: version < 6 ? false : state.appleMusicInspired ?? false,
          // v5: the old âˆ’1.2 s default (never chosen) becomes in sync.
          lyricsDelay: migrateLyricsDelay(version, state.lyricsDelay),
          // 1.41.0: Library's first tab, the Library hold shortcut and the widget's pinned playlists.
          libraryStartTab: normalizeLibraryStartTab(state.libraryStartTab),
          libraryHoldPlaylistId: typeof state.libraryHoldPlaylistId === 'string' ? state.libraryHoldPlaylistId : null,
          widgetPinnedPlaylistIds: normalizePinnedPlaylists(state.widgetPinnedPlaylistIds),
          offlinePlaylistIds: Array.isArray(state.offlinePlaylistIds)
            ? state.offlinePlaylistIds.filter((id): id is string => typeof id === 'string')
            : [],
        } as SettingsState;
      },
    }
  )
);

/** Settings â†’ Lyrics â†’ Text size, in points. */
export const LYRICS_SIZE_MIN = 20;
export const LYRICS_SIZE_MAX = 44;
export const clampLyricsSize = (size: number): number =>
  Math.round(Math.min(LYRICS_SIZE_MAX, Math.max(LYRICS_SIZE_MIN, Number.isFinite(size) ? size : 28)));
/** The old presets, for settings saved before sizes were custom. */
const LYRICS_PRESET_SIZE = { small: 24, medium: 28, large: 34 } as const;

/** Settings â†’ Lyrics â†’ Line spacing: the space above and below each line. */
export const LYRICS_LINE_GAP = { compact: 10, normal: 16, relaxed: 24 } as const;

/** The lyric text style the settings ask for. */
export const lyricsTextStyle = (
  size: number,
  spacing: keyof typeof LYRICS_LINE_GAP,
  align: LyricsAlign = 'left',
): { fontSize: number; lineHeight: number; marginVertical: number; textAlign: LyricsAlign } => {
  const fontSize = clampLyricsSize(size);
  return {
    fontSize,
    lineHeight: Math.round(fontSize * 1.22),
    marginVertical: LYRICS_LINE_GAP[spacing] ?? LYRICS_LINE_GAP.normal,
    textAlign: align,
  };
};
