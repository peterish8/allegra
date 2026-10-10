import { isDerivative } from './derivative.js';
import type { SaavnAlbum, SaavnSong } from '../providers/saavn.js';
import type { AlbumDetail, AlbumSummary, UnifiedSong } from '../types.js';
import { decodeHtml } from './decodeHtml.js';
import { identityKey } from '../shared/identity.js';

export function normalizeSong(
  raw: SaavnSong,
  source: 'Saavn' | 'Gaana'
): UnifiedSong | null {
  if (raw.id === undefined) {
    return null;
  }

  const id = String(raw.id).trim();
  const title = decodeHtml((raw.name ?? raw.title ?? '').trim());
  const artist = decodeHtml(getArtist(raw));
  const stream = pickAsset(raw.downloadUrl, '320kbps');
  if (!id || !title || !stream) {
    return null;
  }

  const image = pickAsset(raw.image, '500x500') ?? '';
  const duration = toNonNegativeNumber(raw.duration);
  const playCount = source === 'Gaana' ? 0 : parsePlayCount(raw.playCount ?? raw.play_count);
  const album = getAlbum(raw);
  // Only Saavn's ids open with GET /api/albums/:id; a Gaana album id belongs to another catalog.
  const albumId = source === 'Saavn' ? getAlbumId(raw) : null;
  const optional = {
    ...(raw.language ? { language: decodeHtml(raw.language) } : {})
  };

  return {
    id,
    title,
    artist,
    ...(album ? { album: decodeHtml(album) } : {}),
    ...(album && albumId ? { albumId } : {}),
    artwork: image,
    streamUrl: `/api/stream/${encodeURIComponent(source === 'Gaana' ? `gaana:${id}` : id)}`,
    duration,
    hasLyrics: raw.hasLyrics === true,
    ...optional,
    playCount,
    source
  };
}

/**
 * A key that is the same for two provider rows describing the same recording.
 * The providers list one row per release, so the same song comes back several
 * times with a different id — which makes a shelf or a recommendation show it
 * twice in a row. The title loses its "(From "Some Film")" / "(Telugu)" trailers,
 * which is where the rows disagree most, and the artist credits are sorted
 * because a re-release often lists the same people in a different order.
 */
export function songIdentity(song: UnifiedSong): string {
  return identityKey(song.title, song.artist);
}

/**
 * Group provider rows that describe the same recording. Elects one canonical
 * row and attaches the rest as flat `variants`. Order of first appearance of
 * each recording identity is preserved.
 *
 * Election (any song, not just one title):
 * 1. Meaningful playCount lead (near-ties ignored — Saavn copies often differ by 1)
 * 2. Album name matches the song title (official single) over editorial placements
 * 3. Real primary artist over "Various Artists"
 * 4. Albums not shared across many artists in this result set
 */
export function collapseRecordings(songs: readonly UnifiedSong[]): UnifiedSong[] {
  if (songs.length <= 1) {
    return [...songs];
  }

  const groups = new Map<string, UnifiedSong[]>();
  const order: string[] = [];
  for (const song of songs) {
    const key = songIdentity(song);
    const existing = groups.get(key);
    if (existing) {
      existing.push(song);
    } else {
      groups.set(key, [song]);
      order.push(key);
    }
  }

  const albumDiversity = albumArtistCounts(songs);

  return order.map((key) => {
    const group = groups.get(key) ?? [];
    const canonical = electCanonical(group, albumDiversity);
    const variants = group
      .filter((song) => song.id !== canonical.id)
      .map(stripVariants);
    if (variants.length === 0) {
      return stripVariants(canonical);
    }
    return { ...stripVariants(canonical), variants };
  });
}

