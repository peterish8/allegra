import assert from 'node:assert/strict';
import test from 'node:test';

import { accountDisplayName, isResolvingAccount, recallAccountName, rememberAccountName, type KeyValueStore } from './accountState.ts';

const guest = { isGuest: true };
const member = { isGuest: false };

test('while Convex is still deciding, nobody is called a guest', () => {
  assert.equal(isResolvingAccount({ loading: true, signedIn: false, ready: false, profile: null }), true);
  assert.equal(isResolvingAccount({ loading: true, signedIn: false, ready: true, profile: guest }), true);
});

test('until the first profile has loaded the answer is not known', () => {
  assert.equal(isResolvingAccount({ loading: false, signedIn: false, ready: false, profile: null }), true);
});

test('a Google session whose profile is still the old guest one is still being worked out', () => {
  assert.equal(isResolvingAccount({ loading: false, signedIn: true, ready: true, profile: guest }), true);
  assert.equal(isResolvingAccount({ loading: false, signedIn: true, ready: true, profile: null }), true);
});

test('a settled guest and a settled account are both answers', () => {
  assert.equal(isResolvingAccount({ loading: false, signedIn: false, ready: true, profile: guest }), false);
  assert.equal(isResolvingAccount({ loading: false, signedIn: true, ready: true, profile: member }), false);
});

function memoryStore(): KeyValueStore & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); }
  };
}

test('the last signed-in name is remembered and forgotten', () => {
  const store = memoryStore();
  assert.equal(recallAccountName(store), null);
  rememberAccountName(store, '  Prathick ');
  assert.equal(recallAccountName(store), 'Prathick');
  rememberAccountName(store, null);
  assert.equal(recallAccountName(store), null);
});

test('blocked storage is only a slower first paint', () => {
  const broken: KeyValueStore = {
    getItem: () => { throw new Error('blocked'); },
    setItem: () => { throw new Error('blocked'); },
    removeItem: () => { throw new Error('blocked'); }
  };
  assert.equal(recallAccountName(broken), null);
  assert.doesNotThrow(() => rememberAccountName(broken, 'Prathick'));
  assert.equal(recallAccountName(null), null);
});

test('an account is named by what they chose, then their email, then plainly', () => {
  assert.equal(accountDisplayName({ displayName: ' Prats ', email: 'p@x.com' }), 'Prats');
  assert.equal(accountDisplayName({ displayName: null, email: 'prats@gmail.com' }), 'prats');
  assert.equal(accountDisplayName({}), 'Your account');
});
