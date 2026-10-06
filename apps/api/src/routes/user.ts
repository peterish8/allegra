import { Router } from 'express';

import type { AuthService } from '../auth/auth.js';
import type { CatalogService } from '../catalog/catalog.js';
import { parseLanguages } from '../lib/languages.js';
import { MAX_COVER_BYTES, isCoverContentType, looksLikeStorageId, type CoverStorage } from '../lib/covers.js';
import { parseLibraryOps, parseSentAt, type PlaylistCover } from '../shared/library.js';
import { parseSongRef, type SongRef, type SongSnapshot } from '../shared/songRef.js';
import { isListenExit } from '../shared/listenSignal.js';
import type { ListenerActions } from '../user/actions.js';
import type { TasteTally } from '../user/tasteTally.js';
import type { BlendStore } from '../user/blendStore.js';
import { isPersonalised, type UserData } from '../user/store.js';
import { applySeeds, tasteSummary } from '../user/taste.js';
import { callerProfile, sendUnauthorized } from './auth.js';
import { asRecord, positiveInt, sendFailure, sendSuccess, sanitizeSettings, songId } from './common.js';

const MISSING = "Something's missing from that request.";

/**
 * The listener's own data over HTTP. What they do (likes, playlists, plays) is a ListenerActions
 * call (user/actions.ts), the same one the MCP tools and the phone's sync make; these handlers
 * only read the request and shape the reply. Reply shapes are docs/api-contract.md.
 */
