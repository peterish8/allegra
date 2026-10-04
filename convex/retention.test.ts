/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import presenceTest from '@convex-dev/presence/test';
import rateLimiterTest from '@convex-dev/rate-limiter/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { internal } from './_generated/api';
import schema from './schema';

const modules = {
  ...import.meta.glob('./**/*.ts'),
  ...import.meta.glob('./_generated/*.js')
};

const DAY = 24 * 60 * 60 * 1000;

function backend() {
  const t = convexTest(schema, modules);
  presenceTest.register(t);
  rateLimiterTest.register(t);
  return t;
}

type Backend = ReturnType<typeof backend>;

async function insertReport(
  t: Backend,
  input: { code: string; status: 'open' | 'closed'; closedAt?: number }
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('reports', {
      code: input.code,
      ownerId: 'listener',
      libraryId: 'playlist',
      reason: 'other',
      details: 'What happened',
      contact: 'listener@example.test',
      createdAt: Date.parse('2026-09-01T00:00:00.000Z'),
      status: input.status,
      ...(input.closedAt === undefined ? {} : { closedAt: input.closedAt })
    });
  });
}

async function report(t: Backend, code: string) {
  return t.run(async (ctx) => ctx.db.query('reports').withIndex('by_code', (q) => q.eq('code', code)).unique());
}

describe('closed report retention', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-04T00:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('sets closedAt when a share is taken down', async () => {
    const t = backend();
    await t.run(async (ctx) => {
      await ctx.db.insert('shares', { code: 'take-down', ownerId: 'listener', libraryId: 'playlist', createdAt: '2026-09-01T00:00:00.000Z' });
    });
    await insertReport(t, { code: 'take-down', status: 'open' });

    await t.mutation(internal.reports.takeDown, { code: 'take-down' });

    expect(await report(t, 'take-down')).toMatchObject({ status: 'closed', closedAt: Date.now() });
  });

  it('sets closedAt when a report is dismissed', async () => {
    const t = backend();
    await insertReport(t, { code: 'dismiss', status: 'open' });

    await t.mutation(internal.reports.dismiss, { code: 'dismiss' });

    expect(await report(t, 'dismiss')).toMatchObject({ status: 'closed', closedAt: Date.now() });
  });

  it('timestamps an already-closed report that predates the migration', async () => {
    const t = backend();
    await insertReport(t, { code: 'legacy-close', status: 'closed' });

    await t.mutation(internal.reports.dismiss, { code: 'legacy-close' });

    expect(await report(t, 'legacy-close')).toMatchObject({ status: 'closed', closedAt: Date.now() });
  });

  it('backfills legacy closed reports at migration time and leaves them readable for a year', async () => {
    const t = backend();
    await insertReport(t, { code: 'legacy-closed', status: 'closed' });
    await insertReport(t, { code: 'still-open', status: 'open' });

    await t.mutation(internal.retention.backfillClosedReports, { cursor: null });

    expect(await report(t, 'legacy-closed')).toMatchObject({ status: 'closed', closedAt: Date.now(), details: 'What happened', contact: 'listener@example.test' });
    expect(await report(t, 'still-open')).toMatchObject({ status: 'open', details: 'What happened', contact: 'listener@example.test' });
  });

  it('removes contact and details after a year but keeps the report record', async () => {
    const t = backend();
    const now = Date.now();
    await insertReport(t, { code: 'old', status: 'closed', closedAt: now - 366 * DAY });
    await insertReport(t, { code: 'recent', status: 'closed', closedAt: now - 364 * DAY });
    await insertReport(t, { code: 'open', status: 'open' });

    await t.mutation(internal.retention.trimClosedReports, {});

    expect(await report(t, 'old')).toMatchObject({
      code: 'old', reason: 'other', status: 'closed', createdAt: Date.parse('2026-09-01T00:00:00.000Z'), closedAt: now - 366 * DAY
    });
    expect((await report(t, 'old'))?.details).toBeUndefined();
    expect((await report(t, 'old'))?.contact).toBeUndefined();
    expect(await report(t, 'recent')).toMatchObject({ details: 'What happened', contact: 'listener@example.test' });
    expect(await report(t, 'open')).toMatchObject({ details: 'What happened', contact: 'listener@example.test' });
  });

  it('finishes expired reports across bounded pages without reprocessing trimmed rows forever', async () => {
    const t = backend();
    const closedAt = Date.now() - 366 * DAY;
    await t.run(async (ctx) => {
      for (let index = 0; index < 401; index += 1) {
        await ctx.db.insert('reports', {
          code: `old-${index}`,
          ownerId: 'listener',
          libraryId: 'playlist',
          reason: 'other',
          details: 'What happened',
          contact: 'listener@example.test',
          createdAt: Date.parse('2026-09-01T00:00:00.000Z'),
          status: 'closed',
          closedAt
        });
      }
    });

    await t.mutation(internal.retention.trimClosedReports, {});
    await t.finishAllScheduledFunctions(() => { vi.runAllTimers(); });

    for (const code of ['old-0', 'old-200', 'old-400']) {
      expect((await report(t, code))?.details).toBeUndefined();
      expect((await report(t, code))?.contact).toBeUndefined();
    }
  });
});
