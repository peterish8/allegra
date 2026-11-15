/**
 * The listener's AI key, shared from the DJ with lyric translation (1.69.0). Memory only: never written to storage,
 * a cookie or a log, and gone on reload, the same rule as the DJ (`djSession.ts`).
 */
export interface AiKeyChoice {
  readonly provider: 'openai' | 'openrouter' | 'gemini';
  readonly apiKey: string;
  readonly model: string;
}

let current: AiKeyChoice | null = null;
const listeners = new Set<() => void>();

const same = (a: AiKeyChoice | null, b: AiKeyChoice | null): boolean =>
  a === b || (a !== null && b !== null && a.provider === b.provider && a.apiKey === b.apiKey && a.model === b.model);

export function setAiKey(choice: AiKeyChoice | null): void {
  if (same(current, choice)) return;
  current = choice;
  for (const listener of listeners) listener();
}

export function currentAiKey(): AiKeyChoice | null {
  return current;
}

export function subscribeAiKey(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
