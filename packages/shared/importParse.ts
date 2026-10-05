export const IMPORT_LIMITS = {
  tracks: 10_000,
  playlists: 200,
  textLength: 200
} as const;

export interface ImportedTrack {
  readonly title: string;
  readonly artist: string;
  readonly album?: string;
  readonly durationSec?: number;
}

export interface ImportedPlaylist {
  readonly name: string;
  /** Stable export identity when available; never inferred from a display name. */
  readonly sourceId?: string;
  readonly tracks: readonly ImportedTrack[];
}

/** Key for selection and persistence: source identity first, legacy display name as fallback. */
export const playlistIdentity = (playlist: Pick<ImportedPlaylist, 'name' | 'sourceId'>): string =>
  playlist.sourceId ?? playlist.name;

export interface ImportBundle {
  readonly source: 'spotify-export' | 'csv';
  readonly liked: readonly ImportedTrack[];
  readonly playlists: readonly ImportedPlaylist[];
  readonly skipped: number;
  readonly truncated: boolean;
}

interface TrackParseResult {
  readonly tracks: ImportedTrack[];
  readonly skipped: number;
  readonly truncated: boolean;
}

interface PlaylistParseResult {
  readonly playlists: ImportedPlaylist[];
  readonly skipped: number;
  readonly truncated: boolean;
  readonly tracks: number;
}

interface CsvRow {
  readonly cells: readonly string[];
  readonly valid: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().slice(0, IMPORT_LIMITS.textLength);
  return trimmed.length > 0 ? trimmed : undefined;
}

function artistValue(value: unknown): string | undefined {
  const artist = textValue(value);
  if (!artist) return undefined;
  return textValue(artist.split(';').map((name) => name.trim()).filter(Boolean).join(', '));
}

function durationFromMilliseconds(value: unknown): number | undefined {
  let milliseconds: number;
  if (typeof value === 'number') {
    milliseconds = value;
  } else if (typeof value === 'string' && value.trim().length > 0) {
    milliseconds = Number(value.trim());
  } else {
    return undefined;
  }

  const seconds = milliseconds / 1000;
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 7200) return undefined;
  return seconds;
}

function hasNonTrackMarker(record: Record<string, unknown>): boolean {
  const episode: unknown = record.episode;
  const localTrack: unknown = record.localTrack;
  return (episode !== null && episode !== undefined) || (localTrack !== null && localTrack !== undefined);
}

function trackFromRecord(value: unknown): ImportedTrack | undefined {
  if (!isRecord(value) || hasNonTrackMarker(value)) return undefined;

  const title = textValue(value.trackName);
  const artist = artistValue(value.artistName);
  if (!title || !artist) return undefined;

  const album = textValue(value.albumName);
  const durationSec = durationFromMilliseconds(value.duration_ms);
  return {
    title,
    artist,
    ...(album ? { album } : {}),
    ...(durationSec !== undefined ? { durationSec } : {})
  };
}

function libraryResult(json: unknown): TrackParseResult {
  if (!isRecord(json) || !Array.isArray(json.tracks)) {
    return { tracks: [], skipped: 1, truncated: false };
  }

  const tracks: ImportedTrack[] = [];
  let skipped = 0;
  let truncated = false;

  for (const entry of json.tracks) {
    const track = trackFromRecord(entry);
    if (!track) {
      skipped += 1;
      continue;
    }
    if (tracks.length >= IMPORT_LIMITS.tracks) {
      truncated = true;
      continue;
    }
    tracks.push(track);
  }

  return { tracks, skipped, truncated };
}

