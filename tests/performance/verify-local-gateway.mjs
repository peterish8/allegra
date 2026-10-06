import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const query = 'Blinding Lights The Weeknd';
const baseUrl = process.env.PERF_BASE_URL ?? 'http://127.0.0.1:5175';
const outputDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../output/performance/search-to-play');
const response = await fetch(`${baseUrl}/api/search?q=${encodeURIComponent(query)}&limit=20&page=0`, {
  signal: AbortSignal.timeout(30_000),
});
const contentType = response.headers.get('content-type') ?? '';
let envelope = 'not-json';
let resultCount = 0;
if (contentType.includes('application/json')) {
  const body = await response.json().catch(() => null);
  const values = body && typeof body === 'object' ? body : {};
  const data = 'data' in values && values.data && typeof values.data === 'object' ? values.data : {};
  const results = 'results' in data && Array.isArray(data.results) ? data.results : [];
  envelope = values.success === true ? 'success' : values.success === false ? 'failure' : 'invalid';
  resultCount = results.length;
}

const summary = {
  status: response.status,
  contentTypeClass: contentType.includes('application/json') ? 'json' : contentType.includes('text/html') ? 'html' : 'other',
  envelope,
  resultCount,
};
await mkdir(outputDirectory, { recursive: true });
await writeFile(path.join(outputDirectory, 'gateway-route-check.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(summary)}\n`);
if (!response.ok || envelope !== 'success' || resultCount === 0) process.exitCode = 1;
