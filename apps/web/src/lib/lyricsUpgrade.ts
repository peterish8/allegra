import type { LyricsPayload } from '@shared/types';

/**
 * The synced version to show in place of plain words: Allegra listener syncs first (they carry word
 * timing for this exact recording), then the best-matching other synced source. Null when none has
 * timing, so the plain words stay.
 */
export function syncedUpgrade(alternatives: readonly LyricsPayload[]): LyricsPayload | null {
  const synced = alternatives.filter((payload) => payload.type === 'synced' && payload.lines.length > 0);
  const allegra = synced.find((payload) => payload.source.startsWith('Allegra'));
  if (allegra) return allegra;
  return [...synced].sort((left, right) => right.matchScore - left.matchScore)[0] ?? null;
}
