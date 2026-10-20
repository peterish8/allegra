import type { LyricsPayload } from '@shared/types';

/**
 * When to ask again after lyrics came back plain or missing. The server keeps looking after it
 * answers (its cascade caches what it finds), and a listener may share a sync meanwhile, so a
 * later ask can return real timing. Four asks over about two minutes, then the song is left alone.
 */
export const LYRICS_UPGRADE_DELAYS_MS: readonly number[] = [6_000, 15_000, 35_000, 75_000];

/** Whether lyrics on screen are worth asking about again: anything short of synced lines. */
export function wantsLyricsUpgrade(current: LyricsPayload | null): boolean {
  return current?.type !== 'synced' || current.lines.length === 0;
}

/** Whether a later answer should replace what is showing: synced beats plain, any words beat none. */
export function isLyricsUpgrade(current: LyricsPayload | null, next: LyricsPayload | null): boolean {
  if (!next || next.lines.length === 0) return false;
  if (next.type === 'synced') return wantsLyricsUpgrade(current);
  return !current || current.lines.length === 0;
}
