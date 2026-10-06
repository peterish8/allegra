import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { createLocalVercelGateway } from './local-vercel-gateway.mjs';

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

async function close(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test('gateway sends Vercel API paths to API and preserves Next and Range responses', async () => {
  const api = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/api/stream/sample') {
      response.writeHead(206, { 'accept-ranges': 'bytes', 'content-range': 'bytes 0-2/8', 'content-type': 'audio/mpeg' });
      response.end('abc');
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ success: true, pathname }));
  });
  const next = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<main>web</main>');
  });
  const apiPort = await listen(api);
  const nextPort = await listen(next);
  const gateway = createLocalVercelGateway({ apiPort, nextPort });
  const gatewayPort = await listen(gateway);

  try {
    const origin = `http://127.0.0.1:${gatewayPort}`;
    const search = await fetch(`${origin}/api/search?q=test`);
    assert.deepEqual(await search.json(), { success: true, pathname: '/api/search' });

    const wellKnown = await fetch(`${origin}/.well-known/oauth-protected-resource`);
    assert.deepEqual(await wellKnown.json(), { success: true, pathname: '/.well-known/oauth-protected-resource' });

    const stream = await fetch(`${origin}/api/stream/sample`, { headers: { range: 'bytes=0-2' } });
    assert.equal(stream.status, 206);
    assert.equal(stream.headers.get('content-range'), 'bytes 0-2/8');
    assert.equal(stream.headers.get('accept-ranges'), 'bytes');
    assert.equal(await stream.text(), 'abc');

    const page = await fetch(origin);
    assert.equal(page.headers.get('content-type'), 'text/html');
    assert.equal(await page.text(), '<main>web</main>');
  } finally {
    await Promise.all([close(gateway), close(api), close(next)]);
  }
});
