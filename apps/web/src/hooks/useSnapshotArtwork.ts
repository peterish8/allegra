'use client';

import { useEffect, useMemo, useState } from 'react';

import { shareableArtwork } from '@shared/artwork';
import { fromAllegraSong, parseSongRef, toAllegraId, type SongSnapshot } from '@shared/songRef';

import { fetchArtworkUrls, fetchSongsByIds } from '../lib/api';

/**
 * Covers for songs another device sent (Connect). A sender with no cover it could share sends ''
 * (an older phone, a song whose only cover is a file on that phone): '' means "look it up here",
 * not "no cover". The catalog row for the song's ref comes first, then the artwork search by title
 * and artist. One lookup per song for the life of the page; a miss is tried again later.
 */
const lookups = new Map<string, Promise<string>>();
const LOOKUP_LIMIT = 200;

async function lookUp(song: SongSnapshot): Promise<string> {
  const parsed = parseSongRef(song.ref);
  const catalogId = parsed?.source === 'gaana' ? song.ref : toAllegraId(song.ref);
  if (catalogId) {
    const rows = await fetchSongsByIds([catalogId]).catch(() => []);
    const cover = shareableArtwork(rows.find((row) => fromAllegraSong(row) === song.ref)?.artwork);
    if (cover) return cover;
  }
  if (!song.artist.trim()) return '';
  const urls = await fetchArtworkUrls(song.title, song.artist).catch(() => []);
  return shareableArtwork(...urls);
}

function coverForSentSong(song: SongSnapshot): Promise<string> {
  const held = lookups.get(song.ref);
  if (held) return held;
  const lookup = lookUp(song).then((cover) => {
    if (!cover && lookups.get(song.ref) === lookup) lookups.delete(song.ref);
    return cover;
  });
  if (lookups.size >= LOOKUP_LIMIT) lookups.delete(lookups.keys().next().value as string);
  lookups.set(song.ref, lookup);
  return lookup;
}

/**
 * The cover to show for each song, by ref: the one it came with when any browser can load it,
 * otherwise a looked-up one for the first `lookUpFirst` songs. Songs further down keep '' (the
 * placeholder) until they come up: a long queue is not worth a request per row.
 */
export function useSnapshotArtworks(songs: readonly (SongSnapshot | null | undefined)[], lookUpFirst = 8): ReadonlyMap<string, string> {
  const wanted = useMemo(
    () => songs.filter((song): song is SongSnapshot => Boolean(song)).slice(0, lookUpFirst).filter((song) => !shareableArtwork(song.artwork)),
    [songs, lookUpFirst]
  );
  const wantedKey = wanted.map((song) => song.ref).join('|');
  const [found, setFound] = useState<ReadonlyMap<string, string>>(new Map());

  useEffect(() => {
    if (wanted.length === 0) return undefined;
    let live = true;
    for (const song of wanted) {
      void coverForSentSong(song).then((cover) => {
        if (!live || !cover) return;
        setFound((current) => (current.get(song.ref) === cover ? current : new Map(current).set(song.ref, cover)));
      });
    }
    return () => { live = false; };
    // Keyed on `wantedKey`, which names exactly the songs looked up: the array itself is new on every render.
  }, [wantedKey]);

  return useMemo(() => {
    const covers = new Map<string, string>();
    for (const song of songs) {
      if (!song) continue;
      const own = shareableArtwork(song.artwork);
      const cover = own || found.get(song.ref) || '';
      covers.set(song.ref, cover);
    }
    return covers;
  }, [songs, found]);
}
