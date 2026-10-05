// GENERATED from packages/shared/spotify.ts by `npm run sync:shared`. Do not edit here.
/** Public Spotify transfer responses. Authorization material never crosses this seam. */
/** The listener's Spotify Liked Songs, offered first among the sources and saved as Allegra likes. */
export const SPOTIFY_LIKED_ID = 'liked';

export interface SpotifySourcePlaylist {
  readonly id: string;
  readonly name: string;
  readonly snapshotId: string;
  readonly total: number;
  /** Spotify's cover image (i.scdn.co), or null when the playlist has none. */
  readonly imageUrl?: string | null;
  /** `liked`: the Liked Songs collection (`id` is SPOTIFY_LIKED_ID). Absent for ordinary playlists. */
  readonly kind?: 'liked';
  /** Liked Songs needs the newer library scope: connected before it existed, so reconnect first. */
  readonly needsReconnect?: boolean;
}
export interface SpotifyTrackedPlaylist {
  readonly id: string;
  readonly name: string;
  readonly libraryId: string;
  readonly lastSyncedAt: number | null;
  readonly added: number;
  readonly skipped: number;
  readonly reviewNeeded: number;
  readonly syncing: boolean;
}
export interface SpotifyStatus {
  readonly configured: boolean;
  readonly connected: boolean;
  readonly dailyEnabled: boolean;
  readonly playlists: readonly SpotifyTrackedPlaylist[];
}
/** Counts are cumulative for the current full scan, including acknowledged earlier steps. */
export interface SpotifySyncStep {
  readonly complete: boolean;
  readonly added: number;
  readonly skipped: number;
  readonly reviewNeeded: number;
  readonly libraryId: string;
}
