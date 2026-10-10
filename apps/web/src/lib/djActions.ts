/**
 * The DJ's hands. A request that names something to do in the app ("play Kesariya and start karaoke",
 * "play my Gym playlist", "like this", "skip", "open my library") is carried out on the device, at once.
 * Anything else (a mood, a question about the song) is a conversation and goes to the DJ's model as
 * before. Pure: `parseDjAction` only reads text; App performs the action.
 */

export type DjAppPlace = 'home' | 'browse' | 'library' | 'liked' | 'settings' | 'blends';

export type DjAction =
  | { readonly kind: 'play-song'; readonly query: string; readonly karaoke: boolean; readonly lyrics: boolean }
  | { readonly kind: 'play-liked'; readonly shuffle: boolean; readonly karaoke: boolean }
  | { readonly kind: 'play-playlist'; readonly name: string; readonly shuffle: boolean; readonly karaoke: boolean }
  | { readonly kind: 'queue-song'; readonly query: string; readonly next: boolean }
  | { readonly kind: 'like'; readonly on: boolean }
  | { readonly kind: 'transport'; readonly op: 'pause' | 'resume' | 'next' | 'previous' | 'restart' }
  | { readonly kind: 'karaoke'; readonly on: boolean }
  | { readonly kind: 'lyrics' }
  | { readonly kind: 'shuffle'; readonly on: boolean }
  | { readonly kind: 'open'; readonly place: DjAppPlace }
  | { readonly kind: 'now-playing' };

export interface DjActionContext {
  /** The listener's playlist names, so "play Gym" can mean the playlist called Gym. */
  readonly playlistNames: readonly string[];
}

/** What the DJ says after doing it. `ok` false means it could not, and `reply` says why. */
export interface DjActionResult {
  readonly ok: boolean;
  readonly reply: string;
}