function electCanonical(
  group: readonly UnifiedSong[],
  albumDiversity: ReadonlyMap<string, number>
): UnifiedSong {
  return [...group].sort((left, right) => {
    // An edit — sped up, slowed, live, karaoke — is never the canonical take of a
    // recording, however many plays it has collected.
    const edit = Number(isDerivative(left)) - Number(isDerivative(right));
    if (edit !== 0) return edit;

    // Day-lists / "best of" shells often outrank the studio cut on raw plays.
    // Prefer a real release unless the compilation has a clear blowout (~5×).
    const leftComp = isCompilationAlbum(left.album);
    const rightComp = isCompilationAlbum(right.album);
    if (leftComp !== rightComp) {
      const compilation = leftComp ? left : right;
      const release = leftComp ? right : left;
      if (!isPlayCountBlowout(compilation.playCount, release.playCount)) {
        return leftComp ? 1 : -1;
      }
    }

    // Saavn stamps nearly the same playCount on every placement of a hit.
    // A lead of 1 must not beat the official cut; a true blowout still should.
    const play = comparePlayCount(left.playCount, right.playCount);
    if (play !== 0) return play;

    const titleAlbum =
      Number(albumMatchesTitle(right)) - Number(albumMatchesTitle(left));
    if (titleAlbum !== 0) return titleAlbum;

    const various = Number(isVariousArtists(left.artist)) - Number(isVariousArtists(right.artist));
    if (various !== 0) return various;

    const leftAlbum = left.album ? albumDiversity.get(flatten(left.album)) ?? 0 : 0;
    const rightAlbum = right.album ? albumDiversity.get(flatten(right.album)) ?? 0 : 0;
    if (leftAlbum !== rightAlbum) return leftAlbum - rightAlbum;

    // Stable leftover: higher playCount even inside the near-tie band.
    return right.playCount - left.playCount;
  })[0]!;
}

/** True when album is the song's own single (title ≈ album), not a playlist placement. */
function albumMatchesTitle(song: UnifiedSong): boolean {
  if (!song.album) return false;
  const title = flatten(song.title.replace(/[([][^)\]]*[)\]]/gu, ' '));
  const album = flatten(song.album);
  if (!title || !album) return false;
  return album === title || album.startsWith(`${title} `) || title.startsWith(album);
}

/**
 * Meaningful playCount comparison. Near-ties (within 2% or 2_000 plays) count as
 * equal so editorial playlist rows cannot win by a single play over the single.
 */
function comparePlayCount(left: number, right: number): number {
  const delta = right - left;
  if (delta === 0) return 0;
  const scale = Math.max(left, right, 1);
  if (Math.abs(delta) <= 2_000 || Math.abs(delta) / scale <= 0.02) return 0;
  return delta;
}

/** True when `high` clearly outranks `low` (≈5× or a huge absolute gap). */
function isPlayCountBlowout(high: number, low: number): boolean {
  if (high <= low) return false;
  if (high >= low * 5) return true;
  return high - low >= 5_000_000;
}

/** How many distinct primary artists share each album name in this result set. */
function albumArtistCounts(songs: readonly UnifiedSong[]): Map<string, number> {
  const artistsByAlbum = new Map<string, Set<string>>();
  for (const song of songs) {
    if (!song.album) continue;
    const albumKey = flatten(song.album);
    const artistKey = flatten(song.artist);
    const set = artistsByAlbum.get(albumKey) ?? new Set<string>();
    set.add(artistKey);
    artistsByAlbum.set(albumKey, set);
  }
  const counts = new Map<string, number>();
  for (const [album, artists] of artistsByAlbum) {
    counts.set(album, artists.size);
  }
  return counts;
}

function isVariousArtists(artist: string): boolean {
  return /\bvarious\s+artists\b/i.test(artist);
}

/** Playlist / themed day-list / "best of" shells — not the song's own release. */
function isCompilationAlbum(album: string | undefined): boolean {
  if (!album) return false;
  return /\b(best of|greatest hits|hits|playlist|world music day|valentine|holi|diwali|christmas|new year|top\s*\d+|chartbusters?|jukebox|collection|anthology|various|tik\s*tok|viral|throwbacks?|trending|essentials|mega\s*mix|party\s*mix|sad\s*songs|love\s*songs|workout|road\s*trip|vibes|moods?)\b/i.test(
    album
  );
}

/**
 * True when every row in the group is a licence placement rather than a release.
 *
 * The signature is unmistakable: one master — same play count, same length to the
 * second — listed on several *different* albums, none of which is named after it.
 * Saavn does this for anything that went viral, and the record it was actually
 * released on is usually not in the result set at all. So the album name and the
 * cover art on every one of these rows belong to somebody's playlist.
 *
 * Structural on purpose. A keyword list never ends: "Throwback TikTok Songs" is a
 * compilation and reads like nothing in one.
 */
