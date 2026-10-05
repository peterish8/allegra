import { Router, type Response } from 'express';

import type { AuthService } from '../auth/auth.js';
import { IMPORT_MATCH, type ImportMatcher } from '../services/importMatch.js';
import type { ImportedTrack } from '../shared/importParse.js';
import { isPersonalised, type UserData } from '../user/store.js';
import { applyImportSeed, tasteSummary } from '../user/taste.js';
import { callerProfile, sendUnauthorized } from './auth.js';
import { asRecord, sendFailure, sendSuccess } from './common.js';

const MISSING = "Something's missing from that request.";
const NOT_FOUND = "We couldn't find that.";
/** PLAN.md §9 `import.signin`. */
export const IMPORT_SIGNIN = 'Sign in to import your library, so it follows you to every device.';
const TEXT_MAX = 200;
const DURATION_MAX = 7200;
const SEED_ENTRIES_MAX = 500;
const SEED_COUNT_MAX = 100_000;

/**
 * Import from a Spotify data download or a CSV (PLAN.md I3). The file is read in the browser; only
 * title, artist, album and length reach this route, a batch at a time, to be found in the catalog.
 */
export function importsRouter(auth: AuthService, matcher: ImportMatcher, enabled: boolean): Router {
  const router = Router();

  router.post('/import/match', async (request, response) => {
    if (!enabled) {
      response.status(404).json({ success: false, data: null, error: NOT_FOUND });
      return;
    }
    const user = await accountUser(auth, request, response);
    if (!user) return;
    const tracks = parseTracks((request.body as { tracks?: unknown } | undefined)?.tracks);
    if (!tracks) {
      response.status(400).json({ success: false, data: null, error: MISSING });
      return;
    }
    try {
      sendSuccess(response, { results: await matcher.match(tracks) });
    } catch (error) {
      sendFailure(response, error);
    }
  });

  // After an import is saved: its artist counts seed the taste once, at most 25 artists (PLAN.md I6).
  router.post('/me/taste/import-seed', async (request, response) => {
    if (!enabled) {
      response.status(404).json({ success: false, data: null, error: NOT_FOUND });
      return;
    }
    const user = await accountUser(auth, request, response);
    if (!user) return;
    const artists = parseArtistCounts(asRecord(request.body).artists);
    if (!artists) {
      response.status(400).json({ success: false, data: null, error: MISSING });
      return;
    }
    if (!isPersonalised(user)) {
      response.status(204).end();
      return;
    }
    try {
      const saved = await auth.updateProfile(user.userId, (current) =>
        isPersonalised(current) ? { ...current, taste: applyImportSeed(current.taste, artists) } : null, user);
      sendSuccess(response, tasteSummary(saved?.taste));
    } catch (error) {
      sendFailure(response, error);
    }
  });

  return router;
}

/** 1–500 `{ name, count }` with a non-empty name and an integer count, or null. */
function parseArtistCounts(value: unknown): { name: string; count: number }[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > SEED_ENTRIES_MAX) return null;
  const counts: { name: string; count: number }[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) return null;
    const r = raw as Record<string, unknown>;
    const name = text(r.name, true);
    if (!name || typeof r.count !== 'number' || !Number.isInteger(r.count) || r.count < 1 || r.count > SEED_COUNT_MAX) return null;
    counts.push({ name, count: r.count });
  }
  return counts;
}

/** A signed-in account, or null after answering 401 (no session) or 403 (a guest). */
export async function accountUser(auth: AuthService, request: Parameters<typeof callerProfile>[1], response: Response, signinCopy = IMPORT_SIGNIN): Promise<UserData | null> {
  try {
    const user = await callerProfile(auth, request);
    if (!user) {
      sendUnauthorized(response);
      return null;
    }
    if (user.isGuest) {
      response.status(403).json({ success: false, data: null, error: signinCopy });
      return null;
    }
    return user;
  } catch (error) {
    sendFailure(response, error);
    return null;
  }
}

function text(value: unknown, required: boolean): string | null | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length > TEXT_MAX || (required && !trimmed)) return null;
  return trimmed || undefined;
}

/** 1–50 tracks with a title and artist each, or null when anything is off. */
function parseTracks(value: unknown): ImportedTrack[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > IMPORT_MATCH.batchMax) return null;
  const tracks: ImportedTrack[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) return null;
    const r = raw as Record<string, unknown>;
    const title = text(r.title, true);
    const artist = text(r.artist, true);
    const album = text(r.album, false);
    if (!title || !artist || album === null) return null;
    let durationSec: number | undefined;
    if (r.durationSec !== undefined) {
      if (typeof r.durationSec !== 'number' || !Number.isFinite(r.durationSec) || r.durationSec < 0 || r.durationSec > DURATION_MAX) return null;
      durationSec = r.durationSec;
    }
    tracks.push({ title, artist, ...(album ? { album } : {}), ...(durationSec !== undefined ? { durationSec } : {}) });
  }
  return tracks;
}
