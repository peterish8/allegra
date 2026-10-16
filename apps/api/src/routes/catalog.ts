import { Router } from 'express';

import type { CatalogService } from '../catalog/catalog.js';
import { sendFailure, sendSuccess, boundedString, nonNegativeInt, positiveInt, queryString } from './common.js';
import { parseLanguages } from '../lib/languages.js';
import { regionByCode, type IndianRegion } from '../shared/regions.js';

export const SUGGEST_CACHE_CONTROL = 'public, max-age=60, s-maxage=600, stale-while-revalidate=86400';

export function catalogRouter(catalog: CatalogService): Router {
  const router = Router();

  // As-you-type search. Not personal, so the edge may share it between listeners: popular prefixes
  // ("kes", "arij") are typed by many people and answered once per region.
  router.get('/search/suggest', async (request, response) => {
    const query = boundedString(request.query.q);
    if (!query) {
      response.status(400).json({ success: false, data: null, error: "Something's missing from that request." });
      return;
    }
    try {
      const value = await catalog.suggest(query, positiveInt(request.query.limit, 8, 12));
      response.setHeader('Cache-Control', SUGGEST_CACHE_CONTROL);
      sendSuccess(response, value);
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.get('/search', async (request, response) => {
    const query = boundedString(request.query.q);
    if (!query) {
      response.status(400).json({ success: false, data: null, error: "Something's missing from that request." });
      return;
    }
    try {
      const value = await catalog.search(query, positiveInt(request.query.limit, 20, 50), nonNegativeInt(request.query.page, 0, 100));
      sendSuccess(response, value);
    } catch (error) {
      sendFailure(response, error);
    }
  });

  // Albums by name: the catalog's own albums, so a soundtrack and its singles are separate results.
  router.get('/search/albums', async (request, response) => {
    const query = boundedString(request.query.q);
    if (!query) {
      response.status(400).json({ success: false, data: null, error: "Something's missing from that request." });
      return;
    }
    try {
      sendSuccess(response, { results: await catalog.searchAlbums(query, positiveInt(request.query.limit, 8, 20)) });
    } catch (error) {
      sendFailure(response, error);
    }
  });

  // A whole album by the catalog's id (a song's `albumId`).
  router.get('/albums/:id', async (request, response) => {
    const id = queryString(request.params.id);
    if (!id || !/^[A-Za-z0-9_-]{1,40}$/.test(id)) {
      response.status(400).json({ success: false, data: null, error: "Something's missing from that request." });
      return;
    }
    try {
      sendSuccess(response, await catalog.getAlbum(id));
    } catch (error) {
      sendFailure(response, error);
    }
  });

  // Static path first so "faces" is never read as an artist name.
  router.get('/artists/faces', async (request, response) => {
    const names = queryString(request.query.names)?.split(',').map((name) => name.trim()).filter(Boolean) ?? [];
    if (names.length === 0 || names.length > 12) {
      response.status(400).json({ success: false, data: null, error: "Something's missing from that request." });
      return;
    }
    try {
      sendSuccess(response, await catalog.getArtistFaces(names));
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.get('/artists/:name', async (request, response) => {
    const name = boundedString(request.params.name);
    if (!name) {
      response.status(400).json({ success: false, data: null, error: "Something's missing from that request." });
      return;
    }
    try {
      sendSuccess(response, await catalog.getArtist(name));
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.get('/songs', async (request, response) => {
    const ids = queryString(request.query.ids)?.split(',').map((id) => id.trim()).filter(Boolean) ?? [];
    if (ids.length === 0 || ids.length > 50) {
      response.status(400).json({ success: false, data: null, error: "Something's missing from that request." });
      return;
    }
    try {
      sendSuccess(response, await catalog.getSongs(ids));
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.get('/songs/:id/suggestions', async (request, response) => {
    const id = queryString(request.params.id);
    if (!id) {
      response.status(400).json({ success: false, data: null, error: "Something's missing from that request." });
      return;
    }
    try {
      sendSuccess(response, await catalog.getSuggestions(id, positiveInt(request.query.limit, 15, 30), parseLanguages(request.query.languages)));
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.get('/songs/:id', async (request, response) => {
    const id = queryString(request.params.id);
    if (!id) {
      response.status(400).json({ success: false, data: null, error: "Something's missing from that request." });
      return;
    }
    try {
      sendSuccess(response, await catalog.getSong(id));
    } catch (error) {
      sendFailure(response, error);
    }
  });

  // `languages`: the listener's, for every shelf. `region`: a state code for the Top 10, `IN` for all of
  // India, or absent to use where the request comes from (Vercel's geo headers; never stored).
  router.get('/home', async (request, response) => {
    try {
      const region = homeRegion(request.query.region, request.header('x-vercel-ip-country'), request.header('x-vercel-ip-country-region'));
      sendSuccess(response, await catalog.getHome(parseLanguages(request.query.languages), region ? { region: region.code, regionName: region.name, language: region.language } : null));
    } catch (error) {
      sendFailure(response, error);
    }
  });

  return router;
}

/** The state whose chart Top 10 shows: the one asked for, else where the request comes from in India. */
export function homeRegion(asked: unknown, country: string | undefined, subdivision: string | undefined): IndianRegion | null {
  if (typeof asked === 'string' && asked.trim() !== '' && asked.trim().toLowerCase() !== 'auto') return regionByCode(asked);
  return country?.toUpperCase() === 'IN' ? regionByCode(subdivision) : null;
}
