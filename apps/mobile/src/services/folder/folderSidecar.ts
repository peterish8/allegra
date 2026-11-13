/**
 * @fileoverview The small JSON file kept beside each song in the downloads folder. A fresh install reads these
 * to bring the songs back into the library with their titles, covers and lyrics. Versioned, and read leniently:
 * an unknown or damaged file is skipped, never an error.
 */
import type { LyricLine } from '../../types/song';
import { formatLrcTime } from '../lyrics/lrc';

export interface Sidecar {
  v: 1;
  /** The library id, so a restored song is the same song and is never added twice. */
  id: string;
  title: string;
  artist: string;
  album?: string;
  /** Seconds. */
  duration: number;
  /** The catalog song (`saavn:<id>`), so other devices can still play it. */
  originId?: string;
  coverRemoteUri?: string;
  /** Synced lyrics as LRC text. */
  lyrics?: string;
  /** The audio file's name in the same folder. */
  file: string;
  /** The cover file's name in the same folder, when one was saved. */
  cover?: string;
}

export interface SidecarSource {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  duration?: number;
  originId?: string;
  coverRemoteUri?: string;
  lyrics?: string;
}

/** Synced lines as LRC text; blank when there are none. */
export function lyricsToLrc(lines: readonly LyricLine[] | undefined): string {
  if (!lines || lines.length === 0) return '';
  return lines
    .filter(line => line.text.trim().length > 0)
    .map(line => `${formatLrcTime(line.timestamp * 1000)}${line.text}`)
    .join('\n');
}

export function buildSidecar(source: SidecarSource, base: string, hasCover: boolean): string {
  const sidecar: Sidecar = {
    v: 1,
    id: source.id,
    title: source.title,
    artist: source.artist ?? '',
    album: source.album || undefined,
    duration: Number.isFinite(source.duration) ? Number(source.duration) : 0,
    originId: source.originId || undefined,
    coverRemoteUri: source.coverRemoteUri || undefined,
    lyrics: source.lyrics || undefined,
    file: `${base}.mp3`,
    cover: hasCover ? `${base}.jpg` : undefined,
  };
  return JSON.stringify(sidecar);
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** A sidecar from its text; null when it is not one this app wrote (no id, title or audio file). */
export function parseSidecar(raw: string): Sidecar | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const f = json as Record<string, unknown>;
  if (f.v !== 1) return null;
  const id = text(f.id);
  const title = text(f.title);
  const file = text(f.file);
  if (!id || !title || !file) return null;
  return {
    v: 1,
    id,
    title,
    artist: text(f.artist),
    album: text(f.album) || undefined,
    duration: typeof f.duration === 'number' && Number.isFinite(f.duration) ? f.duration : 0,
    originId: text(f.originId) || undefined,
    coverRemoteUri: text(f.coverRemoteUri) || undefined,
    lyrics: text(f.lyrics) || undefined,
    file,
    cover: text(f.cover) || undefined,
  };
}

/** `playlists.json`: which songs each playlist holds, by library id. */
export interface PlaylistsFile {
  v: 1;
  playlists: { name: string; songIds: string[] }[];
}

export function buildPlaylistsFile(playlists: PlaylistsFile['playlists']): string {
  const file: PlaylistsFile = { v: 1, playlists };
  return JSON.stringify(file);
}

export function parsePlaylistsFile(raw: string): PlaylistsFile['playlists'] {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!json || typeof json !== 'object') return [];
  const list = (json as { playlists?: unknown }).playlists;
  if (!Array.isArray(list)) return [];
  const out: PlaylistsFile['playlists'] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const { name, songIds } = entry as { name?: unknown; songIds?: unknown };
    if (typeof name !== 'string' || !name.trim() || !Array.isArray(songIds)) continue;
    out.push({ name, songIds: songIds.filter((id): id is string => typeof id === 'string') });
  }
  return out;
}