/** Words that open a request but carry no meaning of their own. */
const LEAD = /^(?:(?:hey|hi|ok|okay)\s+)?(?:dj[,!]?\s+)?(?:(?:can|could|would|will)\s+you\s+|please\s+|pls\s+|now\s+|just\s+|i\s+want\s+you\s+to\s+|let'?s\s+)*/;
const TAIL = /\s*(?:please|pls|for me|now|thanks|thank you)\s*$/;

/**
 * A "play ..." whose object starts like this is a mood or a set, not a title: "play something calm",
 * "play more like this", "play some Tamil songs". Those belong to the DJ's model.
 */
const NOT_A_TITLE = /^(?:something|some|anything|more|another|other|similar|songs?|music|tracks?|stuff|a\s+(?:song|mix|set|playlist|few)|me\s+(?:something|some|a)|the\s+(?:best|vibe)|happy|sad|chill|calm|upbeat|romantic|party|energetic|slow|fast|old|new|latest|top|hits|my\s+(?:vibe|mood))\b/;
/** Plural or general words anywhere mark a request for a set, not one song. */
const SET_WORDS = /\b(?:songs|tracks|music|vibes?|mix|set|hits|melodies|like this|like that|similar)\b/;

const KARAOKE_TAIL = /(?:,|\s+and|\s+then|\s+with|\s+in)\s+(?:start(?:ing)?\s+|turn\s+on\s+|switch\s+on\s+|begin\s+|do\s+)?(?:the\s+)?karaoke(?:\s+mode)?(?:\s+on)?$/;
const LYRICS_TAIL = /(?:,|\s+and|\s+then|\s+with)\s+(?:show\s+|open\s+)?(?:the\s+)?lyrics$/;
const LIKED = /^(?:my\s+)?(?:liked(?:\s+songs)?|likes|favou?rites?(?:\s+songs)?|loved\s+songs|hearted\s+songs)$/;

const PLACES: readonly (readonly [RegExp, DjAppPlace])[] = [
  [/^home$/, 'home'],
  [/^(?:browse|discover|search)$/, 'browse'],
  [/^(?:my\s+)?(?:library|playlists|music)$/, 'library'],
  [/^(?:my\s+)?(?:liked(?:\s+songs)?|favou?rites|likes)$/, 'liked'],
  [/^settings$/, 'settings'],
  [/^(?:my\s+)?blends?$/, 'blends']
];

const NOW_PLAYING = /^(?:what'?s|what\s+is)\s+(?:this|playing|this\s+song|the\s+song|on)$|^what\s+song\s+is\s+(?:this|playing|on)$|^who\s+(?:sings|sang|is\s+singing)\s+(?:this|it|this\s+song)$|^what\s+am\s+i\s+listening\s+to$/;
const PAUSE = /^(?:pause|stop)(?:\s+(?:it|this|the\s+music|the\s+song|playing|music))?$|^hold\s+on$/;
const RESUME = /^(?:resume|continue|unpause|keep\s+playing|play|play\s+it|carry\s+on)$/;
const NEXT = /^(?:next|skip|play\s+next|skip\s+(?:it|this|this\s+(?:one|song|track)|song)|next\s+(?:song|track|one)|play\s+the\s+next\s+(?:song|one))$/;
const PREVIOUS = /^(?:previous|prev|back|go\s+back|previous\s+(?:song|track)|last\s+song|play\s+the\s+(?:previous|last)\s+(?:song|one))$/;
const RESTART = /^(?:restart|replay|play\s+(?:it|this|this\s+song)\s+again|again|from\s+the\s+(?:top|start|beginning)|start\s+(?:it\s+)?over)$/;
const LIKE = /^(?:like|love|heart|favou?rite|save)(?:\s+(?:it|this|this\s+(?:one|song|track)|the\s+song))?$|^add\s+(?:it|this|this\s+song)\s+to\s+(?:my\s+)?(?:likes|liked\s+songs|favou?rites)$|^i\s+(?:love|like)\s+(?:this|it)(?:\s+song)?$/;
const UNLIKE = /^(?:unlike|unheart|unfavou?rite)(?:\s+(?:it|this|this\s+song))?$|^remove\s+(?:it|this|this\s+song)\s+from\s+(?:my\s+)?(?:likes|liked\s+songs|favou?rites)$/;
const KARAOKE_ON = /^(?:start\s+|turn\s+on\s+|switch\s+on\s+|begin\s+|enable\s+|open\s+)?(?:the\s+)?karaoke(?:\s+mode)?(?:\s+on)?$|^(?:let'?s\s+)?sing(?:\s+along)?$|^sing\s+(?:it|this|this\s+song|along)$/;
const KARAOKE_OFF = /^(?:stop|end|exit|turn\s+off|switch\s+off|disable|close)\s+(?:the\s+)?karaoke(?:\s+mode)?$|^karaoke\s+off$/;
const LYRICS = /^(?:show|open|see)(?:\s+me)?(?:\s+the)?\s+lyrics$|^lyrics$/;
const SHUFFLE_ON = /^(?:shuffle|shuffle\s+on|turn\s+on\s+shuffle)$/;
const SHUFFLE_OFF = /^(?:shuffle\s+off|turn\s+off\s+shuffle|stop\s+shuffl\w*|no\s+shuffle)$/;
const OPEN = /^(?:open|go\s+to|show(?:\s+me)?|take\s+me\s+to)\s+(?:the\s+)?(.+)$/;
const QUEUE = /^(?:queue(?:\s+up)?|add)\s+(.+?)(?:\s+to\s+(?:the\s+|my\s+)?queue)?$/;
const PLAY_NEXT = /^play\s+(.+?)\s+next$/;
const SING = /^(?:sing|karaoke)\s+(.+)$/;
const PLAY = /^(play|shuffle|put\s+on|start\s+playing|i\s+want\s+to\s+hear|let\s+me\s+hear)\s+(.+)$/;

function clean(text: string): string {
  return text
    .toLocaleLowerCase()
    .replace(/[“”"]/g, '')
    .replace(/[.!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(LEAD, '')
    .replace(TAIL, '')
    .trim();
}

/** The original spelling of a stretch the lowercased parse found, so "play Kesariya" searches "Kesariya". */
function original(raw: string, lowered: string): string {
  const at = raw.toLocaleLowerCase().indexOf(lowered);
  return at >= 0 ? raw.slice(at, at + lowered.length).trim() : lowered;
}

const simple = (value: string): string => value.toLocaleLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();

function matchPlaylist(name: string, names: readonly string[]): string | null {
  const wanted = simple(name.replace(/^(?:my|the)\s+/, '').replace(/\s+playlist$/, ''));
  if (!wanted) return null;
  return names.find((item) => simple(item) === wanted) ?? null;
}

export function parseDjAction(raw: string, context: DjActionContext): DjAction | null {
  if (raw.trim().startsWith('/')) return null;
  let text = clean(raw);
  if (!text) return null;

  if (NOW_PLAYING.test(text)) return { kind: 'now-playing' };
  if (PAUSE.test(text)) return { kind: 'transport', op: 'pause' };
  if (RESUME.test(text)) return { kind: 'transport', op: 'resume' };
  if (NEXT.test(text)) return { kind: 'transport', op: 'next' };
  if (PREVIOUS.test(text)) return { kind: 'transport', op: 'previous' };
  if (RESTART.test(text)) return { kind: 'transport', op: 'restart' };
  if (LIKE.test(text)) return { kind: 'like', on: true };
  if (UNLIKE.test(text)) return { kind: 'like', on: false };
  if (KARAOKE_ON.test(text)) return { kind: 'karaoke', on: true };
  if (KARAOKE_OFF.test(text)) return { kind: 'karaoke', on: false };
  if (LYRICS.test(text)) return { kind: 'lyrics' };
  if (SHUFFLE_ON.test(text)) return { kind: 'shuffle', on: true };
  if (SHUFFLE_OFF.test(text)) return { kind: 'shuffle', on: false };

  const open = text.match(OPEN);
  if (open) {
    const target = open[1]!.trim();
    const hit = PLACES.find(([pattern]) => pattern.test(target));
    if (hit) return { kind: 'open', place: hit[1] };
  }

  // Queue: "queue Kesariya", "add Kesariya to the queue", "play Kesariya next".
  const queued = text.match(QUEUE);
  if (queued && (text.startsWith('queue') || /\s+to\s+(?:the\s+|my\s+)?queue$/.test(text))) {
    const query = queued[1]!.trim();
    if (query && !NOT_A_TITLE.test(query) && !SET_WORDS.test(query)) return { kind: 'queue-song', query: original(raw, query), next: false };
  }
  const playNext = text.match(PLAY_NEXT);
  if (playNext && !NOT_A_TITLE.test(playNext[1]!) && !SET_WORDS.test(playNext[1]!)) {
    return { kind: 'queue-song', query: original(raw, playNext[1]!.trim()), next: true };
  }

  // Play something by name, with karaoke or lyrics on the way.
  let karaoke = false;
  let lyrics = false;
  if (KARAOKE_TAIL.test(text)) {
    karaoke = true;
    text = text.replace(KARAOKE_TAIL, '').trim();
  }
  if (LYRICS_TAIL.test(text)) {
    lyrics = true;
    text = text.replace(LYRICS_TAIL, '').trim();
  }
  const sing = text.match(SING);
  if (sing) {
    karaoke = true;
    text = `play ${sing[1]!}`;
  }
  const play = text.match(PLAY);
  if (!play) return null;
  const shuffle = play[1] === 'shuffle';
  const object = play[2]!.trim();

  if (LIKED.test(object)) return { kind: 'play-liked', shuffle, karaoke };
  const named = object.match(/^(?:my\s+|the\s+)?playlist\s+(.+)$/) ?? object.match(/^(?:my\s+|the\s+)?(.+?)\s+playlist$/);
  const playlist = matchPlaylist(named ? named[1]! : object, context.playlistNames);
  if (playlist) return { kind: 'play-playlist', name: playlist, shuffle, karaoke };
  if (named) return { kind: 'play-playlist', name: original(raw, named[1]!.trim()), shuffle, karaoke };

  if (shuffle || NOT_A_TITLE.test(object) || SET_WORDS.test(object)) return null;
  const query = object.replace(/\s+(?:song|track)$/, '').trim();
  if (query.length < 2) return null;
  return { kind: 'play-song', query: original(raw, query), karaoke, lyrics };
}
