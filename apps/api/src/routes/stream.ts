import { Router } from 'express';

import { correlationId } from '../lib/diagnostics.js';
import type { StreamResolver } from '../lib/streamResolver.js';
import { sendFailure, songId } from './common.js';

export function streamRouter(stream: StreamResolver): Router {
  const router = Router();
  router.get('/stream/:songId', async (request, response) => {
    const id = songId(request.params.songId);
    if (!id) {
      response.status(400).json({ success: false, data: null, error: "Something's missing from that request." });
      return;
    }
    try {
      await stream.pipe(id, request.header('range'), response, correlationId('str', request.header('x-vercel-id')));
    } catch (error) {
      sendFailure(response, error);
    }
  });
  return router;
}
