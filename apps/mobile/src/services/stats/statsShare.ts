/**
 * What a shared stats picture says (1.48.0). One model for every card: the Top artists and Top songs pages, and each
 * insight card. Pure, built from the same numbers the page shows; `statsImage` only paints it. Tested in
 * statsShare.test.ts.
 */
import { durationWords, rangeWords, type ListeningStats } from './listeningStats';
import { groupedNumber, insightCaption, insightHeading, type InsightCard, type Period } from './statsPages';

export type ShareTone = 'list' | 'albums' | 'hours' | 'streak';

export interface ShareRow {
  /** Its place, or null for a row that is not ranked (an album line). */
  readonly rank: number | null;
  readonly title: string;
  readonly meta: string;
  readonly artwork: string | null;
}

export interface ShareCardModel {
  readonly tone: ShareTone;
  readonly heading: string;
  readonly caption: string;
  /** A big figure under the heading ("12 hours"), or null. */
  readonly figure: string | null;
  readonly rows: readonly ShareRow[];
  /** A safe file name for the picture. */
  readonly fileName: string;
}

export const SHARE_ROWS_MAX = 5;

/** Each kind of card's deep tone and the accent its heading takes: the picture and the page's cards share them. */
export const SHARE_TONES: Record<ShareTone, { bg: string; accent: string }> = {
  // The theme's Signal.wave, written out so this file stays free of the theme (and testable without React Native).
  list: { bg: '#0E1013', accent: '#F4F4F5' },
  albums: { bg: '#2A1409', accent: '#F59BC4' },
  hours: { bg: '#0F1F2C', accent: '#B9F0D3' },
  streak: { bg: '#241631', accent: '#F4C2FF' },
};

const fileSlug = (text: string): string => text.normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40) || 'stats';

/** The Top artists or Top songs card for these stats, or null when there is nothing to list. */
export function listCardModel(kind: 'artists' | 'songs', stats: ListeningStats): ShareCardModel | null {
  const rows: ShareRow[] = kind === 'artists'
    ? stats.rankedArtists.slice(0, SHARE_ROWS_MAX).map((a, i) => ({ rank: i + 1, title: a.name, meta: durationWords(a.seconds), artwork: a.artwork }))
    : stats.rankedSongs.slice(0, SHARE_ROWS_MAX).map((s, i) => ({ rank: i + 1, title: s.title, meta: `${s.artist} · ${groupedNumber(s.plays)} ${s.plays === 1 ? 'play' : 'plays'}`, artwork: s.artwork }));
  if (rows.length === 0) return null;
  const dates = rangeWords(stats.bounds);
  const heading = kind === 'artists' ? 'Top artists' : 'Top songs';
  return { tone: 'list', heading, caption: dates, figure: null, rows, fileName: `luvlyrics-${fileSlug(heading)}-${fileSlug(dates)}.png` };
}

/** An insight card as a picture. */
export function insightCardModel(card: InsightCard, period: Period, dates: string): ShareCardModel {
  const heading = insightHeading(card);
  const caption = insightCaption(card, period);
  const fileName = `luvlyrics-${card.kind}-${fileSlug(dates)}.png`;
  if (card.kind === 'albums') {
    return {
      tone: 'albums', heading, caption, figure: null, fileName,
      rows: card.items.map(a => ({ rank: null, title: a.title, meta: `${groupedNumber(a.minutes)} min · ${a.artist}`, artwork: a.artwork })),
    };
  }
  if (card.kind === 'hours') {
    return { tone: 'hours', heading: 'Your listening', caption, figure: `${card.figure} ${card.unit}`, rows: [], fileName };
  }
  return { tone: 'streak', heading: 'Your streak', caption, figure: `${card.days} days`, rows: [], fileName };
}

/** Breaks `text` into lines no wider than `maxWidth` by `measure`; a single word wider than a line stands alone. */
export function wrapLines(text: string, maxWidth: number, measure: (text: string) => number, maxLines = 4): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next) > maxWidth) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = `${kept[maxLines - 1].replace(/[\s.,;:]+$/, '')}…`;
  return kept;
}
