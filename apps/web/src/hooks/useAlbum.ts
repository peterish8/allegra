import { useEffect, useState } from 'react';

import type { AlbumDetail } from '@shared/types';

import { fetchAlbum } from '../lib/api';

export interface AlbumState {
  /** The catalog's whole album, once loaded. */
  readonly detail: AlbumDetail | null;
  readonly loading: boolean;
  /** The lookup failed: the page falls back to the songs it already has. */
  readonly failed: boolean;
}

/** Albums already loaded this visit, so going back to one is instant. Small: albums are a few KB. */
const loaded = new Map<string, AlbumDetail>();
const KEEP = 24;

/**
 * The catalog's own album for `albumId` (`GET /api/albums/:id`). Null id (a Gaana song, or a song the
 * catalog gave no album id) means there is nothing to load and the caller groups what it has.
 */
export function useAlbum(albumId: string | null): AlbumState {
  const [state, setState] = useState<AlbumState & { readonly id: string | null }>(() => ({
    id: albumId,
    detail: albumId ? loaded.get(albumId) ?? null : null,
    loading: Boolean(albumId && !loaded.has(albumId)),
    failed: false
  }));

  // A new id: show what is cached at once, or start loading.
  if (state.id !== albumId) {
    setState({ id: albumId, detail: albumId ? loaded.get(albumId) ?? null : null, loading: Boolean(albumId && !loaded.has(albumId)), failed: false });
  }

  useEffect(() => {
    if (!albumId || loaded.has(albumId)) return undefined;
    const controller = new AbortController();
    fetchAlbum(albumId, controller.signal).then((detail) => {
      loaded.set(albumId, detail);
      if (loaded.size > KEEP) loaded.delete(loaded.keys().next().value!);
      setState({ id: albumId, detail, loading: false, failed: false });
    }).catch(() => {
      if (!controller.signal.aborted) setState({ id: albumId, detail: null, loading: false, failed: true });
    });
    return () => controller.abort();
  }, [albumId]);

  return { detail: state.id === albumId ? state.detail : null, loading: state.id === albumId ? state.loading : Boolean(albumId), failed: state.id === albumId && state.failed };
}
