import type { DjGoal, DjLocalIntent, DjSessionState, DjTrackContext } from './dj.js';
import type { UnifiedSong } from './types.js';

export interface DjLocalCandidate {
  readonly song: UnifiedSong;
  readonly queryIndex: number;
}

export interface DjLocalPick {
  readonly song: UnifiedSong;
  readonly reason: string;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function bounded(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max
    ? value.trim()
    : null;
}

function strings(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, maxItems).flatMap((item) => {
    const text = bounded(item, maxLength);
    return text ? [text] : [];
  }))];
}

export interface DjLocalIntentContext {
  readonly goal: DjGoal;
  readonly message: string;
  readonly session: DjSessionState;
  readonly current: DjTrackContext | null;
  readonly draft: readonly DjLocalPick[];
  readonly draftName: string;
}

const LANGUAGES = ['tamil', 'hindi', 'telugu', 'malayalam', 'kannada', 'punjabi', 'bengali', 'marathi', 'english', 'korean', 'japanese', 'spanish', 'french'];

function clean(output: string): string {
  return output
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/i, '')
    .replace(/```(?:json)?/gi, '')
    .trim();
}

/** The first parseable top-level `{…}` block; small models wrap, repeat or trail-comma their JSON. */
function firstJsonObject(text: string): Record<string, unknown> | null {
  for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    for (let i = start; i < text.length; i += 1) {
      const char = text[i];
      if (inString) {
        if (char === '\\') i += 1;
        else if (char === '"') inString = false;
      } else if (char === '"') inString = true;
      else if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          const block = text.slice(start, i + 1);
          for (const candidate of [block, block.replace(/,\s*([}\]])/g, '$1')]) {
            try {
              const value = record(JSON.parse(candidate));
              if (Object.keys(value).length > 0) return value;
            } catch { /* try the repaired copy, then the next block */ }
          }
          break;
        }
      }
    }
  }
  return null;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function pick<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  const lowered = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return allowed.find((item) => item === lowered) ?? null;
}

/** The message with one word taken out, so a language named in the request is searched as a language, not as title text. */
function withoutWord(message: string, word: string | null): string {
  if (!word) return message;
  return message.replace(new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), ' ');
}

/**
 * Add the language to the searches as its own query, shaped by the energy of the set, so the
 * catalog is asked for that language even when the model's queries never named it. A turn that
 * searches for nothing (removals, questions) is left alone.
 */
function withLanguageQuery(queries: readonly string[], language: string | null, energy: number): string[] {
  const name = language?.trim().toLowerCase();
  if (!name || queries.length === 0) return queries.slice(0, 4);
  const query = `${name} ${energy <= 2 ? 'melodies' : energy >= 4 ? 'hits' : 'songs'}`;
  if (queries.some((item) => item.trim().toLowerCase() === query)) return queries.slice(0, 4);
  return [...queries.slice(0, 3), query];
}

/** What the request itself says, with no model involved. It is also the floor when the model's output is unusable. */
export function heuristicDjLocalIntent(context: DjLocalIntentContext): DjLocalIntent {
  const message = context.message.replace(/^\/[a-z-]+\s*/i, '').trim() || context.message.trim();
  const lower = message.toLowerCase();
  const { goal, session, current, draft } = context;

  const explainOnly = /^(why|what|who|how|explain|tell me)\b/.test(lower) && !/\b(play|add|find|more|queue)\b/.test(lower);
  const similar = /\b(like this|similar|more like|something like)\b/.test(lower);
  const insertMatch = lower.match(/\bafter\s+(\d)\b/);
  const language = LANGUAGES.find((name) => lower.includes(name)) ?? null;
  const noMatch = lower.match(/\bno\s+([\p{L}-]+)\s+(?:songs?|music|tracks?)\b/u);

  const energyStep = /\b(more energy|energetic|upbeat|hype|party|workout|faster|pump)/.test(lower) ? 1
    : /\b(calm|chill|soft|slow|sleep|late night|relax|easygoing|mellow|quiet)/.test(lower) ? -1 : 0;
  const energy = Math.max(1, Math.min(5, (Number.isInteger(session.energy) ? session.energy : 3) + energyStep));

  const clearsLanguage = /\b(any language|all languages)\b/.test(lower);
  const finalLanguage = language ?? (clearsLanguage ? null : session.language);
  const topic = withoutWord(message.replace(/\b(please|play|give me|make me|can you|could you|i want|some)\b/gi, ' '), language)
    .replace(/\s+/g, ' ').trim().slice(0, 120);
  const queries: string[] = [];
  if (!explainOnly) {
    if (similar && current) queries.push(`${current.title} ${current.artist}`, current.artist);
    if (topic) {
      const keepsLanguage = Boolean(language) || !session.language || lower.includes(session.language.toLowerCase());
      queries.push(keepsLanguage ? topic : `${session.language} ${topic}`);
    }
    if (queries.length === 0 && session.vibe) queries.push(session.vibe);
  }

  const fresh = /\b(new|fresh|start over|replace|from scratch|different)\b/.test(lower);
  const vibe = (topic || session.vibe || 'Easygoing').slice(0, 100);
  return {
    reply: explainOnly ? 'Tell me a direction and I will look for songs.' : `Looking for “${vibe}” in the catalog.`.slice(0, 240),
    vibe,
    energy,
    operation: goal === 'playlist' || explainOnly ? 'keep' : insertMatch ? 'insert' : 'replace_upcoming',
    insertAfter: goal === 'mix' && insertMatch ? Number(insertMatch[1]) : null,
    languageAction: language ? 'set' : /\b(any language|all languages)\b/.test(lower) ? 'clear' : 'keep',
    language,
    addConstraints: noMatch?.[1] ? [`no ${noMatch[1]} songs`] : [],
    removeConstraints: [],
    searchQueries: withLanguageQuery([...new Set(queries)], finalLanguage, energy),
    strategy: goal === 'playlist' && draft.length > 0 && !fresh ? 'extend' : 'replace',
    removeTrackIds: [],
    playlistName: null,
    reaction: 'curious'
  };
}

/**
 * Turn whatever the small local model wrote into a valid intent. Any field it got wrong or left
 * out is taken from the request itself, so a sloppy answer never becomes an error.
 */
export function resolveDjLocalIntent(output: string, context: DjLocalIntentContext): DjLocalIntent {
  const base = heuristicDjLocalIntent(context);
  const raw = firstJsonObject(clean(output));
  if (!raw) return base;

  const energyValue = typeof raw.energy === 'string' ? Number(raw.energy) : raw.energy;
  const energy = typeof energyValue === 'number' && Number.isFinite(energyValue)
    ? Math.max(1, Math.min(5, Math.round(energyValue))) : base.energy;
  const requestedAction = pick(raw.languageAction, ['keep', 'set', 'clear'] as const) ?? base.languageAction;
  const language = requestedAction === 'set' ? text(raw.language, 40) ?? base.language : null;
  const languageAction = requestedAction === 'set' && !language ? 'keep' : requestedAction;

  const finalLanguage = languageAction === 'set' ? language
    : languageAction === 'clear' ? null
      : context.session.language;

  const insertValue = typeof raw.insertAfter === 'string' ? Number(raw.insertAfter) : raw.insertAfter;
  const insertAfter = typeof insertValue === 'number' && Number.isInteger(insertValue) && insertValue >= 0 && insertValue <= 7
    ? insertValue : null;
  const modelOperation = pick(raw.operation, ['replace_upcoming', 'insert', 'keep'] as const);
  const operation = modelOperation === 'insert' && insertAfter === null ? 'replace_upcoming' : modelOperation ?? base.operation;

  const draftIds = new Set(context.draft.map(({ song }) => song.id));
  const removeTrackIds = strings(raw.removeTrackIds, 30, 200).filter((id) => draftIds.has(id));
  const modelQueries = strings(raw.searchQueries, 4, 140);
  const needsSongs = removeTrackIds.length === 0;

  return {
    reply: text(raw.reply, 240) ?? base.reply,
    vibe: text(raw.vibe, 100) ?? base.vibe,
    energy,
    operation,
    insertAfter: operation === 'insert' ? insertAfter : null,
    languageAction,
    language,
    addConstraints: strings(raw.addConstraints, 8, 100),
    removeConstraints: strings(raw.removeConstraints, 8, 100),
    searchQueries: modelQueries.length > 0
      ? withLanguageQuery(modelQueries, finalLanguage, energy)
      : needsSongs ? base.searchQueries : [],
    strategy: pick(raw.strategy, ['replace', 'extend'] as const) ?? base.strategy,
    removeTrackIds,
    playlistName: text(raw.playlistName, 100),
    reaction: pick(raw.reaction, ['neutral', 'curious', 'excited', 'dreamy', 'confused'] as const) ?? base.reaction
  };
}

export function applyDjLocalSession(intent: DjLocalIntent, old: DjSessionState): DjSessionState {
  const removed = new Set(intent.removeConstraints.map((item) => item.toLocaleLowerCase()));
  return {
    vibe: intent.vibe,
    energy: intent.energy,
    language: intent.languageAction === 'set' ? intent.language
      : intent.languageAction === 'clear' ? null
        : old.language,
    constraints: [...new Set([
      ...old.constraints.filter((item) => !removed.has(item.toLocaleLowerCase())),
      ...intent.addConstraints
    ])].slice(0, 8)
  };
}

function normalized(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function artistKey(song: DjTrackContext): string {
  return normalized(song.artist.split(/[,/&]/)[0] ?? song.artist);
}

function containsArtist(songs: readonly DjTrackContext[], key: string): boolean {
  return Boolean(key) && songs.some((song) => artistKey(song) === key);
}

/** +4 when a word of the request is a word of the artist's name: the listener asked for them. */
function artistQueryScore(song: UnifiedSong, queries: readonly string[]): number {
  const names = new Set(normalized(song.artist).split(' '));
  const terms = queries.flatMap((query) => normalized(query).split(' ')).filter((term) => term.length > 2);
  return terms.some((term) => names.has(term)) ? 4 : 0;
}

/**
 * A title that merely repeats two or more consecutive words of the request ("Late Night" for
 * "late night tamil melodies"), written spaced or run together. Such a song matched the words,
 * not the mood the words describe.
 */
function titleEchoesQuery(song: UnifiedSong, queries: readonly string[]): boolean {
  const title = ` ${normalized(song.title)} `;
  return queries.some((query) => {
    const words = normalized(query).split(' ').filter(Boolean);
    return words.slice(1).some((word, index) => {
      const first = words[index] ?? '';
      return (first.length > 3 || word.length > 3)
        && (title.includes(` ${first} ${word} `) || title.includes(` ${first}${word} `));
    });
  });
}

function displayArtist(song: UnifiedSong): string {
  return (song.artist.split(/[,/&]/)[0] ?? song.artist).trim() || song.artist;
}

function capitalized(value: string): string {
  return value.charAt(0).toLocaleUpperCase() + value.slice(1);
}

function songContext(song: UnifiedSong): DjTrackContext {
  return { id: song.id, title: song.title, artist: song.artist, ...(song.language ? { language: song.language } : {}) };
}

/** Rank catalog search results with bounded, explainable taste signals; never invent a track. */
export function rankDjLocalCandidates(options: {
  readonly candidates: readonly DjLocalCandidate[];
  readonly queries: readonly string[];
  readonly goal: DjGoal;
  readonly songLimit: number;
  readonly language: string | null;
  readonly current: DjTrackContext | null;
  readonly recent: readonly DjTrackContext[];
  readonly liked: readonly DjTrackContext[];
  readonly skipped: readonly DjTrackContext[];
  readonly draft: readonly DjLocalPick[];
  readonly strategy: DjLocalIntent['strategy'];
  readonly removeTrackIds: readonly string[];
}): DjLocalPick[] {
  const cap = Math.max(1, Math.min(options.songLimit, options.goal === 'mix' ? 8 : 30));
  const removed = new Set(options.removeTrackIds);
  const existing = options.goal === 'playlist' && options.strategy === 'extend'
    ? options.draft.filter(({ song }) => !removed.has(song.id))
    : [];
  const usedIds = new Set(existing.map(({ song }) => song.id));
  const usedNames = new Set(existing.map(({ song }) => normalized(`${song.title} ${song.artist}`)));
  const excludedIds = new Set(options.skipped.map(({ id }) => id));
  if (options.goal === 'mix' && options.current) excludedIds.add(options.current.id);

  const byId = new Map<string, DjLocalCandidate>();
  for (const item of options.candidates) {
    const prior = byId.get(item.song.id);
    if (!prior || item.queryIndex < prior.queryIndex) byId.set(item.song.id, item);
  }

  const ranked = [...byId.values()].flatMap((item) => {
    const { song } = item;
    const nameKey = normalized(`${song.title} ${song.artist}`);
    if (!song.id || !song.title || !song.artist || excludedIds.has(song.id)
      || usedIds.has(song.id) || usedNames.has(nameKey)) return [];

    const context = songContext(song);
    const artist = artistKey(context);
    const name = displayArtist(song);
    const likedArtist = containsArtist(options.liked, artist);
    const recentArtist = containsArtist(options.recent, artist);
    const skippedArtist = containsArtist(options.skipped, artist);
    const sameAsCurrent = Boolean(options.current && artist && artist === artistKey(options.current));
    const languageMatch = Boolean(options.language && song.language
      && normalized(song.language).includes(normalized(options.language)));
    const languageMismatch = Boolean(options.language && song.language && !languageMatch);
    const artistNamed = artistQueryScore(song, options.queries) > 0;
    const echo = !artistNamed && !likedArtist && !recentArtist && !sameAsCurrent
      && titleEchoesQuery(song, options.queries);
    const score = 40 - item.queryIndex * 10 + artistQueryScore(song, options.queries)
      + (likedArtist ? 12 : 0) + (recentArtist ? 5 : 0) + (sameAsCurrent ? 3 : 0)
      - (skippedArtist ? 30 : 0) - (languageMismatch ? 24 : 0) + (languageMatch ? 14 : 0)
      - (echo ? 15 : 0);
    // Only reasons that are true of this song, strongest first. The fallback names no language and no taste.
    const reasons = [
      ...(likedArtist ? [`You've liked ${name} before.`] : []),
      ...(sameAsCurrent ? ['Same artist as what\'s playing.'] : []),
      ...(recentArtist ? [`${name} is in your recent plays.`] : []),
      ...(languageMatch && options.language ? [`A ${capitalized(options.language)} pick, as asked.`] : []),
      ...(artistNamed ? [`You asked for ${name}.`] : [])
    ];
    return [{ item, artist, score, reasons, fallback: `${name} came up when I searched for that.`, alternate: `More from ${name} in the same search.`, nameKey }];
  }).sort((a, b) => b.score - a.score || a.item.queryIndex - b.item.queryIndex);

  const picks = [...existing];
  const artistCounts = new Map<string, number>();
  for (const { song } of existing) {
    const key = artistKey(songContext(song));
    artistCounts.set(key, (artistCounts.get(key) ?? 0) + 1);
  }
  const remaining = [...ranked];
  const hasRoom = ({ artist }: { readonly artist: string }): boolean => (artistCounts.get(artist) ?? 0) < 2;
  while (picks.length < cap && remaining.length > 0) {
    const previous = picks[picks.length - 1]?.reason ?? '';
    let index = remaining.findIndex(hasRoom);
    if (index < 0) index = 0;
    let chosen = remaining[index];
    if (!chosen) break;
    let reason = chosen.reasons.find((item) => item !== previous);
    if (reason === undefined) {
      // The next pick would repeat the last reason: prefer a near-equal song whose top reason differs.
      let seen = 0;
      for (let ahead = index + 1; ahead < remaining.length && seen < 3; ahead += 1) {
        const candidate = remaining[ahead];
        if (!candidate || !hasRoom(candidate)) continue;
        seen += 1;
        if (chosen.score - candidate.score > 5) break;
        const top = candidate.reasons[0] ?? candidate.fallback;
        if (top !== previous) {
          index = ahead;
          chosen = candidate;
          reason = top;
          break;
        }
      }
      reason ??= chosen.fallback !== previous ? chosen.fallback : chosen.alternate;
    }
    remaining.splice(index, 1);
    picks.push({ song: chosen.item.song, reason });
    usedIds.add(chosen.item.song.id);
    usedNames.add(chosen.nameKey);
    artistCounts.set(chosen.artist, (artistCounts.get(chosen.artist) ?? 0) + 1);
  }
  return picks.slice(0, cap);
}
