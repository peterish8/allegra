/**
 * Songs' tempo for Listening stats (1.45.0). Spotify's own tempo data is closed to apps now, so each song's BPM comes
 * from, in order:
 *  1. what this phone already found (`song_tempo`; a miss is asked again after RETRY_MS);
 *  2. Deezer's public catalogue (no key), when it has a real number (it is 0 for many new and Indian songs);
 *  3. the phone measuring it (native `Tempo.measure`, android/.../stats/TempoMath.kt) from the downloaded file or the
 *     Allegra stream (~30 s of audio, read once, then kept).
 * One song at a time, at most MAX_PER_VISIT per visit to the stats page, so it never floods the network.
 */
import { leadArtist, parseSongRef } from '@shared/songRef';
import { getTempos, saveTempo, type TempoRow } from '../../database/listenLogQueries';
import { ALLEGRA_API_URL } from '../account/config';
import { fetchJson } from '../net/fetchWithTimeout';
import { getNativeModule } from '../nativeModule';
import { useSongsStore } from '../../store/songsStore';
import type { TopSong } from './listeningStats';

export const MAX_PER_VISIT = 12;
const RETRY_MS = 14 * 86_400_000;

/** What Deezer is asked: the lead artist and the title without "(From …)", "- Remastered" and the like. */
export function deezerQuery(title: string, artist: string): string {
  const cleanTitle = title.replace(/\s*[([].*?[)\]]\s*/g, ' ').replace(/\s+-\s+.*$/, '').trim();
  return `artist:"${leadArtist(artist)}" track:"${cleanTitle}"`;
}

/** A Deezer track's BPM when it is a believable number. */
export const usableBpm = (bpm: unknown): number | null =>
  typeof bpm === 'number' && Number.isFinite(bpm) && bpm >= 50 && bpm <= 220 ? Math.round(bpm * 10) / 10 : null;

/** Where the phone can read the song's audio: its file, else its stream through the Allegra API. */
export function audioSourceFor(song: Pick<TopSong, 'songId' | 'ref'>, localAudio: (id: string) => string | undefined, api = ALLEGRA_API_URL): string | null {
  const file = localAudio(song.songId);
  if (file) return file;
  const ref = song.ref ? parseSongRef(song.ref) : null;
  return ref?.source === 'saavn' ? `${api}/api/stream/${encodeURIComponent(ref.id)}` : null;
}

interface TempoDeps {
  deezer: (title: string, artist: string) => Promise<number | null>;
  measure: (uri: string) => Promise<number | null>;
  localAudio: (id: string) => string | undefined;
  cached: (keys: readonly string[]) => Promise<Map<string, TempoRow>>;
  save: (key: string, bpm: number | null, source: string) => Promise<void>;
  now: () => number;
}

const deezer = async (title: string, artist: string): Promise<number | null> => {
  const search = await fetchJson<{ data?: { id: number }[] }>(`https://api.deezer.com/search?q=${encodeURIComponent(deezerQuery(title, artist))}&limit=1`, { timeoutMs: 8_000 });
  const id = search?.data?.[0]?.id;
  if (!id) return null;
  const track = await fetchJson<{ bpm?: number }>(`https://api.deezer.com/track/${id}`, { timeoutMs: 8_000 });
  return usableBpm(track?.bpm);
};

const native = getNativeModule<{ measure: (uri: string) => Promise<number | null> }>('Tempo');

const defaults: TempoDeps = {
  deezer,
  measure: async uri => (native ? usableBpm(await native.measure(uri).catch(() => null)) : null),
  localAudio: id => useSongsStore.getState().songs.find(s => s.id === id)?.audioUri,
  cached: getTempos,
  save: saveTempo,
  now: Date.now,
};

/**
 * Tempos for these songs: the ones known at once, then `onProgress` as each new one is found. Returns everything
 * known when done.
 */
export async function tempoFor(
  songs: readonly TopSong[],
  onProgress: (tempos: Map<string, number | null>) => void = () => undefined,
  deps: TempoDeps = defaults,
  isCurrent: () => boolean = () => true,
): Promise<Map<string, number | null>> {
  const keys = songs.map(s => s.key);
  const rows = await deps.cached(keys).catch(() => new Map<string, TempoRow>());
  const tempos = new Map<string, number | null>([...rows].map(([k, r]) => [k, r.bpm]));
  onProgress(new Map(tempos));
  // Never asked, or asked long enough ago without an answer: worth another look. A found tempo is kept for good.
  const due = (key: string) => { const row = rows.get(key); return !row || (row.bpm === null && deps.now() - row.checkedAt > RETRY_MS); };
  const missing = songs.filter(s => due(s.key)).slice(0, MAX_PER_VISIT);
  for (const song of missing) {
    if (!isCurrent()) break;
    let bpm = await deps.deezer(song.title, song.artist).catch(() => null);
    let source = 'deezer';
    if (bpm === null) {
      const uri = audioSourceFor(song, deps.localAudio);
      bpm = uri ? await deps.measure(uri).catch(() => null) : null;
      source = 'measured';
    }
    tempos.set(song.key, bpm);
    await deps.save(song.key, bpm, bpm === null ? 'none' : source).catch(() => undefined);
    onProgress(new Map(tempos));
  }
  return tempos;
}

export { RETRY_MS };
