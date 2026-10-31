import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { expect, test, type Browser, type Page, type Request, type Response } from '@playwright/test';

const QUERY = 'Blinding Lights The Weeknd';
const OUTPUT_DIR = path.resolve(process.cwd(), 'output/performance/search-to-play');
/** No single step may wait longer than this; a stuck step is recorded as a failed sample. */
const STEP_TIMEOUT_MS = 20_000;
const SAMPLE_COUNT = Math.max(1, Math.min(20, Number.parseInt(process.env.PERF_SAMPLES ?? '20', 10) || 20));

interface SearchSong {
  readonly id: string;
  readonly title: string;
  readonly artist: string;
}

interface SearchEnvelope {
  readonly success?: boolean;
  readonly data?: { readonly results?: unknown };
}

interface RequestTiming {
  readonly route: string;
  readonly method: string;
  readonly status?: number;
  readonly durationMs: number;
}

interface SearchResponseSummary {
  readonly status: number;
  readonly contentTypeIsJson: boolean;
  readonly envelope: 'success' | 'failure' | 'invalid';
  readonly rawResultCount: number;
  readonly parsedResultCount: number;
}

interface BrowserMilestones {
  finalQueryChangeAtMs?: number;
  resultsPresentedProxyAtMs?: number;
  optionClickAtMs?: number;
  audioProgressObservedAtMs?: number;
}

interface SampleResult {
  readonly sample: number;
  readonly browserContext: 'new-context';
  readonly backendCache: 'unknown';
  readonly resultCount?: number;
  readonly searchResponse?: SearchResponseSummary;
  readonly selected?: { readonly id: string; readonly title: string; readonly artist: string };
  readonly requestTimings: readonly RequestTiming[];
  readonly browserMilestones: BrowserMilestones;
  readonly trace: readonly unknown[];
  readonly failure?: string;
}

function parseSongs(value: unknown): SearchSong[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): SearchSong[] => {
    if (!entry || typeof entry !== 'object') return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.id !== 'string' || typeof record.title !== 'string' || typeof record.artist !== 'string') return [];
    return [{ id: record.id, title: record.title, artist: record.artist }];
  });
}

function safeApiRoute(request: Request): string | null {
  const url = new URL(request.url());
  if (!url.pathname.startsWith('/api/')) return null;
  if (url.pathname === '/api/search' || url.pathname === '/api/search/suggest') return url.pathname;
  if (url.pathname.startsWith('/api/stream/')) return '/api/stream/:songId';
  return '/api/other';
}

interface TraceGlobal {
  snapshot(): readonly unknown[];
  recordResultsPresented(): boolean;
}

/** A new context is a first visit: the onboarding opens shortly after load and covers the page. */
async function dismissFirstVisitDialog(page: Page): Promise<void> {
  const dismiss = page.getByRole('button', { name: /^(Not now|Skip for now)$/ }).first();
  if (await dismiss.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true, () => false)) {
    await dismiss.click({ timeout: STEP_TIMEOUT_MS });
    await dismiss.waitFor({ state: 'hidden', timeout: STEP_TIMEOUT_MS }).catch(() => undefined);
  }
}

