import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuthToken } from '@convex-dev/auth/react';

import type { LibraryChange, LibraryOp } from '@shared/library';
import { fromAllegraSong, toAllegraId, type SongRef, type SongSnapshot } from '@shared/songRef';
import type { UnifiedSong } from '@shared/types';

import {
  applyLibraryOps,
  createLibrary,
  deleteLibrary,
  fetchLibraries,
  fetchLibraryChanges,
  fetchLikedSongs,
  fetchSongsByIds,
  uploadLibraryCover
} from '../lib/api';
import type { LibraryRecord } from '../lib/api';
import { createLibrarySong, foldLibraryRows, type LibrarySong } from '../lib/libraryRows';
import { accountIdFromToken } from '../lib/connectDeviceId';

export interface PlaylistsApi {
  readonly playlists: readonly LibraryRecord[];
  /** Current songs keyed by their visible Allegra id, including snapshot-backed phone songs. */
  readonly songs: ReadonlyMap<string, LibrarySong>;
  readonly playlistRefs: ReadonlyMap<string, readonly SongRef[]>;
  readonly likedSongs: readonly LibrarySong[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly actionError: string | null;
  readonly reload: () => Promise<readonly LibrarySong[]>;
  readonly contains: (libraryId: string, song: UnifiedSong) => boolean;
  readonly create: (name: string) => Promise<LibraryRecord | null>;
  readonly addSongs: (libraryId: string, songs: readonly UnifiedSong[]) => Promise<boolean>;
  readonly remove: (libraryId: string) => Promise<boolean>;
  /** Adds the song if it is absent from the playlist, removes it otherwise. */
  readonly toggleSong: (libraryId: string, song: UnifiedSong) => Promise<void>;
  readonly setCover: (libraryId: string, file: File, onProgress?: (ratio: number) => void) => Promise<LibraryRecord | null>;
}

export const PlaylistsContext = createContext<PlaylistsApi | null>(null);

export function usePlaylistsContext(): PlaylistsApi {
  const value = useContext(PlaylistsContext);
  if (!value) throw new Error('usePlaylistsContext needs a PlaylistsContext provider.');
  return value;
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function visibleId(ref: SongRef): string {
  return toAllegraId(ref) ?? `library:${ref}`;
}

function snapshotOf(song: UnifiedSong, ref: SongRef): SongSnapshot {
  const librarySong = song as LibrarySong;
  return librarySong.librarySnapshot ?? {
    ref,
    title: song.title,
    artist: song.artist,
    ...(song.album ? { album: song.album } : {}),
    artwork: song.artwork,
    duration: song.duration
  };
}

function refOf(song: UnifiedSong): SongRef | null {
  const librarySong = song as LibrarySong;
  return librarySong.libraryRef ?? fromAllegraSong(song);
}

function latestByRef(changes: readonly LibraryChange[], kind: 'like' | 'playlist_item'): Map<SongRef, Extract<LibraryChange, { kind: 'like' | 'playlist_item' }>> {
  const latest = new Map<SongRef, Extract<LibraryChange, { kind: 'like' | 'playlist_item' }>>();
  for (const change of changes) {
    if (change.kind !== kind) continue;
    const prior = latest.get(change.ref);
    if (!prior || prior.rev < change.rev) latest.set(change.ref, change);
  }
  return latest;
}

export function usePlaylists(): PlaylistsApi {
  const authToken = useAuthToken();
  const accountId = accountIdFromToken(authToken) ?? 'guest';
  const [playlists, setPlaylists] = useState<LibraryRecord[]>([]);
  const [songs, setSongs] = useState<ReadonlyMap<string, LibrarySong>>(new Map());
  const [playlistRefs, setPlaylistRefs] = useState<ReadonlyMap<string, readonly SongRef[]>>(new Map());
  const [likedSongs, setLikedSongs] = useState<readonly LibrarySong[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const playlistsRef = useRef<LibraryRecord[]>([]);
  const songsRef = useRef<ReadonlyMap<string, LibrarySong>>(new Map());
  const playlistRefsRef = useRef<ReadonlyMap<string, readonly SongRef[]>>(new Map());
  const likedSongsRef = useRef<readonly LibrarySong[]>([]);
  const libraryCursorRef = useRef(0);
  const libraryChangesRef = useRef(new Map<string, LibraryChange>());
  const legacyPlaylistsRef = useRef<LibraryRecord[]>([]);
  const legacyLikesRef = useRef<UnifiedSong[]>([]);
  const libraryLoadedRef = useRef(false);
  const accountIdRef = useRef(accountId);

  useEffect(() => {
    if (accountIdRef.current === accountId) return;
    accountIdRef.current = accountId;
    libraryCursorRef.current = 0;
    libraryChangesRef.current.clear();
    legacyPlaylistsRef.current = [];
    legacyLikesRef.current = [];
    libraryLoadedRef.current = false;
    playlistsRef.current = [];
    songsRef.current = new Map();
    playlistRefsRef.current = new Map();
    likedSongsRef.current = [];
    setPlaylists([]);
    setSongs(new Map());
    setPlaylistRefs(new Map());
    setLikedSongs([]);
  }, [accountId]);

  // The cursor moves only in `reload`, after the changes up to it are in `libraryChangesRef`. It once
  // also jumped past this tab's own writes (likes, playlist edits) without recording them, so the next
  // reload rebuilt the library without them: a like flipped back to unliked a moment later
  // (2026-10-11, tests/e2e/player.spec.ts). Re-reading our own few changes is the price of being right.

  const commit = useCallback((next: LibraryRecord[]): void => {
    playlistsRef.current = next;
    setPlaylists(next);
  }, []);

  const commitSongs = useCallback((next: ReadonlyMap<string, LibrarySong>): void => {
    songsRef.current = next;
    setSongs(next);
  }, []);

  const commitRefs = useCallback((next: ReadonlyMap<string, readonly SongRef[]>): void => {
    playlistRefsRef.current = next;
    setPlaylistRefs(next);
  }, []);

  const commitLikes = useCallback((next: readonly LibrarySong[]): void => {
    likedSongsRef.current = next;
    setLikedSongs(next);
  }, []);

  const reload = useCallback(async (): Promise<readonly LibrarySong[]> => {
    setLoading(true);
    setError(null);
    try {
      const initial = !libraryLoadedRef.current;
      const [legacyPlaylists, page, legacyLikes] = await Promise.all([
        initial ? fetchLibraries() : Promise.resolve(legacyPlaylistsRef.current),
        fetchLibraryChanges(initial ? 0 : libraryCursorRef.current),
        initial ? fetchLikedSongs() : Promise.resolve(legacyLikesRef.current)
      ]);
      if (initial) {
        legacyPlaylistsRef.current = legacyPlaylists;
        legacyLikesRef.current = legacyLikes;
      }
      for (const change of page.changes) {
        const key = change.kind === 'like' ? `like:${change.ref}`
          : change.kind === 'playlist' ? `playlist:${change.playlistId}`
            : `playlist_item:${change.playlistId}:${change.ref}`;
        const prior = libraryChangesRef.current.get(key);
        if (!prior || prior.rev < change.rev) libraryChangesRef.current.set(key, change);
      }
      const changes = [...libraryChangesRef.current.values()].sort((a, b) => a.rev - b.rev);
      const rows = foldLibraryRows(changes);
      const playlistState = new Map<string, Extract<LibraryChange, { kind: 'playlist' }>>();
      for (const change of changes) {
        if (change.kind !== 'playlist') continue;
        const prior = playlistState.get(change.playlistId);
        if (!prior || prior.rev < change.rev) playlistState.set(change.playlistId, change);
      }
      const snapshots = new Map<SongRef, SongSnapshot>();
      for (const row of rows.likes) if (row.song) snapshots.set(row.ref, row.song);
      for (const list of rows.itemsByPlaylist.values()) {
        for (const row of list) if (row.song) snapshots.set(row.ref, row.song);
      }

      const legacyByRef = new Map<SongRef, UnifiedSong>();
      for (const song of legacyLikes) {
        const ref = fromAllegraSong(song);
        if (!ref) continue;
        legacyByRef.set(ref, song);
        if (!snapshots.has(ref)) snapshots.set(ref, snapshotOf(song, ref));
      }
      const refs = [...new Set([
        ...rows.likes.map((row) => row.ref),
        ...[...rows.itemsByPlaylist.values()].flatMap((items) => items.map((item) => item.ref)),
        ...legacyByRef.keys()
      ])];
      const missingSaavn = refs
        .filter((ref) => !legacyByRef.has(ref) && !snapshots.has(ref) && ref.startsWith('saavn:'))
        .map((ref) => ref.slice('saavn:'.length));
      const hydrated = missingSaavn.length > 0 ? await fetchSongsByIds(missingSaavn) : [];
      const hydratedByRef = new Map<SongRef, UnifiedSong>();
      for (const song of hydrated) {
        const ref = fromAllegraSong(song);
        if (ref) {
          hydratedByRef.set(ref, song);
          if (!snapshots.has(ref)) snapshots.set(ref, snapshotOf(song, ref));
        }
      }

      const songMap = new Map<string, LibrarySong>();
      for (const ref of refs) {
        const row = createLibrarySong(ref, snapshots.get(ref), legacyByRef.get(ref) ?? hydratedByRef.get(ref));
        if (row) songMap.set(visibleId(ref), row);
      }
      commitSongs(songMap);

      const refMap = new Map<string, readonly SongRef[]>();
      const legacyMetadata = new Map(legacyPlaylists.map((playlist) => [playlist.id, playlist]));
      const playlistRows = rows.playlists.map((row): LibraryRecord => {
        const legacy = legacyMetadata.get(row.playlistId);
        const itemRefs = (rows.itemsByPlaylist.get(row.playlistId) ?? []).map((item) => item.ref);
        refMap.set(row.playlistId, itemRefs);
        return {
          id: row.playlistId,
          name: row.name,
          ...(row.description ? { description: row.description } : {}),
          isPublic: row.isPublic,
          songIds: itemRefs.map(visibleId),
          createdAt: new Date(row.createdAt).toISOString(),
          ...(row.coverUrl ? { coverUrl: row.coverUrl } : legacy?.coverUrl ? { coverUrl: legacy.coverUrl } : {}),
          ...(legacy?.coverKey ? { coverKey: legacy.coverKey } : {})
        };
      });
      // Keep a profile row while an older account is being lazily migrated.
      for (const legacy of legacyPlaylists) {
        if (playlistState.get(legacy.id)?.deleted) continue;
        if (refMap.has(legacy.id)) continue;
        const legacyRefs = legacy.songIds.flatMap((id) => {
          const ref = fromAllegraSong({ id, source: 'Saavn' });
          return ref ? [ref] : [];
        });
        refMap.set(legacy.id, legacyRefs);
        playlistRows.push(legacy);
      }
      commitRefs(refMap);
      commit(playlistRows);

      const likeState = latestByRef(changes, 'like') as Map<SongRef, Extract<LibraryChange, { kind: 'like' }>>;
      const likedRefs = new Set<SongRef>([...legacyByRef.keys()]);
      for (const [ref, row] of likeState) {
        if (row.liked) likedRefs.add(ref);
        else likedRefs.delete(ref);
      }
      const nextLikes = [...likedRefs]
        .map((ref) => songMap.get(visibleId(ref)))
        .filter((song): song is LibrarySong => song !== undefined)
        .sort((a, b) => {
          const at = likeState.get(a.libraryRef)?.likedAt ?? 0;
          const bt = likeState.get(b.libraryRef)?.likedAt ?? 0;
          return bt - at;
        });
      commitLikes(nextLikes);
      libraryCursorRef.current = page.rev;
      libraryLoadedRef.current = true;
      return nextLikes;
    } catch (caught) {
      setError(messageOf(caught, 'Your playlists could not be loaded.'));
      return likedSongsRef.current;
    } finally {
      setLoading(false);
    }
  }, [commit, commitLikes, commitRefs, commitSongs]);

  const contains = useCallback((libraryId: string, song: UnifiedSong): boolean => {
    const ref = refOf(song);
    return ref ? (playlistRefsRef.current.get(libraryId) ?? []).includes(ref) : false;
  }, []);

  const create = useCallback(async (name: string): Promise<LibraryRecord | null> => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    setActionError(null);
    try {
      const library = await createLibrary(trimmed);
      const next = [...playlistsRef.current, library];
      commit(next);
      commitRefs(new Map(playlistRefsRef.current).set(library.id, []));
      return library;
    } catch (caught) {
      setActionError(messageOf(caught, 'That playlist could not be created.'));
      return null;
    }
  }, [commit, commitRefs]);

  const remove = useCallback(async (libraryId: string): Promise<boolean> => {
    const before = playlistsRef.current;
    setActionError(null);
    commit(before.filter((library) => library.id !== libraryId));
    try {
      await deleteLibrary(libraryId);
      const nextRefs = new Map(playlistRefsRef.current);
      nextRefs.delete(libraryId);
      commitRefs(nextRefs);
      return true;
    } catch (caught) {
      commit(before);
      setActionError(messageOf(caught, 'That playlist could not be deleted.'));
      return false;
    }
  }, [commit, commitRefs]);

  const toggleSong = useCallback(async (libraryId: string, song: UnifiedSong): Promise<void> => {
    const before = playlistsRef.current;
    const current = before.find((library) => library.id === libraryId);
    const ref = refOf(song);
    if (!current || !ref) return;
    const currentRefs = playlistRefsRef.current.get(libraryId) ?? [];
    const has = currentRefs.includes(ref);
    const at = Date.now();
    const op: LibraryOp = has
      ? { op: 'playlist_remove', playlistId: libraryId, ref, at }
      : { op: 'playlist_add', playlistId: libraryId, ref, song: snapshotOf(song, ref), at };
    setActionError(null);
    const nextRefs = has ? currentRefs.filter((item) => item !== ref) : [...currentRefs, ref];
    const ids = nextRefs.map(visibleId);
    commit(before.map((library) => library.id === libraryId ? { ...library, songIds: ids } : library));
    commitRefs(new Map(playlistRefsRef.current).set(libraryId, nextRefs));
    const storedSong = { ...song, libraryRef: ref, librarySnapshot: snapshotOf(song, ref) } as LibrarySong;
    commitSongs(new Map(songsRef.current).set(visibleId(ref), storedSong));
    try {
      const result = await applyLibraryOps([op]);
      if (result.rejected.length > 0) throw new Error('That change could not be synced. Try again.');
    } catch (caught) {
      commit(before);
      commitRefs(new Map(playlistRefsRef.current).set(libraryId, currentRefs));
      setActionError(messageOf(caught, 'That change could not be saved.'));
    }
  }, [commit, commitRefs, commitSongs]);

  const addSongs = useCallback(async (libraryId: string, tracks: readonly UnifiedSong[]): Promise<boolean> => {
    const before = playlistsRef.current;
    const current = before.find((library) => library.id === libraryId);
    if (!current) return false;
    const currentRefs = playlistRefsRef.current.get(libraryId) ?? [];
    const existing = new Set(currentRefs);
    const unique = new Map<SongRef, { readonly song: UnifiedSong; readonly snapshot: SongSnapshot }>();
    for (const song of tracks) {
      const ref = refOf(song);
      if (!ref || existing.has(ref) || unique.has(ref)) continue;
      unique.set(ref, { song, snapshot: snapshotOf(song, ref) });
    }
    if (unique.size === 0) return true;

    const at = Date.now();
    const additions = [...unique.entries()];
    const ops: LibraryOp[] = additions.map(([ref, { snapshot }]) => ({
      op: 'playlist_add', playlistId: libraryId, ref, song: snapshot, at
    }));
    const nextRefs = [...currentRefs, ...additions.map(([ref]) => ref)];
    const nextIds = nextRefs.map(visibleId);
    commit(before.map((library) => library.id === libraryId ? { ...library, songIds: nextIds } : library));
    commitRefs(new Map(playlistRefsRef.current).set(libraryId, nextRefs));
    const originalSongs = songsRef.current;
    const nextSongs = new Map(originalSongs);
    for (const [ref, { song, snapshot }] of additions) {
      nextSongs.set(visibleId(ref), { ...song, libraryRef: ref, librarySnapshot: snapshot } as LibrarySong);
    }
    commitSongs(nextSongs);

    setActionError(null);
    try {
      const result = await applyLibraryOps(ops);
      if (result.rejected.length > 0 || result.applied !== ops.length) throw new Error('Some songs could not be saved. Try again.');
      return true;
    } catch (caught) {
      commit(before);
      commitRefs(new Map(playlistRefsRef.current).set(libraryId, currentRefs));
      const rollbackSongs = new Map(songsRef.current);
      for (const [ref] of additions) {
        const id = visibleId(ref);
        const previous = originalSongs.get(id);
        if (previous) rollbackSongs.set(id, previous);
        else rollbackSongs.delete(id);
      }
      commitSongs(rollbackSongs);
      setActionError(messageOf(caught, 'Those songs could not be saved.'));
      return false;
    }
  }, [commit, commitRefs, commitSongs]);

  const setCover = useCallback(async (libraryId: string, file: File, onProgress?: (ratio: number) => void): Promise<LibraryRecord | null> => {
    setActionError(null);
    try {
      const saved = await uploadLibraryCover(libraryId, file, onProgress);
      commit(playlistsRef.current.map((library) => (library.id === saved.id ? { ...library, ...saved } : library)));
      return saved;
    } catch (caught) {
      setActionError(messageOf(caught, 'That cover could not be saved.'));
      return null;
    }
  }, [commit]);

  return { playlists, songs, playlistRefs, likedSongs, loading, error, actionError, reload, contains, create, addSongs, remove, toggleSong, setCover };
}
