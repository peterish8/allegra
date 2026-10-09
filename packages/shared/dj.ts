import type { UnifiedSong } from './types.js';

export type DjCloudProvider = 'openai' | 'openrouter' | 'gemini';
export type DjProvider = DjCloudProvider | 'local';
export type DjReaction = 'neutral' | 'curious' | 'excited' | 'dreamy' | 'confused';
export type DjQueueOperation = 'replace_upcoming' | 'insert' | 'keep';
export type DjGoal = 'mix' | 'playlist';
export type DjDraftOperation = 'replace' | 'extend' | 'keep' | 'remove';

export type DjSlashCommandAction = 'goal' | 'prompt' | 'settings' | 'size' | 'help';

export interface DjSlashCommand {
  readonly command: string;
  readonly label: string;
  readonly detail: string;
  readonly action: DjSlashCommandAction;
  readonly goal?: DjGoal;
  readonly prompt?: string;
  readonly size?: number;
}

export const DJ_SLASH_COMMANDS: readonly DjSlashCommand[] = [
  { command: '/late-night', label: 'Late night', detail: 'Soft, unhurried songs', action: 'prompt', prompt: 'Late night' },
  { command: '/tamil', label: 'Tamil melodies', detail: 'Keep the set in Tamil', action: 'prompt', prompt: 'Tamil melodies' },
  { command: '/easygoing', label: 'Easygoing', detail: 'Keep the energy relaxed', action: 'prompt', prompt: 'Easygoing' },
  { command: '/energy', label: 'More energy', detail: 'Lift the energy and keep the mood', action: 'prompt', prompt: 'More energy' },
  { command: '/focus', label: 'Focus', detail: 'Steady music without sharp shifts', action: 'prompt', prompt: 'Focus' },
  { command: '/surprise', label: 'Surprise me', detail: 'Explore a little while keeping my taste', action: 'prompt', prompt: 'Surprise me' },
  { command: '/similar', label: 'Like this song', detail: 'Use the current track as a seed', action: 'prompt', prompt: 'Something like this next' },
  { command: '/keep', label: 'Keep this song', detail: 'Change only what comes after it', action: 'prompt', prompt: 'Keep this song, change the rest' },
  { command: '/no-sad', label: 'No sad songs', detail: 'Add a session preference', action: 'prompt', prompt: 'No sad songs for a while' },
  { command: '/mix', label: 'Live mix', detail: 'Shape the upcoming queue', action: 'goal', goal: 'mix' },
  { command: '/playlist', label: 'Playlist draft', detail: 'Build and edit a playlist', action: 'goal', goal: 'playlist' },
  { command: '/size', label: 'Song count', detail: 'Choose how many songs', action: 'size' },
  { command: '/settings', label: 'AI settings', detail: 'Choose a provider or enter your key', action: 'settings' },
  { command: '/help', label: 'Show shortcuts', detail: 'Browse all DJ commands', action: 'help' },
];

export function getDjSlashSuggestions(input: string, goal: DjGoal): readonly DjSlashCommand[] {
  const value = input.trimStart();
  if (!value.startsWith('/')) return [];

  const match = /^\/([a-z-]*)(?:\s+([\s\S]*))?$/i.exec(value);
  if (!match) return [];
  const name = match[1].toLocaleLowerCase();
  const argument = match[2] ?? '';

  if (name === 'size') {
    const query = argument.trim();
    if (!/^\d*$/.test(query)) return [];
    const options = goal === 'playlist' ? [5, 10, 15, 20, 25, 30] : [1, 2, 4, 6, 8];
    const typedSize = query ? Number(query) : 0;
    const choices = query
      ? [Math.max(goal === 'playlist' ? 5 : 1, Math.min(goal === 'playlist' ? 30 : 8, typedSize))]
      : options;
    return choices.filter(Number.isFinite).slice(0, 6).map((size) => ({
      command: `/size ${size}`,
      label: `${size} songs`,
      detail: goal === 'playlist' ? 'Set playlist length' : 'Set queue length',
      action: 'size',
      size,
    }));
  }

  if (argument) return [];
  return DJ_SLASH_COMMANDS.filter((item) => item.command.slice(1).startsWith(name));
}

export function parseDjSlashCommand(input: string): { readonly command: DjSlashCommand; readonly size?: number; readonly remainder: string } | null {
  const match = /^\/([a-z-]+)(?:\s+([\s\S]*))?$/i.exec(input.trim());
  if (!match) return null;
  const command = DJ_SLASH_COMMANDS.find((item) => item.command.slice(1) === match[1].toLocaleLowerCase());
  if (!command) return null;
  if (command.action !== 'size') return { command, remainder: (match[2] ?? '').trim() };

  const value = match[2]?.trim() ?? '';
  const sizeMatch = /^(\d+)(?:\s+([\s\S]*))?$/.exec(value);
  const size = Number(sizeMatch?.[1]);
  return Number.isFinite(size) && size > 0
    ? { command, size, remainder: sizeMatch?.[2]?.trim() ?? '' }
    : { command, remainder: value };
}

export interface DjTrackContext {
  readonly id: string;
  readonly title: string;
  readonly artist: string;
  readonly language?: string;
}

export interface DjSessionState {
  readonly vibe: string;
  readonly energy: number;
  readonly language: string | null;
  readonly constraints: readonly string[];
}

export interface DjTurnRequest {
  readonly provider: DjCloudProvider;
  readonly apiKey: string;
  readonly model: string;
  readonly goal: DjGoal;
  readonly songLimit: number;
  readonly message: string;
  readonly history: readonly { readonly role: 'user' | 'assistant'; readonly content: string }[];
  readonly current: DjTrackContext | null;
  readonly queue: readonly DjTrackContext[];
  readonly draft: readonly DjTrackContext[];
  readonly draftName: string;
  readonly recent: readonly DjTrackContext[];
  readonly liked: readonly DjTrackContext[];
  readonly skipped: readonly DjTrackContext[];
  readonly session: DjSessionState;
}

export interface DjTurnResponse {
  readonly reply: string;
  readonly session: DjSessionState;
  readonly goal: DjGoal;
  readonly playlistName: string | null;
  readonly draftOperation: DjDraftOperation;
  readonly removeTrackIds: readonly string[];
  readonly operation: DjQueueOperation;
  /** Number of upcoming tracks to keep ahead of the inserted track. */
  readonly insertAfter: number | null;
  readonly reaction: DjReaction;
  readonly queue: readonly { readonly song: UnifiedSong; readonly reason: string }[];
}

/** Bounded local-model interpretation; all catalog search and ranking stays in Allegra code. */
export interface DjLocalIntent {
  readonly reply: string;
  readonly vibe: string;
  readonly energy: number;
  readonly operation: DjQueueOperation;
  readonly insertAfter: number | null;
  readonly languageAction: 'keep' | 'set' | 'clear';
  readonly language: string | null;
  readonly addConstraints: readonly string[];
  readonly removeConstraints: readonly string[];
  readonly searchQueries: readonly string[];
  readonly strategy: 'replace' | 'extend';
  readonly removeTrackIds: readonly string[];
  readonly playlistName: string | null;
  readonly reaction: DjReaction;
}