async function runSample(browser: Browser, sample: number): Promise<SampleResult> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await context.addInitScript((targetLength: number) => {
    const milestones: {
      finalQueryChangeAtMs?: number;
      resultsPresentedProxyAtMs?: number;
      optionClickAtMs?: number;
      audioProgressObservedAtMs?: number;
    } = {};
    Object.defineProperty(window, '__allegraPerfHarness', { configurable: false, value: milestones });
    window.addEventListener('input', (event) => {
      const input = event.target;
      if (input instanceof HTMLInputElement && input.getAttribute('role') === 'combobox' && input.value.length === targetLength) {
        milestones.finalQueryChangeAtMs = performance.now();
      }
    }, true);
    document.addEventListener('click', (event) => {
      const option = (event.target as Element | null)?.closest('[role="option"]');
      if (option?.closest('[role="group"]')?.getAttribute('aria-label') === 'Songs' && milestones.optionClickAtMs === undefined) {
        milestones.optionClickAtMs = performance.now();
      }
    }, true);
    const attachAudioObserver = (): void => {
      const audio = document.querySelector('audio');
      if (!audio || observedAudio.has(audio)) return;
      observedAudio.add(audio);
      audio.addEventListener('timeupdate', () => {
        if (!audio.paused && !audio.seeking && !audio.muted && audio.volume > 0 && audio.currentTime > 0.25 && milestones.audioProgressObservedAtMs === undefined) {
          milestones.audioProgressObservedAtMs = performance.now();
        }
      });
    };
    const observedAudio = new WeakSet<HTMLAudioElement>();
    new MutationObserver(attachAudioObserver).observe(document, { childList: true, subtree: true });
    attachAudioObserver();
  }, QUERY.length);
  const page = await context.newPage();
  const pendingRequests = new Map<Request, { readonly route: string; readonly method: string; readonly start: number }>();
  const requestTimings: RequestTiming[] = [];
  let phase = 'navigation';
  let resultCount: number | undefined;
  let searchResponse: SearchResponseSummary | undefined;
  let selected: SampleResult['selected'];

  page.on('request', (request) => {
    const route = safeApiRoute(request);
    if (route) pendingRequests.set(request, { route, method: request.method(), start: performance.now() });
  });
  page.on('response', (response) => {
    const pending = pendingRequests.get(response.request());
    if (!pending) return;
    pendingRequests.delete(response.request());
    requestTimings.push({
      route: pending.route,
      method: pending.method,
      status: response.status(),
      durationMs: Math.max(0, performance.now() - pending.start),
    });
  });
  page.on('requestfailed', (request) => {
    const pending = pendingRequests.get(request);
    if (!pending) return;
    pendingRequests.delete(request);
    requestTimings.push({ route: pending.route, method: pending.method, durationMs: Math.max(0, performance.now() - pending.start) });
  });

  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await dismissFirstVisitDialog(page);
    phase = 'open-search';
    const searchButton = page.getByRole('button', { name: 'Search music' }).first();
    await searchButton.waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
    await searchButton.click({ timeout: STEP_TIMEOUT_MS });
    const input = page.getByRole('combobox');
    await expect(input).toBeVisible({ timeout: STEP_TIMEOUT_MS });

    phase = 'search-response';
    const responsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/api/search/suggest' && url.searchParams.get('q') === QUERY;
    }, { timeout: 30_000 });
    await input.pressSequentially(QUERY, { delay: 35 });
    const response = await responsePromise;
    let body: SearchEnvelope;
    try {
      body = await response.json() as SearchEnvelope;
    } catch {
      return { sample, browserContext: 'new-context', backendCache: 'unknown', requestTimings, browserMilestones: await readMilestones(page), trace: await readTrace(page), failure: 'invalid-json', searchResponse: { status: response.status(), contentTypeIsJson: (response.headers()['content-type'] ?? '').includes('application/json'), envelope: 'invalid', rawResultCount: 0, parsedResultCount: 0 } };
    }
    const songs = parseSongs(body.data?.results);
    resultCount = songs.length;
    const rawResultCount = Array.isArray(body.data?.results) ? body.data.results.length : 0;
    searchResponse = {
      status: response.status(),
      contentTypeIsJson: (response.headers()['content-type'] ?? '').includes('application/json'),
      envelope: body.success === true ? 'success' : body.success === false ? 'failure' : 'invalid',
      rawResultCount,
      parsedResultCount: songs.length,
    };
    if (!response.ok() || body.success !== true || songs.length === 0) {
      const failure = !response.ok() ? 'search-http-error' : body.success === false ? 'api-envelope-failure' : body.success !== true ? 'invalid-envelope' : 'no-results';
      return { sample, browserContext: 'new-context', backendCache: 'unknown', resultCount, searchResponse, requestTimings, browserMilestones: await readMilestones(page), trace: await readTrace(page), failure };
    }

    phase = 'results-visible';
    const songGroup = page.getByRole('group', { name: 'Songs', exact: true });
    const firstSong = songGroup.getByRole('option').first();
    await expect(firstSong).toBeVisible({ timeout: STEP_TIMEOUT_MS });
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    await page.evaluate(() => {
      const harness = (window as Window & { __allegraPerfHarness?: BrowserMilestones }).__allegraPerfHarness;
      if (harness) harness.resultsPresentedProxyAtMs = performance.now();
      const trace = (window as Window & { allegraPerformanceTrace?: TraceGlobal }).allegraPerformanceTrace;
      trace?.recordResultsPresented();
    });

    const firstTitle = songs[0]?.title;
    const firstArtist = songs[0]?.artist;
    if (!firstTitle || !firstArtist) throw new Error('provider result identity was incomplete');
    selected = { id: songs[0]!.id, title: firstTitle, artist: firstArtist };

    phase = 'selection-and-playback';
    await firstSong.click({ timeout: STEP_TIMEOUT_MS });
    await page.waitForFunction(() => {
      const audio = document.querySelector('audio');
      return Boolean(audio && !audio.paused && audio.currentTime > 0 && audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA);
    }, undefined, { timeout: 25_000 });

    return { sample, browserContext: 'new-context', backendCache: 'unknown', resultCount, ...(searchResponse ? { searchResponse } : {}), selected, requestTimings, browserMilestones: await readMilestones(page), trace: await readTrace(page) };
  } catch (error) {
    await page.screenshot({ path: path.join(OUTPUT_DIR, `failure-sample-${sample}-${phase}.png`) }).catch(() => undefined);
    const failureCause = error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : error instanceof SyntaxError ? 'invalid-json' : 'unexpected-error';
    return { sample, browserContext: 'new-context', backendCache: 'unknown', ...(resultCount === undefined ? {} : { resultCount }), ...(searchResponse ? { searchResponse } : {}), ...(selected ? { selected } : {}), requestTimings, browserMilestones: await readMilestones(page), trace: await readTrace(page), failure: phase, failureCause };
  } finally {
    await context.close();
  }
}

