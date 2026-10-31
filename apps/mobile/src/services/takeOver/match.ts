/**
 * Play here: finding in LuvLyrics the song another app is playing (Spotify, YouTube Music, YouTube).
 * Pure, so it is tested with real titles instead of a phone.
 *
 * Other apps publish a song as they like: Spotify "Song" by "Artist"; YouTube Music "Song" by "Artist - Topic"
 * or by the channel; YouTube "Artist - Song (Official Video)" on a channel called "ArtistVEVO". `cleanOutside`
 * turns all of them into a title and an artist; `pickTakeOver` keeps a search result only when it is clearly the
 * same recording (same title, same lead artist, same length), so the handover never plays a cover by mistake.
 * A miss is fine: the island opens its search drawer instead.
 */
import type { UnifiedSong } from '../../types/song';
import { streamUrlOf } from '../stream/streamSong';
import { variantsIn } from '../ytmusic/resolver';

export interface OutsideSong {
  title: string;
  artist: string;
}

/** The two lengths of one recording agree within this many seconds (a different upload can start a bit apart). */
export const TAKE_OVER_DURATION_TOLERANCE_S = 4;

/** Words in a bracketed tag that say "this is the video / audio of the song", not a different version. */
const NOISE_TAG =
  /\s*[([]\s*(?:official\b[^)\]]*|(?:lyrics?|lyric\s+video|audio|video|music\s+video|visuali[sz]er|hd|hq|4k|8k|1080p|720p|m\/?v|explicit|clean|with\s+lyrics|full\s+(?:song|video|audio)|video\s+oficial|vídeo\s+oficial)\b[^)\]]*)[)\]]/gi;
/** "Song | Official Video", "Song - Official Audio" and the like at the end. */
const NOISE_TAIL = /\s*[-|–—]\s*(?:official\b.*|lyrics?(?:\s+video)?|(?:music\s+)?video|audio|visuali[sz]er|hd|4k)\s*$/i;
/** "(feat. X)", "[ft. X]" in a title: the credit belongs to the artist line, not the song's name. */
const FEAT_TAG = /\s*[([]\s*(?:feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]/gi;
/** A remaster is the same recording for our purposes. */
const REMASTER_TAG = /\s*[([]\s*(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?\s*[)\]]|\s+-\s+(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?\s*$/gi;
/** After " - " these words mean the dash is a suffix on the title ("Song - Remastered 2011"), not "Artist - Song". */
const TITLE_SUFFIX = /^(?:\d{4}\b|remaster|live\b|radio\b|single\b|album\b|extended\b|original\b|acoustic\b|demo\b|mono\b|stereo\b|edit\b|mix\b|version\b|remix\b|from\b|bonus\b|deluxe\b)/i;
/** A channel name, not a person: stripped to the artist where there is one. */
const CHANNEL_SUFFIX = /\s*-\s*topic$|\s*vevo$/i;
/** Apps whose videos are published by a channel, with the artist in the title ("Artist - Song"). */
const CHANNEL_APPS = new Set([
  'com.google.android.youtube',
  'com.google.android.apps.youtube.music',
  'app.revanced.android.youtube',
  'app.revanced.android.apps.youtube.music',
]);
/** Splits a credit line into its artists. */
const ARTIST_SPLIT = /\s*(?:,|&|\band\b|\bx\b|×|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b|;|\/)\s*/i;

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Letters and digits only, lower case: "AC/DC", "Ac Dc" and "ACDC" meet. */
const key = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

const stripNoise = (title: string): string =>
  squash(title.replace(NOISE_TAG, '').replace(NOISE_TAIL, '').replace(FEAT_TAG, ''));

/** The first artist of a credit line: the one the song is searched and matched by. */
export const leadArtist = (artist: string): string => squash(artist.split(ARTIST_SPLIT)[0] ?? '');

/** Every artist named in a credit line, as match keys. */
const artistKeys = (artist: string): string[] => artist.split(ARTIST_SPLIT).map(key).filter(Boolean);

/** Two names for the same artist: equal, or one holds the other ("Taylor Swift" / "TaylorSwift"). */
const sameArtist = (a: string, b: string): boolean =>
  a.length > 0 && b.length > 0 && (a === b || (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a))));

/**
 * What another app published, made searchable. Strips video tags, "- Topic" and VEVO, and splits
 * "Artist - Title" when the artist is only a channel. Remix, Live, Acoustic and Remastered stay.
 */
export function cleanOutside(raw: { title: string; artist: string; packageName?: string }): OutsideSong {
  const channel = CHANNEL_SUFFIX.test(raw.artist);
  let artist = squash(raw.artist.replace(CHANNEL_SUFFIX, ''));
  let title = stripNoise(raw.title);

  // YouTube titles carry the artist ("Artist - Title") on a channel that is not the artist ("T-Series").
  // A dash followed by "Remastered 2011", "Live", … is a suffix on the title instead. Music apps that publish the
  // real artist (Spotify, Apple Music) keep their dash ("Song - Chromatics Remix") unless the artist repeats in
  // front of it. If a real title is split wrongly the search misses, and the island's search drawer takes over.
  const dash = title.search(/\s[-–—]\s/);
  if (dash > 0) {
    const left = squash(title.slice(0, dash));
    const right = squash(title.slice(dash).replace(/^\s[-–—]\s/, ''));
    const byChannel = channel || !artist || CHANNEL_APPS.has(raw.packageName ?? '') || key(left) === key(artist);
    if (right && byChannel && !TITLE_SUFFIX.test(right)) {
      title = right;
      artist = left;
    }
  }
  return { title, artist };
}

/** What to ask the search for: the title (a remaster tag only narrows the search) and its lead artist. */
export const takeOverQuery = (cleaned: OutsideSong): string =>
  squash(`${cleaned.title.replace(REMASTER_TAG, '')} ${leadArtist(cleaned.artist)}`);

/** A title as compared: no video tags, no featured credit, no remaster tag; Remix and Live stay. */
const titleKey = (title: string): string => key(stripNoise(title).replace(REMASTER_TAG, ''));

/**
 * The search result that is the same recording as [cleaned], or null. Same title and lead artist after
 * normalising; lengths within 4 s when both are known; never a cover, lofi, slowed or other version the
 * original title did not ask for.
 */
export function pickTakeOver(cleaned: OutsideSong, durationS: number, results: readonly UnifiedSong[]): UnifiedSong | null {
  const wantTitle = titleKey(cleaned.title);
  const wantArtist = key(leadArtist(cleaned.artist));
  if (!wantTitle || !wantArtist) return null;
  const asked = new Set(variantsIn(cleaned.title));
  for (const song of results) {
    if (!streamUrlOf(song)) continue;
    if (variantsIn(song.title).some(variant => !asked.has(variant))) continue;
    if (titleKey(song.title) !== wantTitle) continue;
    if (!artistKeys(song.artist).some(have => sameArtist(have, wantArtist))) continue;
    if (durationS > 0 && song.duration && Math.abs(song.duration - durationS) > TAKE_OVER_DURATION_TOLERANCE_S) continue;
    return song;
  }
  return null;
}