function playlistResult(
  json: unknown,
  playlistLimit: number,
  trackLimit: number,
  sourceFile = 'Playlist1.json'
): PlaylistParseResult {
  if (!isRecord(json) || !Array.isArray(json.playlists)) {
    return { playlists: [], skipped: 1, truncated: false, tracks: 0 };
  }

  const playlists: ImportedPlaylist[] = [];
  let skipped = 0;
  let truncated = false;
  let trackCount = 0;

  for (const [playlistIndex, rawPlaylist] of json.playlists.entries()) {
    if (!isRecord(rawPlaylist)) {
      skipped += 1;
      continue;
    }

    const name = textValue(rawPlaylist.name);
    if (!name) {
      skipped += 1;
      continue;
    }
    if (playlists.length >= playlistLimit) {
      truncated = true;
      continue;
    }

    const rawItems: unknown = rawPlaylist.items;
    const items = Array.isArray(rawItems) ? rawItems : [];
    if (!Array.isArray(rawItems)) skipped += 1;

    const tracks: ImportedTrack[] = [];
    for (const rawItem of items) {
      if (!isRecord(rawItem) || hasNonTrackMarker(rawItem)) {
        skipped += 1;
        continue;
      }

      const track = trackFromRecord(rawItem.track);
      if (!track) {
        skipped += 1;
        continue;
      }
      if (trackCount >= trackLimit) {
        truncated = true;
        continue;
      }

      trackCount += 1;
      tracks.push(track);
    }

    const uri = typeof rawPlaylist.uri === 'string' && /^spotify:playlist:[A-Za-z0-9]+$/u.test(rawPlaylist.uri)
      ? rawPlaylist.uri
      : typeof rawPlaylist.playlistUri === 'string' && /^spotify:playlist:[A-Za-z0-9]+$/u.test(rawPlaylist.playlistUri)
        ? rawPlaylist.playlistUri
        : typeof rawPlaylist.id === 'string' && /^[A-Za-z0-9]{16,}$/u.test(rawPlaylist.id)
          ? `spotify:playlist:${rawPlaylist.id}`
          : undefined;
    // Spotify's downloaded data often omits playlist URIs. The file path + array position then
    // distinguishes equal names while remaining stable for the same export and through renames.
    const sourceId = uri ?? `spotify-export:${sourceFile.toLocaleLowerCase()}:${playlistIndex}`;
    playlists.push({ name, sourceId, tracks });
  }

  return { playlists, skipped, truncated, tracks: trackCount };
}

export function parseSpotifyLibrary(json: unknown): { tracks: ImportedTrack[]; skipped: number } {
  const result = libraryResult(json);
  return { tracks: result.tracks, skipped: result.skipped };
}

export function parseSpotifyPlaylists(
  json: unknown
): { playlists: ImportedPlaylist[]; skipped: number } {
  const result = playlistResult(json, IMPORT_LIMITS.playlists, IMPORT_LIMITS.tracks);
  return { playlists: result.playlists, skipped: result.skipped };
}

function emptyBundle(source: ImportBundle['source'], skipped: number): ImportBundle {
  return { source, liked: [], playlists: [], skipped, truncated: false };
}

export function bundleFromSpotifyFiles(
  files: readonly { readonly name: string; readonly json: unknown }[]
): ImportBundle {
  if (!Array.isArray(files)) return emptyBundle('spotify-export', 1);

  const libraryFiles: { readonly name: string; readonly json: unknown }[] = [];
  const playlistFiles: { readonly name: string; readonly json: unknown; readonly number: number; readonly order: number }[] = [];
  let skipped = 0;

  files.forEach((file, order) => {
    if (!isRecord(file) || typeof file.name !== 'string') {
      skipped += 1;
      return;
    }

    const normalizedPath = file.name.replace(/\\/gu, '/').split('/').map((part) => part.toLocaleLowerCase()).join('/');
    const name = normalizedPath.split('/').pop() ?? '';
    const json: unknown = file.json;
    if (name === 'yourlibrary.json') {
      libraryFiles.push({ name, json });
      return;
    }

    const playlistMatch = /^playlist(\d+)\.json$/u.exec(name);
    if (playlistMatch) {
      playlistFiles.push({
        name: normalizedPath,
        json,
        number: Number(playlistMatch[1]),
        order
      });
    }
  });

  const firstLibraryFile = libraryFiles[0];
  const library = firstLibraryFile
    ? libraryResult(firstLibraryFile.json)
    : { tracks: [], skipped: 0, truncated: false };
  skipped += library.skipped;
  let truncated = library.truncated;
  const liked = library.tracks.slice(0, IMPORT_LIMITS.tracks);
  let trackCount = liked.length;
  const playlists: ImportedPlaylist[] = [];

  playlistFiles.sort((left, right) => left.number - right.number || left.order - right.order);
  for (const file of playlistFiles) {
    const remainingPlaylists = IMPORT_LIMITS.playlists - playlists.length;
    const remainingTracks = IMPORT_LIMITS.tracks - trackCount;
    const parsed = playlistResult(file.json, remainingPlaylists, remainingTracks, file.name);
    skipped += parsed.skipped;
    truncated ||= parsed.truncated;
    playlists.push(...parsed.playlists);
    trackCount += parsed.tracks;
  }

  return { source: 'spotify-export', liked, playlists, skipped, truncated };
}

