// GENERATED from packages/shared/spotify.ts by `npm run sync:shared`. Do not edit here.
/** Public Spotify transfer responses. Authorization material never crosses this seam. */
export interface SpotifySourcePlaylist {
  readonly id: string;
  readonly name: string;
  readonly snapshotId: string;
  readonly total: number;
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