export function userRouter(auth: AuthService, catalog: CatalogService, actions: ListenerActions, covers: CoverStorage | undefined, tally: TasteTally, blends?: BlendStore): Router {
  const router = Router();

  router.get('/libraries', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    sendSuccess(response, user.libraries);
  });

  router.post('/libraries', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    const body = asRecord(request.body);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 100) {
      response.status(400).json({ success: false, data: null, error: MISSING });
      return;
    }
    try {
      const description = typeof body.description === 'string' ? body.description : undefined;
      const library = await actions.createPlaylist(user, { name, ...(description ? { description } : {}), isPublic: body.isPublic === true });
      sendSuccess(response, library, 201);
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.patch('/libraries/:id', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    // Checked before touching any upload, so a request for a playlist that isn't there changes nothing.
    if (!user.libraries.some((library) => library.id === request.params.id)) {
      response.status(404).json({ success: false, data: null, error: "We couldn't find that." });
      return;
    }
    const body = asRecord(request.body);

    // A new cover is a Convex storage id the browser just uploaded to. Check what was actually
    // stored before attaching it; anything wrong is deleted, never kept.
    let cover: PlaylistCover | null | undefined;
    if (body.coverKey === null) {
      cover = null;
    } else if (typeof body.coverKey === 'string') {
      const storageId = body.coverKey.trim();
      if (!covers) {
        response.status(503).json({ success: false, data: null, error: 'Cover uploads are not available right now.' });
        return;
      }
      const stored = looksLikeStorageId(storageId) ? await covers.inspect(storageId) : null;
      if (!stored) {
        response.status(400).json({ success: false, data: null, error: MISSING });
        return;
      }
      if (!isCoverContentType(stored.contentType) || stored.size > MAX_COVER_BYTES) {
        await covers.remove(storageId);
        response.status(400).json({ success: false, data: null, error: 'Use a WebP or JPEG image for the cover.' });
        return;
      }
      cover = { key: storageId, url: stored.url };
    }

    try {
      const library = await actions.updatePlaylist(user, String(request.params.id), {
        ...(typeof body.name === 'string' ? { name: body.name } : {}),
        ...(typeof body.description === 'string' ? { description: body.description } : {}),
        ...(typeof body.isPublic === 'boolean' ? { isPublic: body.isPublic } : {}),
        ...(cover !== undefined ? { cover } : {})
      });
      sendSuccess(response, library);
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.delete('/libraries/:id', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    try {
      await actions.deletePlaylist(user, String(request.params.id));
      response.status(204).end();
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.post('/libraries/:id/songs', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    const id = songId(asRecord(request.body).songId);
    if (!id) {
      response.status(404).json({ success: false, data: null, error: "We couldn't find that." });
      return;
    }
    try {
      sendSuccess(response, await actions.addToPlaylist(user, String(request.params.id), id));
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.delete('/libraries/:id/songs/:songId', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    try {
      sendSuccess(response, await actions.removeFromPlaylist(user, String(request.params.id), String(request.params.songId)));
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.get('/me/liked', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    try {
      sendSuccess(response, await catalog.getSongs(user.likedSongIds));
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.post('/me/liked', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    const id = songId(asRecord(request.body).songId);
    if (!id) {
      response.status(400).json({ success: false, data: null, error: MISSING });
      return;
    }
    try {
      await actions.like(user, id);
      sendSuccess(response, { songId: id }, 201);
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.delete('/me/liked/:songId', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    try {
      await actions.unlike(user, String(request.params.songId));
      response.status(204).end();
    } catch (error) {
      sendFailure(response, error);
    }
  });

  // Library sync for the listener's other devices (the phone). Operations in, changes out.
  router.post('/me/library/ops', async (request, response) => {
    // Taken before anything waits on the database: this is the moment the device's clock is compared with.
    const receivedAt = Date.now();
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    const body = asRecord(request.body);
    const ops = parseLibraryOps(body.ops);
    if (!ops) {
      response.status(400).json({ success: false, data: null, error: MISSING });
      return;
    }
    // A `sentAt` that makes no sense is left out rather than refusing the batch: the operations are still good.
    const sentAt = parseSentAt(body.sentAt, receivedAt);
    try {
      sendSuccess(response, await actions.applyFromDevice(user, ops, { receivedAt, ...(sentAt !== undefined ? { sentAt } : {}) }));
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.get('/me/library/changes', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    const sinceRaw = typeof request.query.since === 'string' ? Number.parseInt(request.query.since, 10) : 0;
    const since = Number.isInteger(sinceRaw) && sinceRaw > 0 ? sinceRaw : 0;
    const limit = positiveInt(request.query.limit, 200, 500);
    const resyncContinuation = request.query.resync === 'true';
    try {
      sendSuccess(response, await auth.library.changes(user.userId, since, limit, resyncContinuation));
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.get('/me/recently-played', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    try {
      sendSuccess(response, await actions.recentlyPlayed(user));
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.post('/me/recently-played', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    const body = asRecord(request.body);
    const playback = playbackFrom(body);
    const playDuration = typeof body.playDuration === 'number' && Number.isFinite(body.playDuration) && body.playDuration >= 0 ? body.playDuration : 0;
    if (!playback) {
      response.status(400).json({ success: false, data: null, error: MISSING });
      return;
    }
    try {
      // A phone that played offline sends when it happened; anything else is "now".
      sendSuccess(response, await actions.recordPlay(user, playback.id, playDuration, playedAtFrom(body.playedAt) ?? new Date().toISOString(), playback.ref, playback.song), 201);
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.get('/me/settings', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    sendSuccess(response, user.settings);
  });

  router.patch('/me/settings', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    const body = asRecord(request.body);
    const changed: Record<string, string | number | boolean> = sanitizeSettings(body);
    // Languages arrive as ["hindi", "tamil"] or "hindi,tamil"; stored as a known, ordered list.
    // An empty list means every language.
    if ('languages' in body) changed.languages = parseLanguages(body.languages).join(',');
    try {
      const saved = await auth.updateProfile(user.userId, (current) => {
        const next: UserData = { ...current, settings: { ...sanitizeSettings(current.settings), ...changed } };
        if (changed.personalization !== false) return next;
        // Switching personalisation off withdraws the consent it ran on: what was learned goes too.
        const cleared = { ...next, recentlyPlayed: [] };
        delete cleared.taste;
        return cleared;
      }, user);
      if (changed.personalization === false && !auth.atomicLearningPrivacy) {
        try {
          await tally.clear(user.userId);
        } catch {
          // Learning stays off even if this derived-data cleanup needs to be retried.
        }
      }
      // Blends follow the switch: off, this listener's part uses likes and playlists only (D12).
      if (typeof changed.personalization === 'boolean' && blends && !auth.atomicLearningPrivacy) {
        try {
          await blends.setLearning(user.userId, changed.personalization);
        } catch {
          // The Blend catches up at the next switch; the setting itself is saved.
        }
      }
      sendSuccess(response, sanitizeSettings(saved?.settings ?? {}));
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.get('/me/taste', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    sendSuccess(response, tasteSummary(user.taste));
  });

  // Onboarding: the listener names favourites. Everything after that is learned from behaviour.
  router.post('/me/taste/seed', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    const body = asRecord(request.body);
    const artists = stringList(body.artists, 30);
    const languages = stringList(body.languages, 8);
    // Onboarding's language picks become the language setting; Settings changes it later.
    const picked = parseLanguages(languages);
    try {
      const saved = await auth.updateProfile(user.userId, (current) => ({
        ...current,
        // With personalisation off only the language choice is kept; no taste is built.
        ...(isPersonalised(current) ? { taste: applySeeds(current.taste, artists, languages) } : {}),
        settings: picked.length > 0 ? { ...current.settings, languages: picked.join(',') } : current.settings
      }), user);
      sendSuccess(response, tasteSummary(saved?.taste));
    } catch (error) {
      sendFailure(response, error);
    }
  });

  // How long a song was actually listened to, and how it ended (packages/shared/listenSignal.ts).
  router.post('/me/taste/signal', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    const body = asRecord(request.body);
    const playback = playbackFrom(body);
    const rawSeconds = body.cumulativeSeconds === undefined ? body.seconds : body.cumulativeSeconds;
    const seconds = typeof rawSeconds === 'number' && Number.isFinite(rawSeconds) && rawSeconds >= 0 ? Math.min(rawSeconds, 7200) : null;
    const playedAt = body.playedAt === undefined ? undefined : listenPlayedAtFrom(body.playedAt) ?? null;
    const playId = typeof body.playId === 'string' && body.playId.length <= 128 ? body.playId : undefined;
    if (!playback || seconds === null || playedAt === null) {
      response.status(400).json({ success: false, data: null, error: MISSING });
      return;
    }
    // Optional: how the listen ended. Without it the older seconds-only rule applies.
    const exitPositionSec = typeof body.exitPositionSec === 'number' && Number.isFinite(body.exitPositionSec) && body.exitPositionSec >= 0 ? Math.min(body.exitPositionSec, 7200) : undefined;
    const ending = isListenExit(body.exit) ? { exit: body.exit, ...(exitPositionSec === undefined ? {} : { exitPositionSec }) } : undefined;
    try {
      await actions.listened(user, playback.id, seconds, playback.song, playback.ref, playedAt, playId, ending);
      response.status(204).end();
    } catch (error) {
      sendFailure(response, error);
    }
  });

  return router;
}

function stringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim().slice(0, 80)).filter(Boolean))].slice(0, max);
}

/** The caller's profile, read once; each handler passes it on as the base of whatever it writes. */
async function authenticatedUser(auth: AuthService, request: Parameters<typeof callerProfile>[1], response: Parameters<typeof sendUnauthorized>[0]): Promise<UserData | null> {
  try {
    const user = await callerProfile(auth, request);
    if (!user) sendUnauthorized(response);
    return user;
  } catch (error) {
    sendFailure(response, error);
    return null;
  }
}

/** An ISO time within the last week and not in the future, or null. */
function playedAtFrom(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  const now = Date.now();
  if (!Number.isFinite(time) || time > now + 60_000 || time < now - 7 * 24 * 3600_000) return null;
  return new Date(Math.min(time, now)).toISOString();
}

/** A signal can arrive late from an offline client; old values reach the tally, which ignores them. */
function listenPlayedAtFrom(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return new Date(Math.min(time, Date.now())).toISOString();
}

function playbackFrom(body: Record<string, unknown>): { id: string; ref?: SongRef; song?: SongSnapshot } | null {
  const rawRef = typeof body.songRef === 'string' ? body.songRef : null;
  if (!rawRef) {
    const id = songId(body.songId);
    return id ? { id } : null;
  }
  const parsed = parseSongRef(rawRef);
  if (!parsed) return null;
  const ref = `${parsed.source}:${parsed.id}` as SongRef;
  let song: SongSnapshot | undefined;
  if (body.song !== undefined) {
    if (typeof body.song !== 'object' || body.song === null || Array.isArray(body.song)) return null;
    const candidate = body.song as Record<string, unknown>;
    const title = typeof candidate.title === 'string' ? candidate.title.trim().slice(0, 300) : '';
    const artist = typeof candidate.artist === 'string' ? candidate.artist.trim().slice(0, 300) : '';
    if (!title || candidate.ref !== ref) return null;
    const artwork = typeof candidate.artwork === 'string' && /^https:\/\//i.test(candidate.artwork) ? candidate.artwork.slice(0, 1000) : '';
    const duration = typeof candidate.duration === 'number' && Number.isFinite(candidate.duration) && candidate.duration >= 0 ? Math.min(candidate.duration, 86_400) : null;
    if (duration === null) return null;
    const album = typeof candidate.album === 'string' && candidate.album.trim() ? candidate.album.trim().slice(0, 300) : undefined;
    song = { ref, title, artist, ...(album ? { album } : {}), artwork, duration };
  }
  const id = parsed.source === 'gaana' ? `gaana:${parsed.id}` : parsed.id;
  return { id, ref, ...(song ? { song } : {}) };
}
