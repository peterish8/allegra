/**
 * LyricFlow - Lyrica API Service
 * Single source for all lyrics (LRCLIB, YouTube Music, Genius, JioSaavn, etc.)
 */

import { parseWordTags } from '@shared/wordSync';
import { LyricLine } from '../types/song';
import { EchoLyricsCascade } from './lyrics/EchoLyricsCascade';
import { ProviderLyrics } from './lyrics/providers';

const BASE_URL = 'https://test-0k.onrender.com/lyrics';
const COLD_START_TIMEOUT_MS = 45_000;
const PLAIN_IN_HAND_TIMEOUT_MS = 6_000;

export interface LyricaResult {
  lyrics: string;
  source: string;
  metadata?: {
    title?: string;
    artist?: string;
    album?: string;
    duration?: number;
    coverArt?: string;
  };
}

interface TimedLine { start_time?: number; text?: string }

/** The backend's timed lines (`start_time` in ms) as LRC. */
const timedToLrc = (lines: TimedLine[]): string =>
  lines
    .map(line => {
      const ms = line.start_time || 0;
      const pad = (n: number) => String(Math.floor(n)).padStart(2, '0');
      return `[${pad(ms / 60000)}:${pad((ms % 60000) / 1000)}.${pad((ms % 1000) / 10)}] ${line.text || ''}`;
    })
    .join('\n');

/** The title and artist as every lookup sends them, so a prefetch and the real fetch share a cache entry. */
function cleanTitleArtist(song: string, artist: string): { cleanSong: string; cleanArtist: string } {
  let cleanSong = song
    .replace(/\(Lyrics\)/gi, '')
    .replace(/\(Official.*?\)/gi, '')
    .replace(/\(MP3_\d+K\)/gi, '')
    .replace(/\(Audio\)/gi, '')
    .trim();
  let cleanArtist = artist === 'Unknown Artist' ? '' : artist;
  // No artist but "Artist - Title": split it.
  if (!cleanArtist && cleanSong.includes(' - ')) {
    const parts = cleanSong.split(' - ');
    cleanArtist = parts[0].trim();
    cleanSong = parts.slice(1).join(' - ').trim();
  }
  return { cleanSong, cleanArtist };
}

class LyricaService {
  /** Warms the provider cache for a song about to play; never throws, never hits the backend. */
  warm(song: string, artist: string, duration?: number): void {
    const { cleanSong, cleanArtist } = cleanTitleArtist(song, artist);
    EchoLyricsCascade.fetchBest({ title: cleanSong, artist: cleanArtist, duration }).catch(() => null);
  }

  async fetchLyrics(
    song: string,
    artist: string,
    syncedOnly: boolean = false,
    duration?: number,
    options: { skipEcho?: boolean } = {},
  ): Promise<LyricaResult | null> {
    try {
      const { cleanSong, cleanArtist } = cleanTitleArtist(song, artist);

      if (__DEV__) console.log('[Lyrica] Cleaned - Artist:', cleanArtist, 'Song:', cleanSong, 'Duration:', duration);

      // Echo Music provider cascade first (YouLyPlus, Paxsenix, Unison, BetterLyrics,
      // SimpMusic, LRCLIB, KuGou). A synced hit wins outright; a plain hit is held
      // back in case the Lyrica backend below has timestamps.
      const echo = options.skipEcho ? null : await EchoLyricsCascade.fetchBest(
        { title: cleanSong, artist: cleanArtist, duration },
        undefined,
        syncedOnly,
      );
      if (echo?.synced) return this.fromProvider(echo);
      
      // Priority: Synced (slow) > Synced (fast) > Plain text
      // User request: "synced slow , then synced fats then plain"
      let strategies = [
        { timestamps: true, fast: false, label: 'synced-slow' },
        { timestamps: true, fast: true, label: 'synced-fast' },
        { timestamps: false, fast: false, label: 'plain' },
      ];

      if (syncedOnly) {
        strategies = strategies.filter(s => s.timestamps);
        if (__DEV__) console.log('[Lyrica] Synced-only mode active');
      }
      
      // With plain lyrics already in hand, the backend gets a short chance to beat them with
      // timestamps; without them it gets long enough to survive a cold start.
      const timeoutMs = echo ? PLAIN_IN_HAND_TIMEOUT_MS : COLD_START_TIMEOUT_MS;
      for (const strategy of strategies) {
        let url = `${BASE_URL}/?artist=${encodeURIComponent(cleanArtist)}&song=${encodeURIComponent(cleanSong)}&timestamps=${strategy.timestamps}&fast=${strategy.fast}&metadata=true`;
        if (duration) url += `&duration=${Math.floor(duration)}`;
        
        if (__DEV__) console.log(`[Lyrica] Trying ${strategy.label}`);
        
        let result: LyricaResult | null;
        try {
          result = await this.executeFetch(url, strategy.label, timeoutMs);
        } catch (e) {
          // Backend down or timed out: the Echo plain lyrics beat an error.
          if (echo) return this.fromProvider(echo);
          throw e;
        }
        if (result) return result;
      }
      
      if (__DEV__) console.log('[Lyrica] All strategies exhausted');
      return echo ? this.fromProvider(echo) : null;
    } catch (error) {
      console.error('[Lyrica] Fetch error:', error);
      throw error;
    }
  }

  fromProvider(hit: ProviderLyrics): LyricaResult {
    return {
      lyrics: hit.lyrics,
      source: hit.provider,
      metadata: {
        title: hit.trackName,
        artist: hit.artistName,
        album: hit.albumName,
        duration: hit.duration,
      },
    };
  }

  private async executeFetch(url: string, label: string, timeoutMs: number): Promise<LyricaResult | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        let errorText = '';
        try {
            errorText = await response.text();
        } catch {
            errorText = 'Read failed';
        }
        
