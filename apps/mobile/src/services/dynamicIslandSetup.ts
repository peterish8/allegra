/**
 * What Settings → Dynamic island shows, decided from the native island's status
 * (android/.../modules/DynamicIslandModule.kt). Pure, so it is tested without a phone.
 */

export interface IslandStatus {
  /** The listener turned "LuvLyrics island" on in Android's accessibility settings. */
  serviceEnabled: boolean;
  /** Android has bound the service (it follows serviceEnabled within a moment). */
  serviceRunning: boolean;
  /** The island is on screen right now (not in landscape, screen-off or the lock screen). */
  showing: boolean;
  /** The app's own switch for the island. */
  enabled: boolean;
  showWhenIdle: boolean;
  allowOnNativeIsland: boolean;
  /** The island steps aside while LuvLyrics itself is on screen. */
  hideInApp: boolean;
  /** The open card shows the sung line and the next one under its controls. */
  showLyricStrip: boolean;
  /** The island stays on the lock screen (play, skip, seek and lyrics; the library waits for unlocking). */
  showOnLockScreen: boolean;
  /** A pill floating below the top edge, or a notch hanging from it. */
  style: IslandStyle;
  /** The island's size in percent of its own: width sizes the closed island (80–150), height both (85–130). */
  widthPercent: number;
  heightPercent: number;
  /** The phone's own island feature ("Xiaomi's Super Island", …), or null when it has none. */
  nativeIsland: string | null;
  /** Android 13+: a sideloaded app's accessibility switch can be greyed out until "Allow restricted settings". */
  restrictedSettings: boolean;
}

export type IslandStyle = 'pill' | 'notch';

export const ISLAND_STYLES: readonly { value: IslandStyle; label: string }[] = [
  { value: 'pill', label: 'Pill' },
  { value: 'notch', label: 'Notch' },
];

export type IslandStep =
  /** The phone's system has its own island and the listener has not asked for ours. */
  | 'native'
  /** Switched off in the app. */
  | 'off'
  /** On in the app, waiting for the accessibility switch in Android's settings. */
  | 'needs-service'
  | 'ready';

export function islandSetupStep(status: IslandStatus): IslandStep {
  if (status.nativeIsland && !status.allowOnNativeIsland) return 'native';
  if (!status.enabled) return 'off';
  if (!status.serviceEnabled) return 'needs-service';
  return 'ready';
}

/** The closed section's one line. */
export function islandSummary(step: IslandStep): string {
  switch (step) {
    case 'native':
      return 'Your phone’s own island is in use';
    case 'off':
      return 'Off';
    case 'needs-service':
      return 'One switch left in Android settings';
    case 'ready':
      return 'On, round the camera over every app';
  }
}

/** Said before the listener is sent to Android's accessibility page. */
export const ISLAND_DISCLOSURE =
  'Android only lets an accessibility service draw above the status bar, so that is how the island gets there. ' +
  'It does not read or record other apps’ screens, and sends no screen data anywhere.';

/** The size sliders' ranges, in percent (IslandGeometry clamps to the same). */
export const ISLAND_WIDTH_RANGE = { min: 80, max: 150 } as const;
export const ISLAND_HEIGHT_RANGE = { min: 85, max: 130 } as const;

const percent = (value: unknown, range: { min: number; max: number }): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(range.max, Math.max(range.min, Math.round(value))) : 100;

export function parseIslandStatus(raw: unknown): IslandStatus | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const flag = (key: string) => r[key] === true;
  return {
    serviceEnabled: flag('serviceEnabled'),
    serviceRunning: flag('serviceRunning'),
    showing: flag('showing'),
    enabled: flag('enabled'),
    showWhenIdle: flag('showWhenIdle'),
    allowOnNativeIsland: flag('allowOnNativeIsland'),
    hideInApp: flag('hideInApp'),
    // Older builds have no switch and always showed the lines.
    showLyricStrip: r.showLyricStrip !== false,
    showOnLockScreen: flag('showOnLockScreen'),
    // Older builds only had the pill.
    style: r.style === 'notch' ? 'notch' : 'pill',
    widthPercent: percent(r.widthPercent, ISLAND_WIDTH_RANGE),
    heightPercent: percent(r.heightPercent, ISLAND_HEIGHT_RANGE),
    nativeIsland: typeof r.nativeIsland === 'string' && r.nativeIsland.length > 0 ? r.nativeIsland : null,
    restrictedSettings: flag('restrictedSettings'),
  };
}

const MAX_AWAKE_MS = 60_000;

/** How long the island's keep-awake task holds (`islandJsAwake.ts`), from the native data (`{ ms }`), bounded. */
export function islandAwakeMs(data: unknown): number {
  const ms = data && typeof data === 'object' ? (data as { ms?: unknown }).ms : undefined;
  return typeof ms === 'number' && Number.isFinite(ms) ? Math.min(MAX_AWAKE_MS, Math.max(0, ms)) : 0;
}