export function isPlacementOnly(group: readonly UnifiedSong[]): boolean {
  if (group.length < 3) return false;
  const first = group[0];
  if (!first) return false;
  const albums = new Set(group.map((song) => (song.album ? flatten(song.album) : '')));
  if (albums.size < 3) return false;
  if (group.some(albumMatchesTitle)) return false;
  return group.every((song) => song.playCount === first.playCount && song.duration === first.duration);
}

/**
 * Whether this row is worth asking an outside authority about: it is on an album that
 * is not its own, and that album reads like a compilation. Callers pay a rate-limited
 * network round trip for a true answer, so it stays deliberately narrow.
 */
export function needsCanonicalRelease(song: UnifiedSong): boolean {
  if (albumMatchesTitle(song)) return false;
  return isCompilationAlbum(song.album) || isPlacementOnly([song, ...(song.variants ?? [])]);
}

function stripVariants(song: UnifiedSong): UnifiedSong {
  if (!song.variants) return song;
  const { variants, ...rest } = song;
  void variants;
  return rest;
}

function flatten(value: string): string {
  return decodeHtml(value).toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function getArtist(raw: SaavnSong): string {
  if (raw.primaryArtists?.trim()) {
    return raw.primaryArtists.trim();
  }

  const names = raw.artists?.primary
    ?.map((artist) => artist.name?.trim())
    .filter((name): name is string => Boolean(name));
  return names?.join(', ') || 'Unknown Artist';
}

function getAlbum(raw: SaavnSong): string | null {
  if (typeof raw.album === 'string') {
    return raw.album.trim() || null;
  }
  return raw.album?.name?.trim() || null;
}

/** A provider album id we can pass back to it safely: short, letters, digits, `_` or `-`. */
function cleanAlbumId(value: unknown): string | null {
  const id = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9_-]{1,40}$/.test(id) ? id : null;
}

function getAlbumId(raw: SaavnSong): string | null {
  return typeof raw.album === 'object' ? cleanAlbumId(raw.album.id) : null;
}

/** A Saavn album as the contract's `AlbumSummary`, or null without an id and a name. */
export function normalizeAlbumSummary(raw: SaavnAlbum): AlbumSummary | null {
  const id = cleanAlbumId(raw.id);
  const name = decodeHtml((raw.name ?? '').trim());
  if (!id || !name) return null;
  const artists = raw.artists?.primary?.map((artist) => decodeHtml(artist.name?.trim() ?? '')).filter(Boolean) ?? [];
  const year = raw.year === undefined || raw.year === null ? '' : String(raw.year).trim();
  return {
    id,
    name,
    artist: artists.join(', ') || 'Various Artists',
    artwork: pickAsset(raw.image, '500x500'),
    year: /^\d{4}$/.test(year) ? year : null,
    language: raw.language ? decodeHtml(raw.language) : null
  };
}

/** A Saavn album with its songs as `AlbumDetail`: track order kept, unplayable rows dropped. */
export function normalizeAlbumDetail(raw: SaavnAlbum): AlbumDetail | null {
  const summary = normalizeAlbumSummary(raw);
  if (!summary) return null;
  const songs = (raw.songs ?? []).flatMap((song) => {
    const normalized = normalizeSong(song, 'Saavn');
    return normalized ? [normalized] : [];
  });
  const counted = typeof raw.songCount === 'number' ? raw.songCount : Number(raw.songCount);
  return { ...summary, songCount: Number.isFinite(counted) && counted >= songs.length ? Math.trunc(counted) : songs.length, songs };
}

function pickAsset(
  assets: readonly { readonly quality?: string; readonly url?: string }[] | undefined,
  preferredQuality: string
): string | null {
  if (!assets) {
    return null;
  }

  const usable = assets.filter((asset) => Boolean(asset.url));
  const preferred = usable.find((asset) => asset.quality === preferredQuality);
  return preferred?.url ?? usable.at(-1)?.url ?? null;
}

function parsePlayCount(value: number | string | undefined): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
  }

  if (typeof value === 'string') {
    const digits = value.replace(/\D/g, '');
    return digits ? Number.parseInt(digits, 10) : 0;
  }

  return 0;
}

function toNonNegativeNumber(value: number | string | undefined): number {
  const number = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}
