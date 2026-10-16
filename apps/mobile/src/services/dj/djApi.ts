import type { DjTurnRequest, DjTurnResponse } from '@shared/dj';
import type { UnifiedSong } from '@shared/types';

import { ALLEGRA_API_URL } from '../account/config';

interface Envelope<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
}

/** The BYOK key is posted only in the request body and is never persisted by this client. */
export async function requestDjTurn(input: DjTurnRequest): Promise<DjTurnResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 48_000);
  try {
    const response = await fetch(`${ALLEGRA_API_URL}/api/ai/dj/turn`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: controller.signal
    });
    let payload: Envelope<DjTurnResponse> | null = null;
    try { payload = await response.json() as Envelope<DjTurnResponse>; } catch { /* Friendly fallback below. */ }
    if (!response.ok || !payload?.success || !payload.data) {
      throw new Error(payload?.error ?? 'The DJ could not finish that request. Try again shortly.');
    }
    return payload.data;
  } finally {
    clearTimeout(timer);
  }
}

/** The local model uses the same Allegra catalog as cloud DJ, without sending its prompt upstream. */
export async function searchDjCatalog(query: string, signal?: AbortSignal): Promise<UnifiedSong[]> {
  const url = `${ALLEGRA_API_URL}/api/search?q=${encodeURIComponent(query)}&limit=14&page=0`;
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal });
  let payload: Envelope<{ readonly results: UnifiedSong[] }> | null = null;
  try { payload = await response.json() as Envelope<{ readonly results: UnifiedSong[] }>; } catch { /* Friendly fallback below. */ }
  if (!response.ok || !payload?.success || !payload.data) {
    throw new Error(payload?.error ?? 'The music catalog could not be reached. Try again shortly.');
  }
  return payload.data.results;
}