        const truncatedError = errorText.length > 200 ? errorText.substring(0, 200) + '...' : errorText;
        if (__DEV__) console.log(`[Lyrica] ${label} HTTP ${response.status}:`, truncatedError);
        if (response.status === 404) {
          return null;
        }

        throw new Error(`Lyrics request failed: ${response.status} ${response.statusText}`.trim());
      }

      const data = await response.json();
      
      if (data.status === 'success' && data.data) {
        let finalLyrics = data.data.lyrics;

        // Reject HTML content immediately
        if (typeof finalLyrics === 'string' && (finalLyrics.includes('<div') || finalLyrics.includes('<html') || finalLyrics.includes('<!DOCTYPE'))) {
            console.warn(`[Lyrica] ${label} returned HTML instead of lyrics, rejecting.`);
            return null;
        }

        // Handle structured timed lyrics if plaintext is missing
        if (!finalLyrics && data.data.timestamped) {
          finalLyrics = data.data.timestamped;
        }

        if (!finalLyrics && Array.isArray(data.data.timed_lyrics)) {
          finalLyrics = timedToLrc(data.data.timed_lyrics);
        } else if (Array.isArray(finalLyrics)) {
           try {
               finalLyrics = timedToLrc(finalLyrics);
           } catch {
               finalLyrics = ''; 
           }
        } else if (typeof finalLyrics === 'string' && (finalLyrics.trim().startsWith('[') || finalLyrics.trim().startsWith('{'))) {
           try {
              const parsedJson = JSON.parse(finalLyrics);
              if (Array.isArray(parsedJson)) {
                   finalLyrics = timedToLrc(parsedJson);
              }
           } catch {
               if (finalLyrics.trim().startsWith('[{"')) {
                   finalLyrics = null; 
               }
           }
        }

        if (finalLyrics) {
          return {
            lyrics: finalLyrics,
            source: `Lyrica (${label})`, 
            metadata: {
              title: data.data.track_name || data.data.title,
              artist: data.data.artist_name || data.data.artist,
              duration: data.data.duration?.seconds || data.data.duration,
              coverArt: data.data.album_art
            }
          };
        }
      }
      return null;
    } catch (err: any) {
      if (err.name === 'AbortError') {
         if (__DEV__) console.warn(`[Lyrica] ${label} timed out after ${timeoutMs}ms.`);
         throw new Error('Lyrics request timed out');
      }

      if (__DEV__) console.log(`[Lyrica] ${label} failed:`, err.message || 'Unknown Network Error');
      throw err instanceof Error ? err : new Error('Lyrics request failed');
    } finally {
      clearTimeout(timer);
    }
  }

  parseLrc(lrcContent: string, duration: number = 180): LyricLine[] {
    if (!lrcContent) return [];
    
    const lines = lrcContent.split('\n');
    const result: LyricLine[] = [];
    const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;

    // Check if ANY line has a timestamp first
    const hasTimestamps = lines.some(line => timeRegex.test(line));
    
    // Ensure valid duration for estimation (prevent 0 timestamps)
    const safeDuration = duration > 0 ? duration : 180;

    if (hasTimestamps) {
        // Standard LRC Parsing; word tags (`<mm:ss.xxx>`) become the line's words.
        const timed: { timestamp: number; content: string; index: number }[] = [];
        lines.forEach((line, index) => {
          const match = line.match(timeRegex);
          if (match) {
            const minutes = parseInt(match[1], 10);
            const seconds = parseInt(match[2], 10);
            const millisecondsStr = match[3].padEnd(3, '0');
            const milliseconds = parseInt(millisecondsStr, 10);

            const timestamp = minutes * 60 + seconds + milliseconds / 1000;
            timed.push({ timestamp, content: line.replace(timeRegex, ''), index });
          }
        });
        timed.forEach(({ timestamp, content, index }, i) => {
          const { text, words } = parseWordTags(content, timestamp, timed[i + 1]?.timestamp);
          result.push({
            timestamp,
            text: text || '[INSTRUMENTAL]',
            lineOrder: index,
            ...(text && words ? { words } : {}),
          });
        });
    } else {
        // PLAIN TEXT AUTO-SCROLL LOGIC
        const meaningfulLines = lines.map(l => l.trim()).filter(l => l.length > 0);
        const totalLines = meaningfulLines.length;
        
        if (totalLines > 0) {
            const timePerLine = safeDuration / totalLines;
            meaningfulLines.forEach((text, index) => {
                result.push({
                    timestamp: index * timePerLine,
                    text: text,
                    lineOrder: index,
                });
            });
        }
    }
    
    return result.map((line, idx) => ({ ...line, lineOrder: idx }));
  }

  hasTimestamps(lyrics: string): boolean {
    return /\[\d{2}:\d{2}\.\d{2,3}\]/.test(lyrics);
  }
}

export const lyricaService = new LyricaService();

export function getLyricsFriendlyError(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('network') || msg.includes('failed to fetch')) {
      return 'No internet connection. Check your network and try again.';
    }
    if (msg.includes('timeout') || msg.includes('timed out')) {
      return 'Lyrics request timed out. Please check connection and try again.';
    }
    if (msg.includes('404') || msg.includes('not found')) {
      return 'No lyrics found for this song.';
    }
    if (msg.includes('429') || msg.includes('rate limit')) {
      return 'Too many requests. Please wait a moment and try again.';
    }
    if (msg.includes('500') || msg.includes('503') || msg.includes('server')) {
      return 'Lyrics service is temporarily unavailable. Please retry in a moment.';
    }
  }
  return 'Lyrics service is temporarily unavailable. Please retry in a moment.';
}
