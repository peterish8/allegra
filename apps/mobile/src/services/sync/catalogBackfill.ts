/**
 * Older downloads learn which catalog song they are, and the catalog's cover, a few at a time
 * while the app is idle and online.
 *
 * Two things depend on it for a song on this phone:
 *   - a pick of it while another device plays goes there at once, instead of waiting for a
 *     catalog lookup first (services/connect/pickRouter);
 *   - the cover other devices show for it. A download's own cover is a file on this phone,
 *     which no other device can open; the catalog's https cover is what travels.
 *
 * A song that knows its catalog song needs only the cover: one request covers the whole batch.
 * One that does not is searched by title and lead artist, a moment apart. Whatever the answer, a
 * song is not asked about again for a week. The job ends itself.
 */
import { shareableArtwork } from '@shared/artwork';
import { fromAllegraSong, parseSongRef, type SongRef } from '@shared/songRef';

import * as db from '../../database/syncQueries';
import type { CatalogGap } from '../../database/syncQueries';
import { getAllegraSongs } from '../account/allegraApi';
import { useSongsStore } from '../../store/songsStore';
import { findInCatalog, type CatalogMatch } from './LibrarySync';

export interface CatalogBackfillDeps {
  readonly gaps: (limit: number, checkedBefore: number) => Promise<readonly CatalogGap[]>;
  /** The catalog's covers for songs it knows by ref, or null when it cannot be reached. */
  readonly coversFor: (refs: readonly SongRef[]) => Promise<ReadonlyMap<SongRef, string> | null>;
  readonly search: (title: string, artist: string) => Promise<CatalogMatch | null>;
  readonly setOrigin: (songId: string, ref: SongRef) => Promise<void>;
  readonly setCover: (songId: string, url: string) => Promise<void>;
  readonly markChecked: (songId: string, at: number) => Promise<void>;
  /** Reloads the library, so screens and picks see what was learnt. */
  readonly refresh: () => Promise<void>;
  readonly now: () => number;
  readonly wait: (ms: number) => Promise<void>;
}

export interface BackfillResult {
  readonly checked: number;
  readonly linked: number;
}

const BATCH = 10;
const RETRY_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const SEARCH_GAP_MS = 1_500;

const isWebCover = (uri: string | undefined): boolean => shareableArtwork(uri) !== '';

/** The known catalog song of a row, when it recorded one. */
const knownRef = (gap: CatalogGap): SongRef | null => {
  const parsed = gap.originId ? parseSongRef(gap.originId) : null;
  return parsed ? `${parsed.source}:${parsed.id}` : null;
};

let running = false;

export async function backfillCatalogLinks(deps: CatalogBackfillDeps = defaultDeps()): Promise<BackfillResult> {
  if (running) return { checked: 0, linked: 0 };
  running = true;
  try {
    const startedAt = deps.now();
    const gaps = await deps.gaps(BATCH, startedAt - RETRY_AFTER_MS);
    let checked = 0;
    let linked = 0;

    const known = gaps.flatMap(gap => {
      const ref = knownRef(gap);
      return ref ? [{ gap, ref }] : [];
    });
    if (known.length > 0) {
      const covers = await deps.coversFor(known.map(item => item.ref)).catch(() => null);
      // Out of reach: these stay unchecked and are asked about next time.
      if (covers === null) return { checked, linked };
      for (const { gap, ref } of known) {
        const cover = shareableArtwork(covers.get(ref));
        if (cover && !isWebCover(gap.coverImageUri)) {
          await deps.setCover(gap.id, cover);
          linked++;
        }
        await deps.markChecked(gap.id, startedAt);
        checked++;
      }
    }

    const unknown = gaps.filter(gap => !knownRef(gap));
    for (const gap of unknown) {
      if (checked > 0) await deps.wait(SEARCH_GAP_MS);
      const match = await deps.search(gap.title, gap.artist ?? '').catch(() => null);
      if (match) {
        await deps.setOrigin(gap.id, match.ref);
        if (match.artwork && !isWebCover(gap.coverImageUri)) await deps.setCover(gap.id, match.artwork);
        linked++;
      }
      await deps.markChecked(gap.id, startedAt);
      checked++;
    }

    if (linked > 0) await deps.refresh().catch(() => undefined);
    return { checked, linked };
  } finally {
    running = false;
  }
}

let tokenSource: () => string | null = () => null;

/** Where the account token comes from (the signed-in session); the cover request needs it. */
export function setCatalogBackfillToken(source: () => string | null): void {
  tokenSource = source;
}

function defaultDeps(): CatalogBackfillDeps {
  return {
    gaps: db.songsMissingCatalogLinks,
    coversFor: async refs => {
      const token = tokenSource();
      if (!token) return null;
      const songs = await getAllegraSongs(token, refs);
      if (songs === null) return null;
      const covers = new Map<SongRef, string>();
      for (const song of songs) {
        const ref = fromAllegraSong(song);
        if (ref) covers.set(ref, song.artwork);
      }
      return covers;
    },
    search: findInCatalog,
    setOrigin: db.setOriginId,
    setCover: db.setCoverRemoteUri,
    markChecked: db.markCatalogChecked,
    refresh: () => useSongsStore.getState().fetchSongs(),
    now: () => Date.now(),
    wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
  };
}
