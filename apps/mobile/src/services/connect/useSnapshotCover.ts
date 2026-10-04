/**
 * The cover to draw for a song another device sent (Connect). A sender that had no cover it
 * could share sends '' (an older app, a song whose only cover is a file on that device); '' means
 * "look it up here", not "no cover". In order:
 *
 *   1. the cover that came with the song, when this phone can load it;
 *   2. this phone's own copy of the song: a download draws its own cover file here;
 *   3. the account catalog, by the song's ref;
 *   4. the cover finder (iTunes, then Saavn), by title, artist and length.
 *
 * '' only when none of them has one: the generated cover stands in, as everywhere else.
 * Lookups are shared per song for the life of the app, and a miss is tried again next time.
 */
import { useEffect, useState } from 'react';
import { shareableArtwork } from '@shared/artwork';
import { matchKey, type SongSnapshot } from '@shared/songRef';

import { useSongsStore } from '../../store/songsStore';
import { searchMusic } from '../MultiSourceSearchService';
import { catalogSource, findCover, itunesSource } from '../covers/CoverArtResolver';
import { getAllegraSongById } from './songMatcher';

type SentSong = Pick<SongSnapshot, 'ref' | 'title' | 'artist' | 'artwork' | 'duration'>;

const LOOKUP_LIMIT = 200;
const sources = [itunesSource, catalogSource(query => searchMusic(query))];
const lookups = new Map<string, Promise<string>>();
let tokenSource: () => string | null = () => null;

/** Where the account token comes from (ConnectProvider); the catalog lookup by ref needs it. */
export function setSnapshotCoverToken(source: () => string | null): void {
  tokenSource = source;
}

/** This phone's copy of the song, by the ref it was downloaded as or by title and lead artist. */
function coverOnThisPhone(song: SentSong): string {
  const songs = useSongsStore.getState().songs;
  const own = songs.find(item => item.originId === song.ref)
    ?? (() => {
      const key = matchKey(song.title, song.artist);
      return songs.find(item => matchKey(item.title, item.artist) === key);
    })();
  return own?.coverImageUri || own?.coverRemoteUri || '';
}

async function lookUp(song: SentSong): Promise<string> {
  const token = tokenSource();
  if (token) {
    const row = await getAllegraSongById(song.ref, token).catch(() => null);
    const cover = shareableArtwork(row?.artwork);
    if (cover) return cover;
  }
  const hit = await findCover({ title: song.title, artist: song.artist, duration: song.duration }, sources).catch(() => null);
  return shareableArtwork(hit?.artwork);
}

/** One lookup per song for the life of the app; a miss is forgotten so it is tried again later. */
export function coverForSentSong(song: SentSong): Promise<string> {
  const held = lookups.get(song.ref);
  if (held) return held;
  const lookup = lookUp(song).then(cover => {
    if (!cover && lookups.get(song.ref) === lookup) lookups.delete(song.ref);
    return cover;
  });
  if (lookups.size >= LOOKUP_LIMIT) lookups.delete(lookups.keys().next().value as string);
  lookups.set(song.ref, lookup);
  return lookup;
}

/**
 * The cover to draw for `song`. `lookUp: false` uses only what is already at hand (the sent
 * cover, this phone's copy, an earlier lookup): for long lists, where asking the network about
 * every row would cost more than the covers are worth.
 */
export function useSnapshotCover(song: SentSong | null | undefined, options: { readonly lookUp?: boolean } = {}): string {
  const allowLookup = options.lookUp ?? true;
  const sent = shareableArtwork(song?.artwork);
  const ref = song?.ref;
  const title = song?.title;
  const artist = song?.artist;
  const duration = song?.duration;
  const [found, setFound] = useState<{ readonly ref: string; readonly cover: string } | null>(null);

  useEffect(() => {
    if (!ref || title === undefined || artist === undefined || sent) return undefined;
    const wanted: SentSong = { ref: ref as SongSnapshot['ref'], title, artist, artwork: '', duration: duration ?? 0 };
    const own = coverOnThisPhone(wanted);
    if (own) {
      setFound({ ref, cover: own });
      return undefined;
    }
    if (!allowLookup) return undefined;
    let live = true;
    coverForSentSong(wanted).then(cover => { if (live) setFound({ ref, cover }); }).catch(() => undefined);
    return () => { live = false; };
  }, [ref, title, artist, duration, sent, allowLookup]);

  if (!song) return '';
  if (sent) return sent;
  return found?.ref === song.ref ? found.cover : '';
}
