import type { DjGoal, DjProvider, DjSessionState, DjSlashCommand } from '@shared/dj';
import type { UnifiedSong } from '@shared/types';

/** The only DJ setting that is stored: which provider and model. The API key is never written anywhere. */
export const DJ_PROVIDER_STORAGE_KEY = 'allegra.dj.provider.v1';

const PROVIDERS: readonly DjProvider[] = ['openai', 'openrouter', 'gemini', 'local'];
const MODEL_MAX_LENGTH = 160;

export interface DjProviderChoice {
  readonly provider: DjProvider;
  readonly model: string;
}

export function defaultModelFor(provider: DjProvider): string {
  if (provider === 'openai') return 'gpt-4o-mini';
  if (provider === 'openrouter') return 'openai/gpt-4o-mini';
  if (provider === 'gemini') return 'gemini-3.8-flash';
  return 'Qwen3 0.6B (on-device)';
}

function isProvider(value: unknown): value is DjProvider {
  return typeof value === 'string' && (PROVIDERS as readonly string[]).includes(value);
}

/** Reads the stored provider and model; anything unusable reads as "nothing stored". */
export function readDjProviderChoice(storage: Pick<Storage, 'getItem'>): DjProviderChoice | null {
  try {
    const raw = storage.getItem(DJ_PROVIDER_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (!isProvider(record.provider)) return null;
    const model = typeof record.model === 'string' ? record.model.trim() : '';
    return {
      provider: record.provider,
      model: model && model.length <= MODEL_MAX_LENGTH ? model : defaultModelFor(record.provider)
    };
  } catch {
    return null;
  }
}

/** Writes only provider and model. Storage that is full or blocked is ignored. */
export function writeDjProviderChoice(storage: Pick<Storage, 'setItem'>, choice: DjProviderChoice): void {
  try {
    storage.setItem(DJ_PROVIDER_STORAGE_KEY, JSON.stringify({ provider: choice.provider, model: choice.model }));
  } catch {
    // The choice just is not remembered.
  }
}

export interface SlashState {
  readonly goal: DjGoal;
  readonly songLimit: number;
}

export interface ParsedSlash {
  readonly command: DjSlashCommand;
  readonly size?: number;
  readonly remainder: string;
}

export interface SlashOutcome {
  readonly next: { readonly goal?: DjGoal; readonly songLimit?: number; readonly settingsOpen?: boolean };
  readonly status?: string;
  readonly send?: { readonly message: string; readonly goal?: DjGoal; readonly songLimit?: number };
  readonly prompt: { readonly clear: boolean; readonly prefill?: string };
}

/** What a recognised slash command does. The prompt is always cleared; `/size` alone asks for a number. */
export function applySlashCommand(state: SlashState, parsed: ParsedSlash): SlashOutcome {
  const { command, remainder } = parsed;
  if (command.action === 'settings') {
    return { next: { settingsOpen: true }, status: 'Choose your AI provider or set up a key below.', prompt: { clear: true } };
  }
  if (command.action === 'help') {
    return { next: {}, status: 'Try /late-night, /tamil, /energy, /focus, /similar, /keep, /mix, /playlist, /size, or /settings.', prompt: { clear: true } };
  }
  if (command.action === 'size') {
    if (!parsed.size) {
      return { next: {}, status: 'Choose a song count from the suggestions.', prompt: { clear: true, prefill: '/size ' } };
    }
    const minimum = state.goal === 'playlist' ? 5 : 1;
    const maximum = state.goal === 'playlist' ? 30 : 8;
    const songLimit = Math.max(minimum, Math.min(maximum, parsed.size));
    if (remainder) return { next: { songLimit }, send: { message: remainder, songLimit }, prompt: { clear: true } };
    return { next: { songLimit }, status: `I’ll line up ${songLimit} songs.`, prompt: { clear: true } };
  }
  if (command.action === 'goal' && command.goal) {
    const songLimit = command.goal === 'mix' ? Math.min(state.songLimit, 8) : Math.max(state.songLimit, 10);
    const next = { goal: command.goal, songLimit };
    if (remainder) return { next, send: { message: remainder, goal: command.goal, songLimit }, prompt: { clear: true } };
    return {
      next,
      status: command.goal === 'playlist' ? 'Playlist draft ready. Tell me the mood or first song.' : 'Live DJ is on. What should we play next?',
      prompt: { clear: true }
    };
  }
  if (command.action === 'prompt') {
    return { next: {}, send: { message: [command.prompt, remainder].filter(Boolean).join(' ') }, prompt: { clear: true } };
  }
  return { next: {}, prompt: { clear: true } };
}

/** The DJ's memory, edited by hand. Each helper returns a new session; the next turn sends it as the memory. */
export function sessionWithEnergy(session: DjSessionState, energy: number): DjSessionState {
  return { ...session, energy: Math.min(5, Math.max(1, Math.round(energy))) };
}

export function sessionWithoutLanguage(session: DjSessionState): DjSessionState {
  return { ...session, language: null };
}

export function sessionWithoutConstraint(session: DjSessionState, constraint: string): DjSessionState {
  return { ...session, constraints: session.constraints.filter((item) => item !== constraint) };
}

/** Moves `id` by `delta` places inside `ids` (clamped to the ends). Unknown ids leave the order alone. */
export function moveId(ids: readonly string[], id: string, delta: number): string[] {
  const from = ids.indexOf(id);
  if (from < 0) return [...ids];
  const to = Math.min(ids.length - 1, Math.max(0, from + delta));
  if (to === from) return [...ids];
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/** Items in the order of `ids`; items whose id is not named keep their relative order at the end. */
export function orderByIds<T>(items: readonly T[], ids: readonly string[], idOf: (item: T) => string): T[] {
  const byId = new Map(items.map((item) => [idOf(item), item] as const));
  const named = ids.flatMap((id) => {
    const item = byId.get(id);
    if (!item) return [];
    byId.delete(id);
    return [item];
  });
  return [...named, ...items.filter((item) => byId.has(idOf(item)))];
}

export interface DjSuggestion {
  readonly label: string;
  readonly prompt: string;
  /** What pressing it will do, in plain words (the chip's tooltip and accessible description). */
  readonly hint: string;
}

const firstArtist = (artist: string): string => artist.split(/,|&| and /)[0]?.trim() || artist;
const capitalise = (word: string): string => word.charAt(0).toLocaleUpperCase() + word.slice(1).toLocaleLowerCase();

/** The five energy levels, as words the listener reads on the control. */
export const DJ_ENERGY_WORDS = ['Calm', 'Easy', 'Balanced', 'Lively', 'Hype'] as const;

export function djEnergyWord(energy: number): (typeof DJ_ENERGY_WORDS)[number] {
  const index = Math.min(5, Math.max(1, Math.round(Number.isFinite(energy) ? energy : 3))) - 1;
  return DJ_ENERGY_WORDS[index] ?? 'Balanced';
}

/**
 * Starter requests built from what is true right now: the playing song (and whether it has lyrics),
 * the set's energy, the language the listener plays most, the hour, then a wildcard. Each says what it
 * will do, and each is a plain request the DJ already understands.
 */
export function djSuggestions(
  current: Pick<UnifiedSong, 'title' | 'artist' | 'language' | 'hasLyrics'> | null,
  recent: readonly Pick<UnifiedSong, 'artist' | 'language'>[],
  hour: number,
  session: Pick<DjSessionState, 'energy' | 'language'> = { energy: 3, language: null }
): DjSuggestion[] {
  const chips: DjSuggestion[] = [];
  if (current) {
    const artist = firstArtist(current.artist);
    chips.push({ label: `More from ${artist}`, prompt: `More songs by ${artist} next`, hint: `Lines up songs by ${artist} after this one` });
  }
  if (session.energy >= 4) {
    chips.push({ label: 'Calmer next', prompt: 'A little calmer next, keep the style', hint: 'Keeps the style and brings the energy down' });
  } else {
    chips.push({ label: 'More energy', prompt: 'More energy next, keep the style', hint: 'Keeps the style and lifts the energy' });
  }
  const counts = new Map<string, number>();
  for (const song of current ? [current, ...recent] : recent) {
    const language = song.language?.trim().toLocaleLowerCase();
    if (language && language !== 'english' && language !== 'unknown') counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (top && !session.language) {
    chips.push({ label: `Keep it ${capitalise(top)}`, prompt: `${capitalise(top)} songs next`, hint: `Keeps the next songs in ${capitalise(top)}` });
  }
  if (current?.hasLyrics) chips.push({ label: 'Sing along', prompt: 'Start karaoke', hint: 'Fades the singer out and shows the lyrics' });
  if (hour >= 21 || hour < 4) chips.push({ label: 'Late night', prompt: 'Late night, soft and unhurried', hint: 'Soft, unhurried songs for now' });
  else if (hour < 11) chips.push({ label: 'Morning lift', prompt: 'Something bright to start the morning', hint: 'Bright songs to start the day' });
  else if (hour < 17) chips.push({ label: 'Focus flow', prompt: 'Steady music to focus, no sharp changes', hint: 'Steady songs with no sharp changes' });
  else chips.push({ label: 'Golden hour', prompt: 'Warm evening songs', hint: 'Warm songs for the evening' });
  chips.push({ label: 'Surprise me', prompt: 'Surprise me, but keep my taste', hint: 'Something you may not expect, still your taste' });
  return chips;
}

/** What the DJ remembers across a reload of this tab. Never the API key. */
export const DJ_MEMORY_STORAGE_KEY = 'allegra.dj.memory.v1';

export interface DjMemory {
  readonly session: DjSessionState;
  readonly history: readonly { readonly role: 'user' | 'assistant'; readonly content: string }[];
  readonly goal: DjGoal;
  readonly songLimit: number;
  readonly draft: readonly { readonly song: UnifiedSong; readonly reason: string }[];
  readonly draftName: string;
  readonly reasons: Readonly<Record<string, string>>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';

function readSong(value: unknown): UnifiedSong | null {
  if (!isRecord(value)) return null;
  const { id, title, artist, artwork, streamUrl, duration, hasLyrics, playCount, source } = value;
  if (!isString(id) || !isString(title) || !isString(artist) || !isString(artwork) || !isString(streamUrl)) return null;
  if (typeof duration !== 'number' || typeof hasLyrics !== 'boolean' || typeof playCount !== 'number') return null;
  if (source !== 'Saavn' && source !== 'Gaana') return null;
  return {
    id, title, artist, artwork, streamUrl, duration, hasLyrics, playCount, source,
    ...(isString(value.album) ? { album: value.album } : {}),
    ...(isString(value.language) ? { language: value.language } : {})
  };
}

function readSession(value: unknown): DjSessionState | null {
  if (!isRecord(value) || !isString(value.vibe) || typeof value.energy !== 'number') return null;
  const language = isString(value.language) ? value.language : null;
  const constraints = Array.isArray(value.constraints) ? value.constraints.filter(isString).slice(0, 12) : [];
  return { vibe: value.vibe, energy: Math.min(5, Math.max(1, Math.round(value.energy))), language, constraints };
}

/** Reads the remembered session; anything malformed reads as "nothing remembered". */
export function readDjMemory(storage: Pick<Storage, 'getItem'>): DjMemory | null {
  try {
    const raw = storage.getItem(DJ_MEMORY_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    const session = readSession(parsed.session);
    if (!session) return null;
    const history = (Array.isArray(parsed.history) ? parsed.history : []).flatMap((item: unknown): DjMemory['history'][number][] => {
      if (!isRecord(item) || !isString(item.content)) return [];
      const { role } = item;
      return role === 'user' || role === 'assistant' ? [{ role, content: item.content.slice(0, 2000) }] : [];
    }).slice(-8);
    const draft = (Array.isArray(parsed.draft) ? parsed.draft : []).flatMap((item: unknown) => {
      if (!isRecord(item)) return [];
      const song = readSong(item.song);
      return song ? [{ song, reason: isString(item.reason) ? item.reason : '' }] : [];
    }).slice(0, 30);
    const reasons = isRecord(parsed.reasons)
      ? Object.fromEntries(Object.entries(parsed.reasons).filter((entry): entry is [string, string] => isString(entry[1])).slice(0, 60))
      : {};
    const goal: DjGoal = parsed.goal === 'playlist' ? 'playlist' : 'mix';
    const songLimit = typeof parsed.songLimit === 'number' ? Math.min(30, Math.max(1, Math.round(parsed.songLimit))) : 8;
    const draftName = isString(parsed.draftName) && parsed.draftName.trim() ? parsed.draftName.slice(0, 100) : 'A little mix';
    return { session, history, goal, songLimit, draft, draftName, reasons };
  } catch {
    return null;
  }
}

/** Writes the session memory. Storage that is full or blocked is ignored. */
export function writeDjMemory(storage: Pick<Storage, 'setItem'>, memory: DjMemory): void {
  try {
    storage.setItem(DJ_MEMORY_STORAGE_KEY, JSON.stringify(memory));
  } catch {
    // The session just is not remembered.
  }
}
