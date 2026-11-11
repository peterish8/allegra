/**
 * Shared response shapes for external music and lyrics providers.
 *
 * These models intentionally include only fields consumed by the app.
 */

export interface LrcLibTrackResponse {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string;
  syncedLyrics: string;
}

export interface ProviderImageResponse {
  quality?: string;
  url?: string;
}

export interface ProviderDownloadResponse {
  quality?: string;
  url?: string;
}

export interface ProviderArtistResponse {
  name?: string;
}

export interface ProviderArtistsResponse {
  primary?: ProviderArtistResponse[];
}

export interface SaavnGaanaSongResponse {
  id?: string;
  name?: string;
  title?: string;
  image?: ProviderImageResponse[];
  downloadUrl?: ProviderDownloadResponse[];
  hasLyrics?: boolean;
  duration?: number;
  primaryArtists?: string;
  artists?: ProviderArtistsResponse;
  playCount?: string | number;
  play_count?: string | number;
  language?: string;
}

export interface SaavnGaanaSearchResponse {
  success?: boolean;
  data?: {
    results?: SaavnGaanaSongResponse[];
  };
}

export interface SaavnGaanaRecommendationsResponse {
  success?: boolean;
  data?: SaavnGaanaSongResponse[] | SaavnGaanaSongResponse;
}
