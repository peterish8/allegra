import { Router } from 'express';

import type { AuthService } from '../auth/auth.js';
import { parseLanguages } from '../lib/languages.js';
import { userLanguages } from '../services/recommendationContext.js';
import type { RadioService, RadioTasteSummary } from '../services/radio.js';
import { isPersonalised, type UserData } from '../user/store.js';
import { callerProfile } from './auth.js';
import { sendFailure, sendSuccess, songId } from './common.js';

/**
 * `GET /api/radio/:songId`: the candidates for a song radio (a search tap, a Radio tap). Signed-in
 * listeners who allow personalisation also get their taste back, which the client's ranker blends
 * in; everyone else gets the same pool without it. Personal, so never cached by the edge.
 */
export function radioRouter(radio: RadioService, auth: AuthService): Router {
  const router = Router();

  router.get('/radio/:id', async (request, response) => {
    const id = songId(request.params.id);
    if (!id) {
      response.status(400).json({ success: false, data: null, error: "Something's missing from that request." });
      return;
    }
    try {
      const user = await callerProfile(auth, request).catch(() => null);
      const languages = user ? userLanguages(user) : parseLanguages(request.query.languages);
      sendSuccess(response, await radio.pool(id, { taste: tasteFor(user), languages }));
    } catch (error) {
      sendFailure(response, error);
    }
  });

  return router;
}

function tasteFor(user: UserData | null): RadioTasteSummary | null {
  if (!user || !isPersonalised(user) || !user.taste) return null;
  return {
    artists: user.taste.artists.slice(0, 20).map((entry) => ({ name: entry.name, score: entry.score })),
    languages: user.taste.languages.slice(0, 5).map((entry) => entry.name)
  };
}