function csvRows(text: string): CsvRow[] {
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let field = '';
  let quoted = false;
  let afterQuote = false;
  let valid = true;
  let rowTouched = false;

  const finishField = (): void => {
    cells.push(field);
    field = '';
    afterQuote = false;
  };
  const finishRow = (): void => {
    finishField();
    if (rowTouched || cells.some((cell) => cell.length > 0) || !valid) {
      rows.push({ cells, valid });
    }
    cells = [];
    field = '';
    quoted = false;
    afterQuote = false;
    valid = true;
    rowTouched = false;
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === undefined) continue;

    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === ',') {
      finishField();
      rowTouched = true;
      continue;
    }
    if (character === '\r' || character === '\n') {
      finishRow();
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      continue;
    }
    if (character === '"') {
      if (field.length === 0 && !afterQuote) {
        quoted = true;
        rowTouched = true;
      } else {
        valid = false;
        field += character;
      }
      continue;
    }

    if (afterQuote && !/\s/u.test(character)) valid = false;
    field += character;
    if (!/\s/u.test(character)) rowTouched = true;
  }

  if (quoted) valid = false;
  if (rowTouched || field.length > 0 || cells.length > 0 || !valid) finishRow();
  return rows;
}

function normalizedHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, ' ');
}

function headerIndex(headers: readonly string[], choices: readonly string[]): number {
  return headers.findIndex((header) => choices.includes(normalizedHeader(header)));
}

function csvText(value: string | undefined): string | undefined {
  return artistValue(value);
}

function durationFromCsv(value: string | undefined, milliseconds: boolean): number | undefined {
  if (value === undefined || value.trim().length === 0) return undefined;
  const amount = Number(value.trim());
  if (!Number.isFinite(amount) || amount < 0) return undefined;
  const seconds = milliseconds ? amount / 1000 : amount;
  if (seconds > 7200) return undefined;
  return seconds;
}

export function parseCsv(text: string): ImportBundle {
  if (typeof text !== 'string') return emptyBundle('csv', 1);
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = csvRows(withoutBom);
  const headerRow = rows[0];
  if (!headerRow || !headerRow.valid) return emptyBundle('csv', 1);

  const headers = headerRow.cells;
  const titleColumn = headerIndex(headers, ['title', 'track name', 'name']);
  const artistColumn = headerIndex(headers, ['artist', 'artist name(s)', 'artists']);
  const albumColumn = headerIndex(headers, ['album', 'album name']);
  const durationColumn = headerIndex(headers, ['duration', 'duration (ms)']);
  if (titleColumn < 0 || artistColumn < 0) return emptyBundle('csv', 1);

  const durationHeader = durationColumn >= 0 ? normalizedHeader(headers[durationColumn] ?? '') : '';
  const durationIsMilliseconds = durationHeader.includes('(ms)') || durationHeader === 'duration ms';
  const liked: ImportedTrack[] = [];
  let skipped = 0;
  let truncated = false;

  for (const row of rows.slice(1)) {
    if (row.cells.every((cell) => cell.trim().length === 0)) continue;
    if (!row.valid) {
      skipped += 1;
      continue;
    }

    const title = textValue(row.cells[titleColumn]);
    const artist = csvText(row.cells[artistColumn]);
    if (!title || !artist) {
      skipped += 1;
      continue;
    }

    if (liked.length >= IMPORT_LIMITS.tracks) {
      truncated = true;
      continue;
    }

    const album = albumColumn >= 0 ? textValue(row.cells[albumColumn]) : undefined;
    const durationSec = durationColumn >= 0
      ? durationFromCsv(row.cells[durationColumn], durationIsMilliseconds)
      : undefined;
    liked.push({
      title,
      artist,
      ...(album ? { album } : {}),
      ...(durationSec !== undefined ? { durationSec } : {})
    });
  }

  return { source: 'csv', liked, playlists: [], skipped, truncated };
}
