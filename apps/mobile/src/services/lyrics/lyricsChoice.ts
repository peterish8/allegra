/**
 * Pure pieces of the lyrics picker (long press on the player's lyrics button): what kind of lyrics an answer is,
 * the lines it opens with, and the order options are listed in. Kept apart from the network so they are tested.
 */

/** Word by word (enhanced LRC `<mm:ss.xx>` tags), synced by line (`[mm:ss.xx]`), or plain text. */
export type LyricsKind = 'words' | 'synced' | 'plain';

const WORD_TAG = /<\d{1,3}:\d{1,2}(?:\.\d{1,3})?>/;
const LINE_TAG = /\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/;

export const lyricsKind = (text: string): LyricsKind =>
  WORD_TAG.test(text) ? 'words' : LINE_TAG.test(text) ? 'synced' : 'plain';

export const KIND_LABEL: Record<LyricsKind, string> = {
  words: 'Word by word',
  synced: 'Synced',
  plain: 'Plain text',
};

/** The first `count` sung lines, with the timing tags and metadata lines ([ar:…]) taken out. */
export function previewLines(text: string, count = 3): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (/^\s*\[[a-z]+:.*\]\s*$/i.test(raw)) continue;
    const line = raw
      .replace(/\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/g, '')
      .replace(/<\d{1,3}:\d{1,2}(?:\.\d{1,3})?>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!line) continue;
    out.push(line);
    if (out.length >= count) break;
  }
  return out;
}

export interface LyricsOption {
  /** Stable for the list: the provider (one answer each). */
  id: string;
  provider: string;
  kind: LyricsKind;
  lyrics: string;
  preview: string[];
  /** 0–100: how well the answer's title, artist and length match the song. */
  score: number;
  reason: string;
  trackName?: string;
  artistName?: string;
}

const KIND_RANK: Record<LyricsKind, number> = { words: 0, synced: 1, plain: 2 };

/**
 * Best first: a good match before a poor one (a wrong song is never "better" for its timing), then word by word
 * before synced before plain, then the higher score. "A good match" is 60 or more.
 */
export function rankOptions(options: readonly LyricsOption[]): LyricsOption[] {
  const good = (o: LyricsOption) => (o.score >= 60 ? 0 : 1);
  return [...options].sort((a, b) =>
    good(a) - good(b) || KIND_RANK[a.kind] - KIND_RANK[b.kind] || b.score - a.score || a.provider.localeCompare(b.provider));
}
