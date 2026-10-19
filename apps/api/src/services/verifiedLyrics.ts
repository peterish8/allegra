import { parseLyrics } from '../lib/lrc.js';
import type { LyricsPayload, LyricsScript, VerifiedLyrics } from '../types.js';

/**
 * Lyrics listeners synced and confirmed (convex/verifiedLyrics.ts holds them; this file holds the
 * shapes, the in-memory twin used without Convex, and what listeners are shown).
 */

export const REPORTS_TO_HIDE = 3;

export interface StoredLyricsVersion {
  readonly script: LyricsScript;
  readonly language: string;
  readonly lrc: string;
  /** Kept for moderation; never sent to listeners. */
  readonly source: { readonly name: string; readonly url?: string };
  readonly confidence: number;
  readonly syncedBy: string;
  readonly syncedAt: number;
  readonly reportedBy: readonly string[];
  readonly hidden: boolean;
}

export interface StoredVerifiedLyrics {
  readonly ref: string;
  readonly matchKey: string;
  readonly title: string;
  readonly artist: string;
  readonly duration: number;
  readonly versions: readonly StoredLyricsVersion[];
  readonly updatedAt: number;
}

export interface VerifiedLyricsSong {
  readonly ref: string;
  readonly matchKey: string;
  readonly title: string;
  readonly artist: string;
  readonly duration: number;
}

export type VerifiedLyricsSubmission = Pick<StoredLyricsVersion, 'script' | 'language' | 'lrc' | 'source' | 'confidence' | 'syncedBy'>;

export interface VerifiedLyricsStore {
  createPasted?(candidate: PastedLyrics, passcode: string): Promise<boolean>;
  getPasted?(id: string, ref: string, userId: string): Promise<PastedLyrics | null>;
  get(ref: string): Promise<StoredVerifiedLyrics | null>;
  byMatchKey(matchKey: string): Promise<StoredVerifiedLyrics | null>;
  submit(song: VerifiedLyricsSong, version: VerifiedLyricsSubmission): Promise<{ readonly saved: boolean }>;
  report(ref: string, script: LyricsScript, reporter: string): Promise<{ readonly found: boolean; readonly hidden: boolean }>;
  setHidden(ref: string, script: LyricsScript, hidden: boolean): Promise<{ readonly found: boolean }>;
}

export interface PastedLyrics {
  readonly id: string;
  readonly ref: string;
  readonly userId: string;
  readonly language: string;
  readonly lines: readonly string[];
}

const latinFirst = (left: { script: LyricsScript }, right: { script: LyricsScript }): number =>
  Number(left.script !== 'latin') - Number(right.script !== 'latin');

/** What listeners see: live versions only, latin first, no moderation fields. Null when none is live. */
export function publicView(row: StoredVerifiedLyrics | null): VerifiedLyrics | null {
  const versions = (row?.versions ?? [])
    .filter((version) => !version.hidden && version.lrc.trim())
    .sort(latinFirst)
    .map(({ script, language, lrc, syncedAt }) => ({ script, language, lrc, syncedAt }));
  if (!row || versions.length === 0) return null;
  return { ref: row.ref, title: row.title, artist: row.artist, duration: row.duration, versions };
}

const SCRIPT_LABEL: Record<LyricsScript, string> = { latin: 'English', native: 'Native script' };
const LANGUAGE_SCRIPT: Readonly<Record<string, string>> = {
  ta: 'Tamil', te: 'Telugu', hi: 'Hindi', ml: 'Malayalam', kn: 'Kannada', bn: 'Bengali', mr: 'Marathi', pa: 'Punjabi', gu: 'Gujarati', or: 'Odia', ur: 'Urdu'
};

/** "English" for a transliteration, the language's name ("Tamil") for its own script. */
export function versionLabel(version: { readonly script: LyricsScript; readonly language: string }): string {
  return version.script === 'native' ? LANGUAGE_SCRIPT[version.language] ?? SCRIPT_LABEL.native : SCRIPT_LABEL.latin;
}

/** "Allegra (English)" / "Allegra (Tamil)": the web shows it as "Allegra · English". */
export function versionSource(version: { readonly script: LyricsScript; readonly language: string }): string {
  return `Allegra (${versionLabel(version)})`;
}

/** Each live version as a payload the lyrics panels already draw (synced, word timings kept). */
export function verifiedPayloads(view: VerifiedLyrics | null, duration: number | undefined): LyricsPayload[] {
  if (!view) return [];
  return view.versions.flatMap((version) => {
    const lines = parseLyrics(version.lrc, duration ?? view.duration);
    if (lines.length === 0) return [];
    return [{
      source: versionSource(version),
      type: 'synced' as const,
      matchScore: 100,
      matchReason: 'Synced by Allegra listeners',
      lines
    }];
  });
}

/** The same rules as convex/verifiedLyrics.ts, for local development without Convex. */
export class MemoryVerifiedLyricsStore implements VerifiedLyricsStore {
  private readonly rows = new Map<string, StoredVerifiedLyrics>();

  public constructor(private readonly now: () => number = Date.now) {}

  public async get(ref: string): Promise<StoredVerifiedLyrics | null> {
    return this.rows.get(ref) ?? null;
  }

  public async byMatchKey(matchKey: string): Promise<StoredVerifiedLyrics | null> {
    for (const row of this.rows.values()) {
      if (row.matchKey === matchKey) return row;
    }
    return null;
  }

  public async submit(song: VerifiedLyricsSong, version: VerifiedLyricsSubmission): Promise<{ readonly saved: boolean }> {
    const at = this.now();
    const incoming: StoredLyricsVersion = { ...version, syncedAt: at, reportedBy: [], hidden: false };
    const row = this.rows.get(song.ref);
    const existing = row?.versions.find((item) => item.script === version.script);
    if (existing && !existing.hidden && existing.confidence >= version.confidence) {
      return { saved: false };
    }
    const versions = [...(row?.versions ?? []).filter((item) => item.script !== version.script), incoming].sort(latinFirst);
    this.rows.set(song.ref, { ...song, versions, updatedAt: at });
    return { saved: true };
  }

  public async report(ref: string, script: LyricsScript, reporter: string): Promise<{ readonly found: boolean; readonly hidden: boolean }> {
    const row = this.rows.get(ref);
    const target = row?.versions.find((item) => item.script === script);
    if (!row || !target) return { found: false, hidden: false };
    if (target.hidden || target.reportedBy.includes(reporter)) return { found: true, hidden: target.hidden };
    const reportedBy = [...target.reportedBy, reporter];
    const hidden = reportedBy.length >= REPORTS_TO_HIDE;
    this.rows.set(ref, { ...row, versions: row.versions.map((item) => (item.script === script ? { ...item, reportedBy, hidden } : item)), updatedAt: this.now() });
    return { found: true, hidden };
  }

  public async setHidden(ref: string, script: LyricsScript, hidden: boolean): Promise<{ readonly found: boolean }> {
    const row = this.rows.get(ref);
    if (!row || !row.versions.some((item) => item.script === script)) return { found: false };
    const versions = row.versions.map((item) => (item.script === script ? { ...item, hidden, reportedBy: hidden ? item.reportedBy : [] } : item));
    this.rows.set(ref, { ...row, versions, updatedAt: this.now() });
    return { found: true };
  }
}