/** What the island needs of a song's lyrics: when each line starts (ms on the player's clock) and its words. */
export interface IslandLyricsPayload {
  atMs: number[];
  texts: string[];
}

/**
 * The lines the open island shows under its controls. Only timed lyrics: plain lyrics (every line at 0)
 * have nothing to follow, so the island keeps its usual size for them. The app's lyrics delay is
 * applied here, the way the in-app lyrics use it (a line is sung once position + delay reaches it),
 * so the island and the app show the same line.
 */
export function islandLyricsPayload(
  lines: readonly { readonly timestamp: number; readonly text: string }[] | undefined,
  delaySeconds: number,
): IslandLyricsPayload | null {
  const timed = (lines ?? []).filter(line => Number.isFinite(line.timestamp) && line.text.trim().length > 0);
  if (timed.length === 0 || timed.every(line => line.timestamp === 0)) return null;
  const delay = Number.isFinite(delaySeconds) ? delaySeconds : 0;
  return {
    atMs: timed.map(line => Math.max(0, Math.round((line.timestamp - delay) * 1000))),
    texts: timed.map(line => line.text.trim()),
  };
}

/** One row in the island's lists (playlist songs, downloads, search answers). */
export interface IslandSongRow {
  id: string;
  title: string;
  artist: string;
  /** A cover the island may load itself: a file or content on the phone, or https. Empty otherwise. */
  cover: string;
  /** Search answers only: the song is on the phone and plays offline (the island marks it and lists it first). */
  downloaded?: boolean;
}

export interface IslandPlaylistRow {
  id: string;
  name: string;
  cover: string;
  count: number;
  songs: IslandSongRow[];
}

/** Songs listed per playlist: enough to scroll through, small enough to hand over on every change. */
export const ISLAND_PLAYLIST_SONGS = 300;
/** Downloads listed: the island is a quick pick, not the library. */
export const ISLAND_DOWNLOADS = 500;

/** Only covers the island loads natively and safely: the same rule as the engine's artwork (file, content, https). */
export function islandCover(uri: string | null | undefined): string {
  if (!uri || uri.length > 4096) return '';
  return /^(file|content|https):/i.test(uri) ? uri : '';
}

export function islandSongRow(song: {
  readonly id: string;
  readonly title?: string;
  readonly artist?: string;
  readonly coverImageUri?: string;
  readonly coverRemoteUri?: string;
}): IslandSongRow {
  return {
    id: song.id,
    title: song.title?.trim() || 'Unknown song',
    artist: song.artist?.trim() ?? '',
    // The phone's own copy first: a downloaded song's cover shows offline and at once.
    cover: islandCover(song.coverImageUri) || islandCover(song.coverRemoteUri),
  };
}

/**
 * A search's rows for the island: the matching downloads first (marked, they play offline), then the online
 * answers with their official art. The island drops an online answer a download already stands for.
 */
export function islandSearchRows(
  downloads: readonly Parameters<typeof islandSongRow>[0][],
  online: readonly { readonly id: string; readonly title: string; readonly artist: string; readonly highResArt?: string; readonly thumbnail?: string }[],
): IslandSongRow[] {
  return [
    ...downloads.map(song => ({ ...islandSongRow(song), downloaded: true })),
    ...online.map(song => ({
      id: song.id,
      title: song.title,
      artist: song.artist,
      cover: islandCover(song.highResArt) || islandCover(song.thumbnail),
    })),
  ];
}

/** Lower case, accents off, anything but letters and digits a single space (IslandLibrary.fold does the same). */
export function foldForSearch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Mn}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Downloaded songs matched in island search, at most this many (the online answers follow them). */
export const ISLAND_SEARCH_DOWNLOADS = 8;

/**
 * The downloads whose title and artist hold every word of [query], best first: the title starting with it, then a
 * title word starting with it, then the rest, in the order given (IslandLibrary.matchDownloads ranks the same).
 */
export function matchDownloads<T extends { readonly title?: string; readonly artist?: string }>(
  songs: readonly T[], query: string, limit = ISLAND_SEARCH_DOWNLOADS,
): T[] {
  const q = foldForSearch(query);
  if (!q) return [];
  const words = q.split(' ');
  const rank = (song: T): number => {
    const title = foldForSearch(song.title ?? '');
    if (title.startsWith(q)) return 0;
    if (title.includes(` ${q}`)) return 1;
    return title.includes(q) ? 2 : 3;
  };
  return songs
    .filter(song => {
      const key = foldForSearch(`${song.title ?? ''} ${song.artist ?? ''}`);
      return words.every(word => key.includes(word));
    })
    .map((song, order) => ({ song, order, rank: rank(song) }))
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .slice(0, limit)
    .map(entry => entry.song);
}

/** A song the phone can play with no network: its audio is a file (or content) on the phone. */
export function isDownloadedSong(song: { readonly audioUri?: string; readonly isHidden?: boolean }): boolean {
  return !song.isHidden && !!song.audioUri && /^(file|content):/i.test(song.audioUri);
}