async function readTrace(page: Page): Promise<readonly unknown[]> {
  return page.evaluate(() => {
    const trace = (window as Window & { allegraPerformanceTrace?: TraceGlobal }).allegraPerformanceTrace;
    return trace?.snapshot() ?? [];
  }).catch(() => []);
}

async function readMilestones(page: Page): Promise<BrowserMilestones> {
  return page.evaluate(() => (window as Window & { __allegraPerfHarness?: BrowserMilestones }).__allegraPerfHarness ?? {}).catch(() => ({}));
}

test('records serial web search-to-visible-result and actual element progress', async ({ browser }) => {
  const samples: SampleResult[] = [];
  await mkdir(OUTPUT_DIR, { recursive: true });
  try {
    for (let index = 1; index <= SAMPLE_COUNT; index += 1) {
      const sample = await runSample(browser, index);
      samples.push(sample);
      if (sample.failure) break;
      // A fixed pause prevents a tight loop from adding load to the provider.
      if (index < SAMPLE_COUNT) await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  } finally {
    const label = process.env.PERF_RUN_LABEL === 'untraced' ? 'untraced' : 'traced';
    await writeFile(path.join(OUTPUT_DIR, `web-runs-${label}.json`), `${JSON.stringify({ query: QUERY, requestedSamples: SAMPLE_COUNT, attemptedSamples: samples.length, stoppedAfterFirstFailure: samples.some((sample) => Boolean(sample.failure)), browser: 'Playwright Chromium', viewport: '1280x860', cacheCondition: 'new browser context per sample; backend/provider cache unknown', samples }, null, 2)}\n`, 'utf8');
  }
  expect(samples.some((sample) => !sample.failure), 'at least one complete browser journey should succeed').toBe(true);
});
