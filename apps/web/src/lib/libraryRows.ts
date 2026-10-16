import type { LibraryChange } from '@shared/library';
import type { SongRef, SongSnapshot } from '@shared/songRef';
import type { UnifiedSong } from '@shared/types';
import { fromAllegraSong, matchKey, parseSongRef, toAllegraId } from '@shared/songRef';

export type LikeChange = Extract<LibraryChange, { kind: 'like' }>;
export type PlaylistChange = Extract<LibraryChange, { kind: 'playlist' }>;
export type PlaylistItemChange = Extract<LibraryChange, { kind: 'playlist_item' }>;

export interface LibraryRows {
  readonly likes: readonly LikeChange[];
  readonly playlists: readonly PlaylistChange[];
  readonly itemsByPlaylist: ReadonlyMap<string, readonly PlaylistItemChange[]>;
}

export type LibrarySong = UnifiedSong & {
  readonly libraryRef: SongRef;
  readonly librarySnapshot?: SongSnapshot;
};

/**
 * The one key a liked song is known by, whichever form it arrives in: the playing catalog song
 * (`abc`), a library row built from its saved snapshot (`library:saavn:abc`), or a Gaana row. Taken
 * from the song's ref, never its display id: a snapshot row's id differs from the catalog id, and
 * keying by id made a fresh like read as unliked after the next library reload (2026-10-11).
 */
export function likedKey(song: UnifiedSong): string {
  const ref = (song as Partial<LibrarySong>).libraryRef ?? fromAllegraSong(song);
  if (!ref) return song.id;
  return toAllegraId(ref) ?? `library:${ref}`;
}

export function createLibrarySong(ref: SongRef, snapshot?: SongSnapshot, playable?: UnifiedSong): LibrarySong | null {
  if (playable) return { ...playable, libraryRef: ref, ...(snapshot ? { librarySnapshot: snapshot } : {}) };
  if (!snapshot) return null;
  const source = parseSongRef(ref)?.source;
  if (!source) return null;
  return {
    id: `library:${ref}`,
    title: snapshot.title,
    artist: snapshot.artist,
    ...(snapshot.album ? { album: snapshot.album } : {}),
    artwork: snapshot.artwork,
    streamUrl: '',
    duration: snapshot.duration,
    hasLyrics: false,
    playCount: 0,
    source: source === 'saavn' ? 'Saavn' : 'Gaana',
    libraryRef: ref,
    librarySnapshot: snapshot
  };
}

/** Gaana playback is allowed only after an exact title+lead-artist catalog match. */
export function exactSaavnMatch(snapshot: SongSnapshot, candidates: readonly UnifiedSong[]): UnifiedSong | null {
  const key = matchKey(snapshot.title, snapshot.artist);
  return candidates.find((song) => song.source === 'Saavn' && matchKey(song.title, song.artist) === key) ?? null;
}

/**
 * Fold the latest state for each row from the paged library feed. Keep full refs here: Gaana refs
 * cannot be converted to Allegra's Saavn-only profile ids without losing their identity.
 */
export function foldLibraryRows(changes: readonly LibraryChange[]): LibraryRows {
  const likes = new Map<SongRef, LikeChange>();
  const playlists = new Map<string, PlaylistChange>();
  const items = new Map<string, PlaylistItemChange>();

  for (const change of changes) {
    if (change.kind === 'like') {
      if ((likes.get(change.ref)?.rev ?? -1) < change.rev) likes.set(change.ref, change);
    } else if (change.kind === 'playlist') {
      if ((playlists.get(change.playlistId)?.rev ?? -1) < change.rev) playlists.set(change.playlistId, change);
    } else {
      const key = `${change.playlistId}\u0000${change.ref}`;
      if ((items.get(key)?.rev ?? -1) < change.rev) items.set(key, change);
    }
  }

  const itemsByPlaylist = new Map<string, PlaylistItemChange[]>();
  for (const item of items.values()) {
    if (item.deleted) continue;
    const playlistItems = itemsByPlaylist.get(item.playlistId) ?? [];
    playlistItems.push(item);
    itemsByPlaylist.set(item.playlistId, playlistItems);
  }
  for (const playlistItems of itemsByPlaylist.values()) playlistItems.sort((a, b) => a.addedAt - b.addedAt || a.rev - b.rev);

  return {
    likes: [...likes.values()].filter((row) => row.liked).sort((a, b) => b.likedAt - a.likedAt || b.rev - a.rev),
    playlists: [...playlists.values()].filter((row) => !row.deleted).sort((a, b) => a.createdAt - b.createdAt || a.rev - b.rev),
    itemsByPlaylist
  };
}
