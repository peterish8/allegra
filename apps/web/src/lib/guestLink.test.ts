import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { guestIsGone, guestLinkBackoffMs, linkGuest, type GuestLinkStorage } from './guestLink';

describe('guestIsGone', () => {
  it('replaces the stored guest only when the server says it does not know it', () => {
    assert.equal(guestIsGone(401), true);
    assert.equal(guestIsGone(404), true);
  });

  it('keeps an unmerged guest through an outage or a lost connection', () => {
    assert.equal(guestIsGone(500), false);
    assert.equal(guestIsGone(503), false);
    assert.equal(guestIsGone(undefined), false);
  });
});

function memory(initial: Record<string, string> = {}): GuestLinkStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    removeItem: (key) => { delete data[key]; }
  };
}

describe('linkGuest', () => {
  it('reports none and sends nothing when there is no guest', async () => {
    let posts = 0;
    const result = await linkGuest(memory(), 'k', async () => { posts += 1; });
    assert.equal(result, 'none');
    assert.equal(posts, 0);
  });

  it('keeps the guest token when the request fails, then merges on retry', async () => {
    const storage = memory({ k: 'guest-1' });
    let attempt = 0;
    const post = async (): Promise<void> => {
      attempt += 1;
      if (attempt === 1) throw new Error('network');
    };
    assert.equal(await linkGuest(storage, 'k', post), 'failed');
    assert.equal(storage.data.k, 'guest-1');
    assert.equal(await linkGuest(storage, 'k', post), 'merged');
    assert.equal(storage.data.k, undefined);
  });

  it('sends the stored guest token and removes it only after success', async () => {
    const storage = memory({ k: 'guest-2' });
    let seen = '';
    const result = await linkGuest(storage, 'k', async (token) => {
      seen = token;
      assert.equal(storage.data.k, 'guest-2');
    });
    assert.equal(result, 'merged');
    assert.equal(seen, 'guest-2');
  });

  it('still reports merged when the token cannot be removed', async () => {
    const storage: GuestLinkStorage = {
      getItem: () => 'guest-3',
      removeItem: () => { throw new Error('blocked'); }
    };
    assert.equal(await linkGuest(storage, 'k', async () => undefined), 'merged');
  });

  it('treats unreadable storage as nothing to merge', async () => {
    const storage: GuestLinkStorage = { getItem: () => { throw new Error('blocked'); }, removeItem: () => undefined };
    assert.equal(await linkGuest(storage, 'k', async () => undefined), 'none');
  });
});

describe('guestLinkBackoffMs', () => {
  it('doubles and caps at 30 seconds', () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6].map(guestLinkBackoffMs), [2000, 4000, 8000, 16000, 30000, 30000]);
  });
});
