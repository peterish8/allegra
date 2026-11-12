import { withDbRead, withDbWrite } from './db';
import type { LiveQuickPicks } from '../services/stream/liveQuickPicks';
export async function readQuickPicks(scope: string): Promise<LiveQuickPicks | undefined> {
  const row = await withDbRead(db => db.getFirstAsync<{ payload: string }>('SELECT payload FROM generated_playlists WHERE scope = ?', [scope]));
  if (!row) return undefined;
  try {
    const entry: LiveQuickPicks = JSON.parse(row.payload);
    return entry.scope === scope && Array.isArray(entry.songs) ? entry : undefined;
  } catch { return undefined; }
}
export async function writeQuickPicks(entry: LiveQuickPicks): Promise<void> {
  await withDbWrite(async db => {
    const row = await db.getFirstAsync<{ payload: string }>('SELECT payload FROM generated_playlists WHERE scope = ?', [entry.scope]);
    const saved = row ? (JSON.parse(row.payload) as LiveQuickPicks).saved : entry.saved;
    await db.runAsync('INSERT INTO generated_playlists (scope, payload) VALUES (?, ?) ON CONFLICT(scope) DO UPDATE SET payload = excluded.payload', [entry.scope, JSON.stringify({ ...entry, saved })]);
  });
}
/** Only the bookmark changes; a concurrent refresh keeps its new tracks and revision. */
export async function bookmarkQuickPicks(scope: string, saved: boolean): Promise<void> {
  await withDbWrite(async db => {
    const row = await db.getFirstAsync<{ payload: string }>('SELECT payload FROM generated_playlists WHERE scope = ?', [scope]);
    if (!row) throw new Error('Playlist not loaded');
    const current: LiveQuickPicks = JSON.parse(row.payload);
    await db.runAsync('UPDATE generated_playlists SET payload = ? WHERE scope = ?', [JSON.stringify({ ...current, saved }), scope]);
  });
}
