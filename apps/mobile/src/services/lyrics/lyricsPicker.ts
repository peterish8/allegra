/**
 * The lyrics picker: every provider asked at once (Echo Music's seven — YouLyPlus, Paxsenix, Unison, BetterLyrics,
 * SimpMusic, LRCLIB, KuGou — and the Lyrica backend), each answer shown the moment it lands, and the one the
 * listener taps used for the song.
 */
import { DEFAULT_PROVIDER_ORDER, LYRICS_PROVIDERS, LyricsQuery, ProviderLyrics } from './providers';
import { lyricsKind, LyricsOption, previewLines } from './lyricsChoice';
import { lyricaService, LyricaResult } from '../LyricaService';
import { SmartLyricMatcher } from '../SmartLyricMatcher';
import { usePlayerStore } from '../../store/playerStore';
import { isStreamSongId } from '../stream/streamSong';
import type { Song } from '../../types/song';

export interface PickerTarget {
  title: string;
  artist: string;
  /** Seconds; 0 when unknown. */
  duration: number;
}

const cleanTitle = (title: string): string =>
  title
    .replace(/\.(mp3|m4a|flac|wav|ogg|opus)$/i, '')
    .replace(/[([](official|lyrics?|audio|video|visuali[sz]er|mv|hd|4k|mp3_\d+k)[^)\]]*[)\]]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

function toOption(result: LyricaResult, target: PickerTarget): LyricsOption | null {
  const lyrics = result.lyrics?.trim();
  if (!lyrics) return null;
  const kind = lyricsKind(lyrics);
  const scored = SmartLyricMatcher.calculateScore(
    {
      id: 0,
      trackName: result.metadata?.title || target.title,
      artistName: result.metadata?.artist || target.artist,
      duration: result.metadata?.duration || target.duration,
      plainLyrics: lyrics,
      syncedLyrics: kind === 'plain' ? '' : lyrics,
      albumName: result.metadata?.album || '',
      instrumental: false,
    },
    null,
    target,
  );
  return {
    id: result.source,
    provider: result.source,
    kind,
    lyrics,
    preview: previewLines(lyrics),
    score: Math.max(0, Math.min(100, Math.round(scored.matchScore))),
    reason: scored.matchReason,
    trackName: result.metadata?.title,
    artistName: result.metadata?.artist,
  };
}

/**
 * Asks every provider at once. `onOption` hears each usable answer as it arrives; the promise settles when all
 * have answered (or given up: each provider has its own timeout and never throws). A cancelled search hears nothing.
 */
export async function searchEveryProvider(
  target: PickerTarget,
  onOption: (option: LyricsOption) => void,
  isCancelled: () => boolean = () => false,
): Promise<number> {
  const query: LyricsQuery = { title: cleanTitle(target.title), artist: target.artist === 'Unknown Artist' ? '' : target.artist.trim(), duration: target.duration || undefined };
  if (!query.title) return 0;
  let found = 0;
  const report = (result: LyricaResult | null) => {
    if (!result || isCancelled()) return;
    const option = toOption(result, target);
    if (!option) return;
    found += 1;
    onOption(option);
  };
  const echo = DEFAULT_PROVIDER_ORDER.map(name =>
    (LYRICS_PROVIDERS[name]?.(query) ?? Promise.resolve(null))
      .then((hit: ProviderLyrics | null) => report(hit ? lyricaService.fromProvider(hit) : null))
      .catch(() => undefined));
  const backend = lyricaService.fetchLyrics(query.title, query.artist, false, target.duration || undefined, { skipEcho: true })
    .then(report)
    .catch(() => undefined);
  await Promise.all([...echo, backend]);
  return found;
}

/**
 * Uses the chosen lyrics for the playing song: on screen at once (the player and its queue), and kept — a song on
 * the phone saves them to the library (word timings included); a streamed song keeps them for this session.
 */
export async function applyLyricsOption(option: LyricsOption): Promise<boolean> {
  const state = usePlayerStore.getState();
  const song = state.currentSong;
  if (!song) return false;
  const lyrics = lyricaService.parseLrc(option.lyrics, song.duration || 180);
  if (lyrics.length === 0) return false;
  const patch: Partial<Song> = { lyrics, lyricSource: option.provider };
  state.updateCurrentSong(patch);
  if (state.playlistQueue) {
    state.updateQueue(state.playlistQueue.map(s => (s.id === song.id ? { ...s, ...patch } : s)));
  }
  if (!isStreamSongId(song.id)) {
    try {
      const queries = await import('../../database/queries');
      await queries.updateSong({ ...song, ...patch });
    } catch {
      // On screen for now; the library keeps its old lyrics.
    }
  }
  return true;
}
