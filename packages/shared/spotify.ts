/** Public Spotify transfer responses. Authorization material never crosses this seam. */
/** The listener's Spotify Liked Songs, offered first among the sources and saved as Allegra likes. */
export const SPOTIFY_LIKED_ID = 'liked';

export interface SpotifySourcePlaylist {
  readonly id: string;
  readonly name: string;
  readonly snapshotId: string;
  readonly total: number;
  /** Spotify gave no trustworthy count and checking it failed or was out of budget: `total` is 0 but the playlist may not be empty. (Additive, 2026-10-31.) */
  readonly totalUnknown?: true;
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

/**
 * Why a Spotify sign-in failed: the `reason` the API's callback adds to `?spotify=failed` (1.41.2). A fixed word, so
 * the address never carries a provider message.
 */
export type SpotifyFailureReason = 'not_allowed' | 'expired' | 'unavailable' | 'failed';

/** What the website and the app say for a failed sign-in, so the listener knows what to do next. */
export function spotifyFailureMessage(reason: string | null | undefined): string {
  switch (reason) {
    case 'not_allowed':
      return "Spotify didn't let this account connect yet: the app can only connect a few invited Spotify accounts. Import a Spotify data download or a CSV below instead.";
    case 'expired':
      return 'That Spotify sign-in link had already been used or expired. Try connecting again.';
    case 'unavailable':
      return 'Spotify is busy right now. Try connecting again in a minute.';
    default:
      return 'Spotify connection failed. Try connecting again.';
  }
}
