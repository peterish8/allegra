/** The finder and times-only submission contract. Source URLs stay on the server. */
export type LyricsSyncScript = 'latin' | 'native';

export interface LyricsSyncCandidate {
  readonly id: string;
  readonly origin: 'provider' | 'site' | 'manual';
  readonly source: string;
  readonly url: null;
  readonly script: LyricsSyncScript;
  readonly language: string;
  readonly lines: readonly string[];
  readonly synced: boolean;
}

export interface LyricsSourcesResponse {
  readonly song: { readonly ref: string; readonly title: string; readonly artist: string; readonly duration: number };
  readonly candidates: readonly LyricsSyncCandidate[];
}

export interface LyricsWordTime {
  readonly start: number;
  readonly end: number;
  readonly filler?: boolean;
}

export interface LyricsSyncRequest {
  readonly ref: string;
  readonly versions: readonly {
    readonly candidateId: string;
    readonly script: LyricsSyncScript;
    readonly wordTimes: readonly LyricsWordTime[];
    readonly confidence: number;
  }[];
}

export interface LyricsSyncResult {
  readonly versions: readonly { readonly script: LyricsSyncScript; readonly saved: boolean }[];
}
