import { creditedArtists } from '@shared/identity';
import type { UnifiedSong } from '@shared/types';

const plain = (value: string): string => value.replace(/\s+/g, ' ').trim().toLocaleLowerCase();

function artistsOf(song: UnifiedSong): Set<string> {
  return new Set(creditedArtists(song.artist).map(plain).filter(Boolean));
}

/**
 * The tracks of the seed's album found in the given pools, in pool order. The catalog has no album
 * id, so an album is its name plus artists that connect: a track joins when it shares a credited
 * artist with any track already in. A soundtrack credits different singers on every track
 * ("Sai Abhyankkar, The Indian Choral Ensemble", "Vivek, Sai Abhyankkar, Shruti Haasan") and stays
 * whole through its composer; two unrelated albums that happen to share a name stay apart.
 * Matching the whole credit line once cut a 5-song search result down to 1 (2026-10-11).
 */
export function collectAlbumTracks(seed: UnifiedSong, pools: readonly (readonly UnifiedSong[])[]): UnifiedSong[] {
  const albumName = seed.album?.trim();
  if (!albumName) return [seed];
  const key = plain(albumName);

  // The catalog's album id settles it outright when the seed has one: same id, same album.
  if (seed.albumId) {
    const seenIds = new Set<string>();
    const sameAlbum: UnifiedSong[] = [];
    for (const pool of pools) {
      for (const song of pool) {
        if (song.albumId !== seed.albumId || seenIds.has(song.id)) continue;
        seenIds.add(song.id);
        sameAlbum.push(song);
      }
    }
    if (!seenIds.has(seed.id)) sameAlbum.unshift(seed);
    return sameAlbum;
  }

  const seen = new Set<string>();
  const candidates: UnifiedSong[] = [];
  for (const pool of pools) {
    for (const song of pool) {
      if (!song.album?.trim() || plain(song.album) !== key || seen.has(song.id)) continue;
      seen.add(song.id);
      candidates.push(song);
    }
  }
  if (!seen.has(seed.id)) candidates.unshift(seed);

  // Grow from the seed until no other track shares an artist with the ones already in.
  const artists = artistsOf(seed);
  const inAlbum = new Set([seed.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const song of candidates) {
      if (inAlbum.has(song.id)) continue;
      const credits = artistsOf(song);
      if (![...credits].some((name) => artists.has(name))) continue;
      inAlbum.add(song.id);
      for (const name of credits) artists.add(name);
      grew = true;
    }
  }
  return candidates.filter((song) => inAlbum.has(song.id));
}

/** An album known by the catalog's id (from album search or an artist's albums), before its tracks load. */
export interface AlbumTarget {
  readonly id: string;
  readonly name: string;
  readonly artist: string;
  readonly artwork: string | null;
  readonly year: string | null;
}

const STAND_IN = 'album:';

/**
 * A stand-in seed that carries an album to the album page (its name, cover and id) until the catalog's
 * tracks arrive. Never played or liked: its id starts with `album:` and it has no stream.
 */
export function albumStandIn(album: AlbumTarget): UnifiedSong {
  return {
    id: `${STAND_IN}${album.id}`, title: album.name, artist: album.artist, album: album.name, albumId: album.id,
    artwork: album.artwork ?? '', streamUrl: '', duration: 0, hasLyrics: false, playCount: 0, source: 'Saavn'
  };
}

export function isAlbumStandIn(song: UnifiedSong): boolean {
  return song.id.startsWith(STAND_IN);
}

export interface AlbumHit {
  readonly key: string;
  readonly name: string;
  readonly seed: UnifiedSong;
  readonly trackCount: number;
  readonly tracks: readonly UnifiedSong[];
}

/**
 * Albums among search results, grouped exactly as the album page groups them (`collectAlbumTracks`),
 * so a card's "5 songs" is the five the page then shows.
 */
export function albumsInResults(songs: readonly UnifiedSong[], limit: number): AlbumHit[] {
  const hits: AlbumHit[] = [];
  const covered = new Set<string>();
  for (const song of songs) {
    const name = song.album?.trim();
    if (!name || covered.has(song.id)) continue;
    const tracks = collectAlbumTracks(song, [songs]);
    for (const track of tracks) covered.add(track.id);
    hits.push({ key: `${plain(name)}|${song.id}`, name, seed: song, trackCount: tracks.length, tracks });
    if (hits.length >= limit) break;
  }
  return hits;
}

export function formatAlbumDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '0 min';
  const minutes = Math.round(totalSeconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem === 0 ? `${hours} hr` : `${hours} hr ${rem} min`;
}
