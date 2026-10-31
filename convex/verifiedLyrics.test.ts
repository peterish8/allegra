/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import presenceTest from '@convex-dev/presence/test';
import rateLimiterTest from '@convex-dev/rate-limiter/test';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from './_generated/api';
import schema from './schema';

const modules = { ...import.meta.glob('./**/*.ts'), ...import.meta.glob('./_generated/*.js') };
const secret = 'test-server-secret';

function backend() {
  const t = convexTest(schema, modules);
  presenceTest.register(t);
  rateLimiterTest.register(t);
  return t;
}

const song = { ref: 'saavn:B4-hLCKJ', matchKey: 'mozhiye|sai abhyankkar', title: 'Mozhiye', artist: 'Sai Abhyankkar', duration: 232 };
const version = (script: 'latin' | 'native', confidence: number, lrc = '[00:12.30]<00:12.300>Mozhiye <00:13.100>mozhiye<00:14.000>') => ({
  script,
  language: 'ta',
  lrc,
  source: { name: 'site', url: 'https://example.test/mozhiye' },
  confidence,
  syncedBy: 'listener-1'
});

describe('verified lyrics', () => {
  beforeEach(() => vi.stubEnv('CONVEX_SERVER_SECRET', secret));

  it('refuses callers without the server secret', async () => {
    const t = backend();
    await expect(t.query(api.verifiedLyrics.get, { secret: 'wrong', ref: song.ref })).rejects.toThrow('Unauthorized');
    await expect(t.mutation(api.verifiedLyrics.submit, { secret: 'wrong', song, version: version('latin', 0.8) })).rejects.toThrow('Unauthorized');
  });

  it('stores one version per script, latin first, findable by ref and by match key', async () => {
    const t = backend();
    expect(await t.mutation(api.verifiedLyrics.submit, { secret, song, version: version('native', 0.7) })).toEqual({ saved: true });
    expect(await t.mutation(api.verifiedLyrics.submit, { secret, song, version: version('latin', 0.8) })).toEqual({ saved: true });
    const row = await t.query(api.verifiedLyrics.get, { secret, ref: song.ref });
    expect(row?.versions.map((item) => item.script)).toEqual(['latin', 'native']);
    expect(row?.versions[0]).toMatchObject({ hidden: false, reportedBy: [], confidence: 0.8 });
    expect((await t.query(api.verifiedLyrics.byMatchKey, { secret, matchKey: song.matchKey }))?.ref).toBe(song.ref);
  });

  it('replaces a version only with a more confident sync', async () => {
    const t = backend();
    await t.mutation(api.verifiedLyrics.submit, { secret, song, version: version('latin', 0.8) });
    expect(await t.mutation(api.verifiedLyrics.submit, { secret, song, version: version('latin', 0.6, '[00:01.00]worse') })).toEqual({ saved: false });
    expect(await t.mutation(api.verifiedLyrics.submit, { secret, song, version: version('latin', 0.9, '[00:12.00]better') })).toEqual({ saved: true });
    const row = await t.query(api.verifiedLyrics.get, { secret, ref: song.ref });
    expect(row?.versions).toHaveLength(1);
    expect(row?.versions[0]?.lrc).toBe('[00:12.00]better');
  });

  it('hides a version after three different listeners report it, and the owner can restore it', async () => {
    const t = backend();
    await t.mutation(api.verifiedLyrics.submit, { secret, song, version: version('latin', 0.8) });
    await t.mutation(api.verifiedLyrics.report, { secret, ref: song.ref, script: 'latin', reporter: 'a' });
    // The same listener twice counts once.
    await t.mutation(api.verifiedLyrics.report, { secret, ref: song.ref, script: 'latin', reporter: 'a' });
    expect(await t.mutation(api.verifiedLyrics.report, { secret, ref: song.ref, script: 'latin', reporter: 'b' })).toEqual({ found: true, hidden: false });
    expect(await t.mutation(api.verifiedLyrics.report, { secret, ref: song.ref, script: 'latin', reporter: 'c' })).toEqual({ found: true, hidden: true });
    expect((await t.query(api.verifiedLyrics.get, { secret, ref: song.ref }))?.versions[0]?.hidden).toBe(true);

    // A hidden version can be replaced by a new sync even with lower confidence.
    expect(await t.mutation(api.verifiedLyrics.submit, { secret, song, version: version('latin', 0.5, '[00:12.00]fresh') })).toEqual({ saved: true });
    await t.mutation(api.verifiedLyrics.setHidden, { secret, ref: song.ref, script: 'latin', hidden: true });
    await t.mutation(api.verifiedLyrics.setHidden, { secret, ref: song.ref, script: 'latin', hidden: false });
    expect((await t.query(api.verifiedLyrics.get, { secret, ref: song.ref }))?.versions[0]).toMatchObject({ hidden: false, reportedBy: [], lrc: '[00:12.00]fresh' });
  });

  it('rejects empty, oversized or out-of-range submissions', async () => {
    const t = backend();
    await expect(t.mutation(api.verifiedLyrics.submit, { secret, song, version: version('latin', 0.8, '') })).rejects.toThrow('Invalid lyrics');
    await expect(t.mutation(api.verifiedLyrics.submit, { secret, song, version: version('latin', 0.8, 'x'.repeat(200_001)) })).rejects.toThrow('Invalid lyrics');
    await expect(t.mutation(api.verifiedLyrics.submit, { secret, song, version: version('latin', 1.5) })).rejects.toThrow('Invalid confidence');
  });
});


