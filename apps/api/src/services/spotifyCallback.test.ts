import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import request from 'supertest';

import type { AuthService } from '../auth/auth.js';
import { SpotifyStore } from '../db/spotifyStore.js';
import { SpotifyApiError, type SpotifyProvider } from '../providers/spotify.js';
import { spotifyRouter } from '../routes/spotify.js';
import type { ImportMatcher } from './importMatch.js';
import { SpotifyCallbackError, SpotifyTransferService, spotifyFailureReason } from './spotifyTransfer.js';

// Owner report, 2026-11-07: a friend's Spotify sign-in ended on "Spotify connection failed" with no reason anywhere.
// The callback swallowed every error, logged nothing, and sent an app-started sign-in to the website.

test('failure reasons are fixed words the website and app can explain', () => {
  assert.equal(spotifyFailureReason(new SpotifyApiError(403, 'not on the allowed list')), 'not_allowed');
  assert.equal(spotifyFailureReason(new SpotifyApiError(400, 'This Spotify connection link expired. Start again.')), 'expired');
  assert.equal(spotifyFailureReason(new SpotifyApiError(429, 'slow down')), 'unavailable');
  assert.equal(spotifyFailureReason(new SpotifyApiError(503, 'down')), 'unavailable');
  assert.equal(spotifyFailureReason(new SpotifyApiError(400, 'invalid_grant')), 'failed');
  assert.equal(spotifyFailureReason(new Error('boom')), 'failed');
  assert.equal(spotifyFailureReason(new SpotifyCallbackError(new SpotifyApiError(403, 'x'), 'mobile')), 'not_allowed');
});

function service(me: () => Promise<{ id: string }>) {
  const provider = {
    exchangeCode: async () => ({ accessToken: 'a', refreshToken: 'r', expiresIn: 3600 }),
    me,
  } as unknown as SpotifyProvider;
  const store = new SpotifyStore(undefined, 'test-secret-0123456789');
  return new SpotifyTransferService(provider, 'client', 'https://allegra.test/api/spotify/callback', store, {} as AuthService, {} as ImportMatcher);
}

const stateOf = (url: string): string => new URL(url).searchParams.get('state') ?? '';

test('a Spotify account that is not allowed fails with its cause and where the sign-in started', async () => {
  const spotify = service(async () => { throw new SpotifyApiError(403, 'Spotify only shares playlists you own'); });
  const state = stateOf(await spotify.connect('user_1', 'mobile'));
  await assert.rejects(spotify.callback('code', state), (error: unknown) => {
    assert.ok(error instanceof SpotifyCallbackError);
    assert.equal(error.returnTo, 'mobile');
    assert.equal(spotifyFailureReason(error), 'not_allowed');
    return true;
  });
});

test('a working sign-in still connects and returns to where it started', async () => {
  const spotify = service(async () => ({ id: 'spotify_user' }));
  const state = stateOf(await spotify.connect('user_1', 'web'));
  assert.equal(await spotify.callback('code', state), 'web');
});

function app(callback: () => Promise<'web' | 'mobile'>) {
  const fake = { webReturnUrl: 'https://allegra.test/import', callback, cancel: callback } as unknown as SpotifyTransferService;
  const server = express();
  server.use('/api', spotifyRouter(fake, {} as AuthService));
  return server;
}

test('the callback redirects with the reason, back to the app when the app started it', async () => {
  const notAllowed = await request(app(async () => { throw new SpotifyCallbackError(new SpotifyApiError(403, 'x'), 'mobile'); }))
    .get('/api/spotify/callback?state=s&code=c');
  assert.equal(notAllowed.status, 303);
  assert.equal(notAllowed.headers.location, 'lyricflow://open/import?spotify=failed&reason=not_allowed');

  const expired = await request(app(async () => { throw new SpotifyApiError(400, 'This Spotify connection link expired. Start again.'); }))
    .get('/api/spotify/callback?state=s&code=c');
  assert.equal(expired.headers.location, 'https://allegra.test/import?spotify=failed&reason=expired');

  const noState = await request(app(async () => 'web')).get('/api/spotify/callback');
  assert.equal(noState.headers.location, 'https://allegra.test/import?spotify=failed&reason=failed');

  const ok = await request(app(async () => 'mobile')).get('/api/spotify/callback?state=s&code=c');
  assert.equal(ok.headers.location, 'lyricflow://open/import?spotify=connected');
});
