import { Router, type Request, type Response } from 'express';

import type { AuthService } from '../auth/auth.js';
import type { CatalogService } from '../catalog/catalog.js';
import { buildRecommendationInput } from '../services/recommendationContext.js';
import type { RecommendationService } from '../services/recommendations.js';
import { isAiProvider } from '../lib/aiProviders.js';
import { AiKeyRequiredError, type TranslationService } from '../services/translation.js';
import { AiKeyRejectedError, AiRateLimitedError, type AiKey, type TranslationMode } from '../services/translationLlm.js';
import type { LyricLine } from '../types.js';
import { callerProfile, sendUnauthorized } from './auth.js';
import { asRecord, sendFailure, sendSuccess, songId } from './common.js';

const MAX_LINES = 400;
const MAX_LINE_LENGTH = 500;

/**
 * Recommendations (from the catalog and the listener's taste) and lyrics translation (MyMemory).
 * Neither uses an LLM. The `/ai/...` paths are the names these shipped under; they stay as
 * aliases so a client built before the rename keeps working.
 */
export function discoveryRouter(translation: TranslationService, recommendations: RecommendationService, auth: AuthService, catalog: CatalogService): Router {
  const router = Router();

  const translate = async (request: Request, response: Response): Promise<void> => {
    const body = asRecord(request.body);
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : '';
    const artist = typeof body.artist === 'string' ? body.artist.trim().slice(0, 200) : '';
    const targetLanguage = typeof body.targetLanguage === 'string' && body.targetLanguage.trim() ? body.targetLanguage.trim().slice(0, 40) : 'English';
    const language = typeof body.language === 'string' ? body.language.trim().slice(0, 40) : undefined;
    const lines = parseLines(body.lines);
    const mode = parseMode(body.mode);
    const ai = parseAiKey(body.ai);
    if (!title || !artist || !lines || mode === INVALID || ai === INVALID) {
      response.status(400).json({ success: false, data: null, error: "Something's missing from that request." });
      return;
    }
    try {
      const result = await translation.translate(lines, title, artist, targetLanguage, language, { mode, ...(ai ? { ai } : {}) });
      if (!result) {
        response.status(502).json({ success: false, data: null, error: 'Could not translate this song right now. Try again later.' });
        return;
      }
      sendSuccess(response, result);
    } catch (error) {
      // Provider details stay here; the listener gets plain copy. The key is never echoed.
      if (error instanceof AiKeyRequiredError) {
        response.status(400).json({ success: false, data: null, error: 'Romanised and pronunciation lyrics need your AI key.' });
        return;
      }
      if (error instanceof AiKeyRejectedError) {
        response.status(400).json({ success: false, data: null, error: 'That AI key was refused.' });
        return;
      }
      if (error instanceof AiRateLimitedError) {
        response.status(429).json({ success: false, data: null, error: 'Your AI provider is limiting this key. Try again in a minute.' });
        return;
      }
      sendFailure(response, error);
    }
  };

  const recommend = async (request: Request, response: Response): Promise<void> => {
    try {
      const user = await callerProfile(auth, request);
      if (!user) {
        sendUnauthorized(response);
        return;
      }
      const currentId = songId(request.query.songId);
      const { context, excludeIds, excludeSongs } = await buildRecommendationInput(catalog, user, currentId);
      const result = await recommendations.recommend(context, excludeIds, excludeSongs);
      if (!result) {
        response.status(404).json({ success: false, data: null, error: 'Not enough listening history yet for a recommendation.' });
        return;
      }
      sendSuccess(response, result);
    } catch (error) {
      sendFailure(response, error);
    }
  };

  router.post('/lyrics/translate', translate);
  router.post('/ai/translate-lyrics', translate);
  router.get('/recommendations', recommend);
  router.get('/ai/recommendations', recommend);

  return router;
}

const INVALID = Symbol('invalid');

function parseMode(value: unknown): TranslationMode | typeof INVALID {
  if (value === undefined) return 'translate';
  return value === 'translate' || value === 'romanize' || value === 'transcribe' ? value : INVALID;
}

/** The listener's own key, forwarded for this request only. Absent means the free MyMemory path. */
function parseAiKey(value: unknown): AiKey | null | typeof INVALID {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object') return INVALID;
  const record = value as Record<string, unknown>;
  const { provider, apiKey, model } = record;
  if (!isAiProvider(provider)) return INVALID;
  if (typeof apiKey !== 'string' || apiKey.trim().length < 8 || apiKey.length > 512) return INVALID;
  if (typeof model !== 'string' || !model.trim() || model.length > 160) return INVALID;
  return { provider, apiKey: apiKey.trim(), model: model.trim() };
}

function parseLines(value: unknown): LyricLine[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_LINES) return null;
  const lines: LyricLine[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) return null;
    const record = entry as Record<string, unknown>;
    if (typeof record.text !== 'string' || typeof record.timestamp !== 'number' || !Number.isFinite(record.timestamp)) return null;
    const lineOrder = typeof record.lineOrder === 'number' && Number.isFinite(record.lineOrder) ? record.lineOrder : lines.length;
    lines.push({ text: record.text.slice(0, MAX_LINE_LENGTH), timestamp: record.timestamp, lineOrder });
  }
  return lines;
}
