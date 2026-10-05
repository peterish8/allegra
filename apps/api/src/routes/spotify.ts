import { timingSafeEqual } from 'node:crypto';
import { Router, type Response } from 'express';
import type { AuthService } from '../auth/auth.js';
import { SpotifyApiError } from '../providers/spotify.js';
import type { SpotifyTransferService } from '../services/spotifyTransfer.js';
import { accountUser } from './imports.js';
import { asRecord, sendFailure, sendSuccess } from './common.js';

const MOBILE_RETURN = 'lyricflow://open/import';

export function spotifyRouter(spotify: SpotifyTransferService, auth: AuthService, gatewaySecret?: string): Router {
  const router = Router();

  router.get('/spotify/status', async (req, res) => {
    const user = await accountUser(auth, req, res); if (!user) return;
    try { sendSuccess(res, await spotify.status(user.userId)); } catch (error) { sendSpotifyError(res, error); }
  });

  router.post('/spotify/connect', async (req, res) => {
    const user = await accountUser(auth, req, res); if (!user) return;
    const returnTo = asRecord(req.body).returnTo;
    if (returnTo !== undefined && returnTo !== 'web' && returnTo !== 'mobile') { res.status(400).json({ success: false, data: null, error: 'Choose a valid return destination.' }); return; }
    try { sendSuccess(res, { url: await spotify.connect(user.userId, returnTo === 'mobile' ? 'mobile' : 'web') }); } catch (error) { sendSpotifyError(res, error); }
  });

  router.get('/spotify/callback', async (req, res) => {
    const state = queryText(req.query.state); const code = queryText(req.query.code); const providerError = queryText(req.query.error);
    if (!state) { res.redirect(303, `${spotify.webReturnUrl}?spotify=failed`); return; }
    try {
      const returnTo = providerError ? await spotify.cancel(state) : await spotify.callback(code ?? '', state);
      res.redirect(303, `${returnTo === 'mobile' ? MOBILE_RETURN : spotify.webReturnUrl}?spotify=${providerError ? 'cancelled' : 'connected'}`);
    } catch {
      res.redirect(303, `${spotify.webReturnUrl}?spotify=failed`);
    }
  });

  router.get('/spotify/playlists', async (req, res) => {
    const user = await accountUser(auth, req, res); if (!user) return;
    try { sendSuccess(res, { playlists: await spotify.sourcePlaylists(user.userId) }); } catch (error) { sendSpotifyError(res, error); }
  });

  router.post('/spotify/sync', async (req, res) => {
    const user = await accountUser(auth, req, res); if (!user) return;
    const playlistId = asRecord(req.body).playlistId;
    if (typeof playlistId !== 'string') { res.status(400).json({ success: false, data: null, error: 'Choose a Spotify playlist.' }); return; }
    try { sendSuccess(res, await spotify.sync(user.userId, playlistId)); } catch (error) { sendSpotifyError(res, error); }
  });

  router.patch('/spotify/settings', async (req, res) => {
    const user = await accountUser(auth, req, res); if (!user) return;
    const enabled = asRecord(req.body).dailyEnabled;
    if (typeof enabled !== 'boolean') { res.status(400).json({ success: false, data: null, error: 'Choose whether daily transfer is enabled.' }); return; }
    try {
      if (!(await spotify.setDaily(user.userId, enabled))) { res.status(404).json({ success: false, data: null, error: 'Connect Spotify before enabling daily transfer.' }); return; }
      sendSuccess(res, { dailyEnabled: enabled });
    } catch (error) { sendSpotifyError(res, error); }
  });

  router.post('/spotify/disconnect', async (req, res) => {
    const user = await accountUser(auth, req, res); if (!user) return;
    try { await spotify.disconnect(user.userId); sendSuccess(res, { disconnected: true }); } catch (error) { sendSpotifyError(res, error); }
  });

  // Called only by the durable Convex daily scheduler; user IDs are never accepted from a browser.
  router.post('/internal/spotify/daily', async (req, res) => {
    if (!gatewaySecret || !constantTimeEqual(req.header('x-convex-server-secret') ?? '', gatewaySecret)) { res.status(401).json({ success: false, data: null, error: 'Not authorized.' }); return; }
    const userId = asRecord(req.body).userId;
    if (typeof userId !== 'string' || userId.length > 160) { res.status(400).json({ success: false, data: null, error: 'Invalid account.' }); return; }
    try { sendSuccess(res, await spotify.dailyStep(userId)); } catch (error) { sendSpotifyError(res, error); }
  });

  return router;
}

function queryText(value: unknown): string | undefined { return typeof value === 'string' && value.length <= 2048 ? value : undefined; }
function constantTimeEqual(actual: string, expected: string): boolean {
  const a = Buffer.from(actual); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
function sendSpotifyError(response: Response, error: unknown): void {
  if (!(error instanceof SpotifyApiError)) { sendFailure(response, error); return; }
  const status = error.status === 400 || error.status === 401 || error.status === 404 || error.status === 409 || error.status === 429 || error.status === 503 ? error.status : 503;
  if (error.retryAfter) response.setHeader('Retry-After', String(error.retryAfter));
  response.status(status).json({ success: false, data: null, error: error.message });
}
