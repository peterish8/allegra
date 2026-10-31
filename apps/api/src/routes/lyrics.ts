import { Router } from 'express';

import type { LyricsService, SongHints } from '../services/lyrics.js';
import { sendFailure, sendSuccess, boundedString } from './common.js';

/**
 * The optional song details a lyrics lookup can use: `ref` ("saavn:<id>") for listener-synced and
 * JioSaavn lyrics, `album` and `language` for a lyric site.
 */
function songHints(query: Record<string, unknown>): SongHints {
  const ref = boundedString(query.ref, 80);
  const album = boundedString(query.album);
  const language = boundedString(query.language, 40);
  return { ...(ref ? { ref } : {}), ...(album ? { album } : {}), ...(language ? { language } : {}) };
}

export function lyricsRouter(lyrics: LyricsService): Router {
  const router = Router();
  router.get('/lyrics', async (request, response) => {
    const title = boundedString(request.query.title);
    const artist = boundedString(request.query.artist);
    const duration = typeof request.query.duration === 'string' ? Number(request.query.duration) : undefined;
    const syncedOnly = request.query.syncedOnly === 'true';
    if (!title || !artist) {
      response.status(400).json({ success: false, data: null, error: "Something's missing from that request." });
      return;
    }
    try {
      const value = await lyrics.find(title, artist, Number.isFinite(duration) ? duration : undefined, syncedOnly, songHints(request.query));
      if (!value) {
        response.status(404).json({ success: false, data: null, error: 'No lyrics found for this song.' });
        return;
      }
      sendSuccess(response, value);
    } catch (error) {
      sendFailure(response, error);
    }
  });
  router.get('/lyrics/alternatives', async (request, response) => {
    const title = boundedString(request.query.title);
    const artist = boundedString(request.query.artist);
    const duration = typeof request.query.duration === 'string' ? Number(request.query.duration) : undefined;
    const syncedOnly = request.query.syncedOnly === 'true';
    if (!title || !artist) {
      response.status(400).json({ success: false, data: null, error: "Something's missing from that request." });
      return;
    }
    try {
      // An empty list is a successful answer: nothing else matched this recording.
      sendSuccess(response, await lyrics.alternatives(title, artist, Number.isFinite(duration) ? duration : undefined, syncedOnly, songHints(request.query)));
    } catch (error) {
      sendFailure(response, error);
    }
  });
  // Lyrics listeners synced for a song, by ref or (for a download with none) by title and artist.
  // `null` is a successful answer: nobody has synced this song yet.
  router.get('/lyrics/verified', async (request, response) => {
    const ref = boundedString(request.query.ref, 80) ?? undefined;
    const title = boundedString(request.query.title) ?? '';
    const artist = boundedString(request.query.artist) ?? '';
    const duration = typeof request.query.duration === 'string' ? Number(request.query.duration) : undefined;
    if (!ref && !title) {
      response.status(400).json({ success: false, data: null, error: "Something's missing from that request." });
      return;
    }
    try {
      response.setHeader('Cache-Control', 'public, max-age=60');
      sendSuccess(response, await lyrics.verified(ref, title, artist, Number.isFinite(duration) ? duration : undefined));
    } catch (error) {
      sendFailure(response, error);
    }
  });
  router.get('/lyrics/search', async (request, response) => {
    const title = boundedString(request.query.title);
    const artist = boundedString(request.query.artist);
    const duration = typeof request.query.duration === 'string' ? Number(request.query.duration) : undefined;
    if (!title || !artist) {
      response.status(400).json({ success: false, data: null, error: "Something's missing from that request." });
      return;
    }
    try {
      sendSuccess(response, await lyrics.search(title, artist, Number.isFinite(duration) ? duration : undefined));
    } catch (error) {
      sendFailure(response, error);
    }
  });
  return router;
}