describe('admin-approved pasted words', () => {
  const candidate = { secret, id: 'a'.repeat(64), ref: song.ref, userId: 'listener-1', language: 'ta', lines: ['First word', 'Second line'] };
  const passcode = 'test-only-admin-passcode';
  beforeEach(async () => {
    vi.stubEnv('CONVEX_SERVER_SECRET', secret);
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(passcode));
    vi.stubEnv('LYRICS_ADMIN_PASSCODE_SHA256', Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join(''));
  });

  it('fails closed without configuration and refuses the wrong server secret or passcode', async () => {
    const t = backend();
    await expect(t.mutation(api.verifiedLyrics.createPasted, { ...candidate, secret: 'wrong', passcode })).rejects.toThrow('Unauthorized');
    expect(await t.mutation(api.verifiedLyrics.createPasted, { ...candidate, passcode: 'wrong' })).toEqual({ allowed: false });
    vi.stubEnv('LYRICS_ADMIN_PASSCODE_SHA256', '');
    expect(await t.mutation(api.verifiedLyrics.createPasted, { ...candidate, passcode })).toEqual({ allowed: false });
    expect(await t.query(api.verifiedLyrics.getPasted, { secret, id: candidate.id, ref: song.ref, userId: candidate.userId })).toBeNull();
  });

  it('persists words privately for the account and recording without persisting the passcode', async () => {
    const t = backend();
    expect(await t.mutation(api.verifiedLyrics.createPasted, { ...candidate, passcode })).toEqual({ allowed: true });
    const args = { secret, id: candidate.id, ref: song.ref, userId: candidate.userId };
    expect(await t.query(api.verifiedLyrics.getPasted, args)).toEqual({ language: 'ta', lines: candidate.lines });
    expect(await t.query(api.verifiedLyrics.getPasted, { ...args, userId: 'other' })).toBeNull();
    expect(await t.query(api.verifiedLyrics.getPasted, { ...args, ref: 'saavn:other' })).toBeNull();
    const rows = await t.run(ctx => ctx.db.query('pastedLyrics').take(10));
    expect(JSON.stringify(rows)).not.toContain(passcode);
    expect(rows[0]).not.toHaveProperty('passcode');
  });

  it('commits failed attempts so repeated guesses are limited even when the next passcode is correct', async () => {
    const t = backend();
    for (let i = 0; i < 5; i++) expect(await t.mutation(api.verifiedLyrics.createPasted, { ...candidate, passcode: 'wrong' })).toEqual({ allowed: false });
    expect(await t.mutation(api.verifiedLyrics.createPasted, { ...candidate, passcode })).toEqual({ allowed: false });
  });
});
