/**
 * @fileoverview "Continue here": finding in LuvLyrics the song another app is playing (Spotify, YouTube Music,
 * YouTube).
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

/** What another app's media session says it plays, as `cleanOutside` reads it. */
export interface OutsideListing {
  title: string;
  artist: string;
  /** The app that plays it; its videos may be credited to a channel rather than the artist. */
  packageName?: string;
}

function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Letters and digits only, lower case: "AC/DC", "Ac Dc" and "ACDC" meet. */
function key(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function stripNoise(title: string): string {
  return squash(title.replace(NOISE_TAG, '').replace(NOISE_TAIL, '').replace(FEAT_TAG, ''));
}

/** The first artist of a credit line: the one the song is searched and matched by. */
export function leadArtist(artist: string): string {
  return squash(artist.split(ARTIST_SPLIT)[0] ?? '');
}

/** Every artist named in a credit line, as match keys. */
function artistKeys(artist: string): string[] {
  return artist.split(ARTIST_SPLIT).map(key).filter(Boolean);
}

/** Two names for the same artist: equal, or one holds the other ("Taylor Swift" / "TaylorSwift"). */
function sameArtist(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0) {
    return false;
  }
  return a === b || (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a)));
}

/**
 * What another app published, made searchable. Strips video tags, "- Topic" and VEVO, and splits
 * "Artist - Title" when the artist is only a channel. Remix, Live, Acoustic and Remastered stay.
 */
export function cleanOutside(raw: OutsideListing): OutsideSong {
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
export function takeOverQuery(cleaned: OutsideSong): string {
  return squash(`${cleaned.title.replace(REMASTER_TAG, '')} ${leadArtist(cleaned.artist)}`);
}

/** A title as compared: no video tags, no featured credit, no remaster tag; Remix and Live stay. */
function titleKey(title: string): string {
  return key(stripNoise(title).replace(REMASTER_TAG, ''));
}

/** The recording `pickTakeOver` looks for, as match keys. */
interface WantedRecording {
  title: string;
  artist: string;
  /** Versions the original title names (Remix, Live, …); a result may name no others. */
  variants: ReadonlySet<string>;
  /** 0 when the other app gave no length. */
  durationS: number;
}

/** Whether [song] is the same recording as the one asked for. */
function isSameRecording(song: UnifiedSong, wanted: WantedRecording): boolean {
  if (!streamUrlOf(song) || titleKey(song.title) !== wanted.title) {
    return false;
  }
  if (variantsIn(song.title).some(variant => !wanted.variants.has(variant))) {
    return false;
  }
  if (!artistKeys(song.artist).some(have => sameArtist(have, wanted.artist))) {
    return false;
  }
  const lengthsKnown = wanted.durationS > 0 && song.duration !== undefined && song.duration > 0;
  return !lengthsKnown || Math.abs((song.duration ?? 0) - wanted.durationS) <= TAKE_OVER_DURATION_TOLERANCE_S;
}

/**
 * The search result that is the same recording as [cleaned], or null. Same title and lead artist after
 * normalising; lengths within 4 s when both are known; never a cover, lofi, slowed or other version the
 * original title did not ask for.
 */
export function pickTakeOver(cleaned: OutsideSong, durationS: number, results: readonly UnifiedSong[]): UnifiedSong | null {
  const wanted: WantedRecording = {
    title: titleKey(cleaned.title),
    artist: key(leadArtist(cleaned.artist)),
    variants: new Set(variantsIn(cleaned.title)),
    durationS,
  };
  if (!wanted.title || !wanted.artist) {
    return null;
  }
  return results.find(song => isSameRecording(song, wanted)) ?? null;
}
