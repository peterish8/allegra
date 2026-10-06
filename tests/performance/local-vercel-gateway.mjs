import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const WELL_KNOWN_PATHS = [
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-authorization-server',
];

export function createLocalVercelGateway({ apiPort, nextPort }) {
  return http.createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    const apiPath = pathname === '/api' || pathname.startsWith('/api/')
      || WELL_KNOWN_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
    const port = apiPath ? apiPort : nextPort;
    const upstream = http.request({
      hostname: '127.0.0.1',
      port,
      path: request.url,
      method: request.method,
      headers: { ...request.headers, host: `127.0.0.1:${port}` },
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    });

    upstream.on('error', () => {
      if (response.destroyed) return;
      if (!response.headersSent) response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Local performance upstream unavailable');
    });
    request.on('aborted', () => upstream.destroy());
    response.on('close', () => { if (!response.writableEnded) upstream.destroy(); });
    request.pipe(upstream);
  });
}

function readPort(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) throw new Error(`${name} must be a valid TCP port.`);
  return value;
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (entry === import.meta.url) {
  const server = createLocalVercelGateway({
    apiPort: readPort('PERF_API_PORT', 8082),
    nextPort: readPort('PERF_NEXT_PORT', 5174),
  });
  server.on('error', (error) => {
    process.stderr.write(`Local performance gateway failed: ${error.code ?? 'unknown error'}\n`);
    process.exitCode = 1;
  });
  server.listen(readPort('PERF_GATEWAY_PORT', 5175), '127.0.0.1', () => {
    process.stdout.write(`Local performance gateway ready on 127.0.0.1:${server.address().port}\n`);
  });
}
