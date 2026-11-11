import assert from 'node:assert/strict';
import test from 'node:test';

import { REDACTED_PATHS, serializeRequest } from './logger.js';

test('request log serialization excludes credentials and sensitive query values', () => {
  const requestForLog = {
    id: 9,
    method: 'POST',
    url: '/api/internal/spotify/daily?userId=fixture-user&token=fixture-query-secret',
    remoteAddress: '127.0.0.1',
    headers: {
      authorization: 'Bearer fixture-auth-secret',
      cookie: 'session=fixture-cookie-secret',
      'x-api-key': 'fixture-api-key-secret',
      'x-convex-server-secret': 'fixture-gateway-secret'
    }
  };
  const serialized = JSON.stringify(serializeRequest(requestForLog));
  for (const secret of ['fixture-query-secret', 'fixture-auth-secret', 'fixture-cookie-secret', 'fixture-api-key-secret', 'fixture-gateway-secret']) {
    assert.equal(serialized.includes(secret), false, `request logs must omit ${secret}`);
  }
  assert.ok(REDACTED_PATHS.includes('req.headers["x-convex-server-secret"]'));
  assert.ok(serialized.includes('/api/internal/spotify/daily'));
});
