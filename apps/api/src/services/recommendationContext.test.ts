import assert from 'node:assert/strict';
import test from 'node:test';

import { createServices } from '../services.js';
import { buildRecommendationInput } from './recommendationContext.js';

const primary = {
  id: 'g1',
  name: 'Played Gaana Song',
  primaryArtists: 'Gaana Artist',
  duration: 180,
  image: [{ quality: '500x500', url: 'https://img.example/g1.jpg' }],
  downloadUrl: [{ quality: '320kbps', url: 'https://cdn.example/g1.mp4' }]
};
const recommendation = {
  ...primary,
  id: 'g2',
  name: 'Recommended Gaana Song',
  image: [{ quality: '500x500', url: 'https://img.example/g2.jpg' }],
  downloadUrl: [{ quality: '320kbps', url: 'https://cdn.example/g2.mp4' }]
};

test('a Gaana play becomes a provider-aware recommendation seed and its own provider suggestions', async () => {
  const urls: string[] = [];
  const services = createServices({
    jwtSecret: 'test-secret',
    saavnApiUrl: 'https://saavn.example/api',
    gaanaApiUrl: 'https://gaana.example/api',
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      urls.push(url.toString());
      if (url.host === 'gaana.example' && url.pathname.endsWith('/songs/g1/suggestions')) {
        return json({ success: true, data: { results: [recommendation] } });
      }
      if (url.host === 'gaana.example' && url.pathname.endsWith('/songs/g1')) {
        return json({ success: true, data: primary });
      }
      if (url.pathname.endsWith('/search/artists')) return json({ success: true, data: { results: [] } });
      return json({ success: true, data: { results: [] } });
    }
  });
  const { userId } = await services.auth.createGuest();
  const user = await services.auth.getUser(userId);
  assert.ok(user);
  await services.actions.recordPlay(user, 'gaana:g1', 150, '2026-09-30T08:15:00.000Z', 'gaana:g1', {
    ref: 'gaana:g1', title: 'Played Gaana Song', artist: 'Gaana Artist', artwork: 'https://img.example/g1.jpg', duration: 180
  });
  const saved = await services.auth.getUser(userId);
  assert.ok(saved);

  const { context, excludeIds, excludeSongs } = await buildRecommendationInput(services.catalog, saved);
  assert.equal(context.seeds[0]?.id, 'gaana:g1');
  assert.equal(context.seeds[0]?.source, 'Gaana');
  assert.equal(excludeIds.has('gaana:g1'), true);
  assert.ok(excludeSongs.some((song) => song.id === 'gaana:g1'));

  const picked = await services.recommendations.recommend(context, excludeIds, excludeSongs);
  assert.equal(picked?.songs[0]?.title, 'Recommended Gaana Song');
  assert.equal(picked?.songs[0]?.source, 'Gaana');
  assert.ok(urls.some((url) => url.includes('gaana.example/api/songs/g1/suggestions')));
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
