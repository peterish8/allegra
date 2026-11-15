import assert from 'node:assert/strict';
import test from 'node:test';

import { currentAiKey, setAiKey, subscribeAiKey } from './aiKeyVault';

test('holds the DJ key in memory and tells subscribers only on a real change', () => {
  let heard = 0;
  const stop = subscribeAiKey(() => { heard += 1; });
  setAiKey({ provider: 'gemini', apiKey: 'k-123456789', model: 'm' });
  setAiKey({ provider: 'gemini', apiKey: 'k-123456789', model: 'm' });
  assert.equal(heard, 1);
  assert.equal(currentAiKey()?.provider, 'gemini');
  setAiKey(null);
  assert.equal(currentAiKey(), null);
  assert.equal(heard, 2);
  stop();
  setAiKey({ provider: 'openai', apiKey: 'k-2', model: 'm' });
  assert.equal(heard, 2);
  setAiKey(null);
});
