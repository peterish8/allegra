import { Router, type Response } from 'express';

import { comparePreview, type PreviewInputs, type RecommendationPreviewSource } from '../services/recommendationPreview.js';
import type { RecommendationService } from '../services/recommendations.js';
import { boundedString, sendFailure, sendSuccess } from './common.js';

/**
 * Development-only comparison of Quick Picks and the LightFM blend for a public benchmark
 * playlist. createApp mounts it only outside production when a preview source is configured.
 * It reads no account, so there is nothing personal to isolate or cache.
 */
export function recommendationPreviewRouter(recommendations: RecommendationService, source: RecommendationPreviewSource): Router {
  const router = Router();
  const inputs = async (response: Response): Promise<PreviewInputs | null> => {
    try {
      return await source.load();
    } catch {
      response.status(503).json({ success: false, data: null, error: 'Preview profiles are not available. Run tools/recommendations/preview-profiles.ts.' });
      return null;
    }
  };

  router.get('/recommendations/preview/profiles', async (_request, response) => {
    const loaded = await inputs(response);
    if (!loaded) return;
    try {
      const { profiles, model } = loaded;
      sendSuccess(response, {
        model: model.status === 'ready'
          ? { status: 'ready', seed: model.model.seed, collectedAt: model.model.collectedAt }
          : { status: 'unavailable', detail: model.detail },
        profiles: profiles.map((profile) => ({
          id: profile.id,
          title: profile.title,
          language: profile.language,
          genre: profile.genre,
          seeds: profile.seeds.length,
          hasVector: model.status === 'ready' && model.model.profiles.has(profile.id)
        }))
      });
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.get('/recommendations/preview', async (request, response) => {
    const id = boundedString(request.query.profile, 40);
    if (!id) {
      response.status(400).json({ success: false, data: null, error: 'Choose a preview profile.' });
      return;
    }
    const loaded = await inputs(response);
    if (!loaded) return;
    try {
      const { profiles, model } = loaded;
      const profile = profiles.find((row) => row.id === id);
      if (!profile) {
        response.status(404).json({ success: false, data: null, error: 'That preview profile does not exist.' });
        return;
      }
      const comparison = await comparePreview(recommendations, profile, model);
      if (!comparison) {
        response.status(404).json({ success: false, data: null, error: 'The catalog returned no candidates for this playlist.' });
        return;
      }
      sendSuccess(response, {
        profile: { id: profile.id, title: profile.title, language: profile.language, genre: profile.genre, seeds: profile.seeds.length, hidden: profile.hiddenCount },
        ...comparison
      });
    } catch (error) {
      sendFailure(response, error);
    }
  });

  return router;
}
