import assert from 'node:assert/strict';
import test from 'node:test';

import { allowedAuthRedirect } from '../../convex/authRedirect.ts';

const SITE = 'https://allegravibe.vercel.app';

test('the website keeps its own redirects', () => {
  assert.equal(allowedAuthRedirect('/library', SITE), `${SITE}/library`);
  assert.equal(allowedAuthRedirect('?signedIn=1', SITE), `${SITE}/?signedIn=1`);
  assert.equal(allowedAuthRedirect(`${SITE}/settings`, `${SITE}/`), `${SITE}/settings`);
});

test('the phone app may come back to its sign-in link only', () => {
  assert.equal(allowedAuthRedirect('lyricflow://auth', SITE), 'lyricflow://auth');
  assert.equal(allowedAuthRedirect('lyricflow://auth?x=1', SITE), 'lyricflow://auth?x=1');
  assert.throws(() => allowedAuthRedirect('lyricflow://play?q=x', SITE));
  assert.throws(() => allowedAuthRedirect('lyricflow://authx', SITE));
});

test('the desktop callback permits only its exact loopback path and valid port', () => {
  assert.equal(allowedAuthRedirect('http://127.0.0.1:49152/allegra-auth', SITE), 'http://127.0.0.1:49152/allegra-auth');
  for (const bad of [
    'http://localhost:49152/allegra-auth',
    'http://127.0.0.1:0/allegra-auth',
    'http://127.0.0.1:65536/allegra-auth',
    'http://127.0.0.1:49152/allegra-auth/extra',
    'http://127.0.0.1:49152/allegra-auth?next=https://evil.example',
    'http://127.0.0.1.evil.example:49152/allegra-auth',
    'http://127.0.0.1:49152@evil.example/allegra-auth',
  ]) assert.throws(() => allowedAuthRedirect(bad, SITE), bad);
});

test('everything else is refused, including look-alikes', () => {
  for (const bad of [
    'https://evil.example',
    `${SITE}.evil.example/x`,
    '//evil.example/path',
    'javascript:alert(1)',
    'exp://192.168.1.2:8081/--/auth'
  ]) {
    assert.throws(() => allowedAuthRedirect(bad, SITE), bad);
  }
});

test('a relative redirect needs SITE_URL', () => {
  assert.throws(() => allowedAuthRedirect('/x', undefined));
});
