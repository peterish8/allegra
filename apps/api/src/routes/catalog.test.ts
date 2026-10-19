import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';
import request from 'supertest';

import { CatalogService } from '../catalog/catalog.js';
import { MemoryCacheStore } from '../lib/cache.js';
import { GaanaProvider } from '../providers/gaana.js';
import { SaavnProvider } from '../providers/saavn.js';
import { catalogRouter } from './catalog.js';

test('GET /api/albums/:id returns the complete official release track list', async () => {
  const catalog = new CatalogService({
    saavn: new SaavnProvider({
      baseUrl: 'https://saavn.example/api',
      fetchImpl: async () => new Response(JSON.stringify({
        success: true,
        data: {
          id: 'album-1',
          name: 'Official album',
          songs: [
            { id: 'track-1', name: 'Opening track', primaryArtists: 'Artist', album: { id: 'album-1', name: 'Official album' }, downloadUrl: [{ quality: '320kbps', url: 'https://cdn.example/track-1.mp4' }] },
            { id: 'track-2', name: 'Closing track', primaryArtists: 'Artist', album: { id: 'album-1', name: 'Official album' }, downloadUrl: [{ quality: '320kbps', url: 'https://cdn.example/track-2.mp4' }] }
          ]
        }
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }),
    gaana: new GaanaProvider({ baseUrl: 'https://gaana.example/api', fetchImpl: fetch }),
    cache: new MemoryCacheStore()
  });
  const app = express().use('/api', catalogRouter(catalog));

  const response = await request(app).get('/api/albums/album-1');

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.deepEqual(response.body.data.map((track: { title: string }) => track.title), ['Opening track', 'Closing track']);
});
