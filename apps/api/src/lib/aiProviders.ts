/**
 * The OpenAI-compatible chat endpoints a listener's own AI key can be used with (the DJ and lyric translation).
 * The key is forwarded for one call and never stored or logged.
 */
export type AiProvider = 'openai' | 'openrouter' | 'gemini';

export function isAiProvider(value: unknown): value is AiProvider {
  return value === 'openai' || value === 'openrouter' || value === 'gemini';
}

export function chatCompletionsUrl(provider: AiProvider): string {
  return provider === 'openai'
    ? 'https://api.openai.com/v1/chat/completions'
    : provider === 'gemini'
      ? 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
      : 'https://openrouter.ai/api/v1/chat/completions';
}
