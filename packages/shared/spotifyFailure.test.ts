import assert from 'node:assert/strict';
import test from 'node:test';
import { spotifyFailureMessage } from './spotify.ts';

test('each failed Spotify sign-in reason says what to do next', () => {
  assert.match(spotifyFailureMessage('not_allowed'), /invited Spotify accounts/);
  assert.match(spotifyFailureMessage('not_allowed'), /data download or a CSV/);
  assert.match(spotifyFailureMessage('expired'), /already been used or expired/);
  assert.match(spotifyFailureMessage('unavailable'), /busy/);
  assert.equal(spotifyFailureMessage('failed'), 'Spotify connection failed. Try connecting again.');
  // An older API (no reason) or an unknown word reads as before.
  assert.equal(spotifyFailureMessage(null), 'Spotify connection failed. Try connecting again.');
  assert.equal(spotifyFailureMessage('<script>'), 'Spotify connection failed. Try connecting again.');
});
