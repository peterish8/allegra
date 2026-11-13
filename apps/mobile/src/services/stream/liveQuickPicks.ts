import type { UnifiedSong } from '../../types/song';
import type { ListenEntry } from '../../database/listenLogQueries';
import { dedupeStreamable } from './streamSong';
export type Daypart = 'morning' | 'daytime' | 'evening' | 'night';
export interface LiveQuickPicks {
  scope: string; saved: boolean; songs: UnifiedSong[]; revision: number; generatedAt: number;
  daypart: Daypart; signal: string; source: 'account' | 'history' | 'discovery';
}
export const QUICK_PICKS_INTERVAL = 15 * 60 * 1000;
export const quickPicksDaypart = (time: number): Daypart => {
  const hour = new Date(time).getHours();
  return hour >= 5 && hour < 12 ? 'morning' : hour < 18 && hour >= 12 ? 'daytime' : hour >= 18 && hour < 22 ? 'evening' : 'night';
};
export function shouldRefreshQuickPicks(entry: LiveQuickPicks | undefined, time: number, signal: string, force = false): boolean {
  if (!entry?.songs.length || force) return true;
  if (time - entry.generatedAt < QUICK_PICKS_INTERVAL) return false;
  return entry.signal !== signal || entry.daypart !== quickPicksDaypart(time) || time - entry.generatedAt >= 6 * 60 * 60 * 1000;
}
/** A modest daypart preference, only after ten substantial listens across three dates. */
export function rankQuickPicks(songs: readonly UnifiedSong[], listens: readonly ListenEntry[], time: number): UnifiedSong[] {
  const rows = listens.filter(row => row.heardSec >= 30 && row.startedAt <= time && time - row.startedAt <= 28 * 86400000 && quickPicksDaypart(row.startedAt) === quickPicksDaypart(time));
  const days = new Set(rows.map(row => new Date(row.startedAt).toDateString()));
  const weights = new Map<string, number>();
  if (rows.length >= 10 && days.size >= 3) for (const row of rows) weights.set(row.artist.toLowerCase(), (weights.get(row.artist.toLowerCase()) ?? 0) + 1);
  const unique = dedupeStreamable([...songs]);
  const seen = new Set<string>();
  return unique.filter(song => {
    const key = `${song.title.toLowerCase().replace(/\s+/g, ' ').trim()}|${song.artist.toLowerCase().trim()}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).map((song, index) => ({ song, index, weight: Math.min(weights.get(song.artist.toLowerCase()) ?? 0, 3) }))
    .sort((a, b) => (a.index - a.weight) - (b.index - b.weight) || a.index - b.index)
    .map(row => row.song).slice(0, 12);
}

export function nextDaypartAt(time: number): number {
  const date = new Date(time);
  const next = [5, 12, 18, 22].find(hour => hour > date.getHours());
  if (next === undefined) { date.setDate(date.getDate() + 1); date.setHours(5, 0, 0, 0); }
  else date.setHours(next, 0, 0, 0);
  return date.getTime();
}
