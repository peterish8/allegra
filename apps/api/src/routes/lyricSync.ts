import { Router, type Response } from 'express';
import type { AuthService } from '../auth/auth.js';
import { exactKeys, lyricsScript, LyricSyncInputError, validLyricsRef, type LyricSyncService } from '../services/lyricSync.js';
import { accountUser } from './imports.js';
import { asRecord, sendFailure, sendSuccess } from './common.js';

const SIGNIN = 'Sign in to sync lyrics and share the timing with everyone.';

export function lyricSyncRouter(auth: AuthService, sync: LyricSyncService): Router {
  const router = Router();
  router.get('/lyrics/sources', async (request, response) => {
    const ref = request.query.ref;
    if (!validLyricsRef(ref)) { invalid(response); return; }
    try { sendSuccess(response, await sync.sources(ref)); } catch (error) { failure(response, error); }
  });
  router.post('/lyrics/sync', async (request, response) => {
    const user = await accountUser(auth, request, response, SIGNIN);
    if (!user) return;
    const body = asRecord(request.body);
    if (!exactKeys(body, ['ref', 'versions']) || !validLyricsRef(body.ref)) { invalid(response); return; }
    try { sendSuccess(response, await sync.submit(body.ref, body.versions, user.userId)); } catch (error) { failure(response, error); }
  });
  router.post('/lyrics/report', async (request, response) => {
    const user = await accountUser(auth, request, response, SIGNIN);
    if (!user) return;
    const body = asRecord(request.body);
    if (!exactKeys(body, ['ref', 'script']) || !validLyricsRef(body.ref) || !lyricsScript(body.script)) { invalid(response); return; }
    try { sendSuccess(response, await sync.report(body.ref, body.script, user.userId)); } catch (error) { failure(response, error); }
  });
  return router;
}

function invalid(response: Response): void {
  response.status(400).json({ success: false, data: null, error: 'Choose a song and valid lyric version.' });
}

function failure(response: Response, error: unknown): void {
  if (error instanceof LyricSyncInputError) {
    response.status(400).json({ success: false, data: null, error: error.message });
    return;
  }
  sendFailure(response, error);
}
