/**
 * Listening stats' storage (1.45.0): `listen_log` holds every listen heard on this phone (what, when, how long, how it
 * ended) and `song_tempo` each song's tempo once found. Both stay on the phone; Listening stats can clear them.
 */
import { withDbRead, withDbWrite } from './db';

export type ListenExitKind = 'ended' | 'skipped' | 'paused' | 'switched';

export interface ListenEntry {
  readonly songKey: string;
  readonly songId: string;
  readonly ref: string | null;
  readonly title: string;
  readonly artist: string;
  readonly album: string | null;
  readonly artwork: string | null;
  readonly durationSec: number;
  /** ms since the epoch. */
  readonly startedAt: number;
  readonly heardSec: number;
  readonly exit: ListenExitKind;
}

interface ListenRow {
  song_key: string; song_id: string; ref: string | null; title: string; artist: string; album: string | null;
  artwork: string | null; duration_sec: number; started_at: number; heard_sec: number; exit: string;
}

const toEntry = (row: ListenRow): ListenEntry => ({
  songKey: row.song_key, songId: row.song_id, ref: row.ref, title: row.title, artist: row.artist, album: row.album,
  artwork: row.artwork, durationSec: row.duration_sec, startedAt: row.started_at, heardSec: row.heard_sec,
  exit: (['ended', 'skipped', 'paused', 'switched'].includes(row.exit) ? row.exit : 'switched') as ListenExitKind,
});

export async function insertListen(entry: ListenEntry): Promise<void> {
  await withDbWrite(db => db.runAsync(
    `INSERT INTO listen_log (song_key, song_id, ref, title, artist, album, artwork, duration_sec, started_at, heard_sec, exit)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [entry.songKey, entry.songId, entry.ref, entry.title, entry.artist, entry.album, entry.artwork, entry.durationSec,
      entry.startedAt, entry.heardSec, entry.exit],
  ));
}

/** Every listen that started at or after `fromMs` (all of them for 0), oldest first. */
export async function listensSince(fromMs: number): Promise<ListenEntry[]> {
  const rows = await withDbRead(db => db.getAllAsync<ListenRow>(
    'SELECT * FROM listen_log WHERE started_at >= ? ORDER BY started_at ASC', [fromMs],
  ));
  return rows.map(toEntry);
}

/** When each song was first heard (for "new to you"). */
export async function firstHeard(): Promise<Map<string, { at: number; artist: string }>> {
  const rows = await withDbRead(db => db.getAllAsync<{ song_key: string; artist: string; first: number }>(
    'SELECT song_key, artist, MIN(started_at) AS first FROM listen_log GROUP BY song_key',
  ));
  return new Map(rows.map(r => [r.song_key, { at: r.first, artist: r.artist }]));
}

export async function clearListens(): Promise<void> {
  await withDbWrite(db => db.execAsync('DELETE FROM listen_log'));
}

export interface TempoRow { readonly bpm: number | null; readonly checkedAt: number }

export async function getTempos(keys: readonly string[]): Promise<Map<string, TempoRow>> {
  if (keys.length === 0) return new Map();
  const marks = keys.map(() => '?').join(',');
  const rows = await withDbRead(db => db.getAllAsync<{ song_key: string; bpm: number | null; checked_at: number }>(
    `SELECT song_key, bpm, checked_at FROM song_tempo WHERE song_key IN (${marks})`, [...keys],
  ));
  return new Map(rows.map(r => [r.song_key, { bpm: r.bpm, checkedAt: r.checked_at }]));
}

/** A tempo found (or `null`: looked for, none found; asked again after a while). */
export async function saveTempo(songKey: string, bpm: number | null, source: string): Promise<void> {
  await withDbWrite(db => db.runAsync(
    'INSERT OR REPLACE INTO song_tempo (song_key, bpm, source, checked_at) VALUES (?, ?, ?, ?)',
    [songKey, bpm, source, Date.now()],
  ));
}
