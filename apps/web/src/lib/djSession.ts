import type { DjGoal, DjProvider, DjSlashCommand } from '@shared/dj';

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
      status: command.goal === 'playlist' ? 'Playlist draft ready. Tell me the mood or first song.' : 'Live mix ready. What are we feeling?',
      prompt: { clear: true }
    };
  }
  if (command.action === 'prompt') {
    return { next: {}, send: { message: [command.prompt, remainder].filter(Boolean).join(' ') }, prompt: { clear: true } };
  }
  return { next: {}, prompt: { clear: true } };
}
