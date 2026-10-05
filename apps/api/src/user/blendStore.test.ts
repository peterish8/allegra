import assert from 'node:assert/strict';
import test from 'node:test';

import { BLEND_MAX_MEMBERS, BLEND_MAX_PER_USER } from '../shared/blendLimits.js';
import { BlendError, MemoryBlendStore } from './blendStore.js';

const DAY = 24 * 60 * 60 * 1000;
const consent = { policyVersion: '2026-10-05', at: 1 };
let counter = 0;
const code = (): string => `abcdefgh${String(counter++).padStart(4, '2').replace(/[01]/g, 'k')}`.slice(0, 12);

function store(start = Date.UTC(2026, 9, 5)) {
  let now = start;
  const blends = new MemoryBlendStore(() => now);
  return { blends, advance: (ms: number) => { now += ms; }, now: () => now };
}
const create = (s: MemoryBlendStore, userId: string, name = 'Ours') => s.create({ userId, displayName: userId, name, consent, learning: true, code: code() });
const join = (s: MemoryBlendStore, invite: string, userId: string) => s.join({ code: invite, userId, displayName: userId, consent, learning: true });
async function codeOf(call: Promise<unknown>): Promise<string | undefined> {
  try {
    await call;
  } catch (error) {
    if (error instanceof BlendError) return error.code;
    throw error;
  }
  return undefined;
}

test('a full Blend refuses another member', async () => {
  const { blends, advance } = store();
  const blend = await create(blends, 'asha');
  for (let n = 1; n < BLEND_MAX_MEMBERS; n++) {
    advance(1000);
    await join(blends, blend.code, `member${n}`);
  }
  assert.equal(await codeOf(join(blends, blend.code, 'one-too-many')), 'full');
  await blends.leave(blend.blendId, 'asha');
  assert.equal((await blends.get(blend.blendId, 'member1'))?.ownerId, 'member1');
  assert.equal((await blends.get(blend.blendId, 'member1'))?.memberCount, BLEND_MAX_MEMBERS - 1);
});

test('a 21st Blend, created or joined, is refused with limit', async () => {
  const { blends } = store();
  for (let n = 0; n < BLEND_MAX_PER_USER; n++) await create(blends, 'asha', `B${n}`);
  assert.equal(await codeOf(create(blends, 'asha')), 'limit');
  const other = await create(blends, 'ravi');
  assert.equal(await codeOf(join(blends, other.code, 'asha')), 'limit');
});

test('create replay returns the committed Blend and rejects a key reused with different input', async () => {
  const { blends } = store();
  const input = { userId: 'asha', displayName: 'Asha', name: 'Road trip', consent, learning: true, code: code(), operationId: 'request-abcdefghijkl' };
  const first = await blends.create(input);
  assert.deepEqual(await blends.create({ ...input, code: code() }), first);
  assert.equal((await blends.listForUser('asha')).length, 1);
  assert.equal(await codeOf(blends.create({ ...input, name: 'Different' })), 'invalid');
});

test('joining twice returns the Blend; an owner leaving hands it on; the last leaving deletes it', async () => {
  const { blends, advance } = store();
  const blend = await create(blends, 'asha');
  advance(1000);
  await join(blends, blend.code, 'ravi');
  assert.deepEqual(await join(blends, blend.code, 'ravi'), { blendId: blend.blendId });
  await blends.leave(blend.blendId, 'asha');
  const after = await blends.get(blend.blendId, 'ravi');
  assert.equal(after?.ownerId, 'ravi');
  assert.equal(after?.stale, true);
  await blends.leave(blend.blendId, 'ravi');
  assert.equal(await blends.get(blend.blendId, 'ravi'), null);
  assert.deepEqual(await blends.preview(blend.code, Date.UTC(2026, 9, 5)), { status: 'notfound' });
});

test('invite reuses the live link; regenerating expires the old one; previews never say why a code fails', async () => {
  const { blends, now } = store();
  const blend = await create(blends, 'asha');
  assert.equal((await blends.invite(blend.blendId, 'asha', code(), false)).code, blend.code);
  const fresh = await blends.invite(blend.blendId, 'asha', code(), true);
  assert.equal(await codeOf(join(blends, blend.code, 'ravi')), 'expired');
  assert.deepEqual(await blends.preview(blend.code, now()), { status: 'notfound' });
  assert.deepEqual(await blends.preview('NOT-A-CODE', now()), { status: 'notfound' });
  assert.deepEqual(await blends.preview(fresh.code, now()), { status: 'ok', blendId: blend.blendId, inviterName: 'asha', memberCount: 1, full: false });
  assert.deepEqual(await blends.preview(fresh.code, now() + 8 * DAY), { status: 'notfound' });
  assert.equal(await codeOf(blends.invite(blend.blendId, 'stranger', code(), false)), 'notfound');
});

test('saveBuild is compare-and-set and keeps the last two builds', async () => {
  const { blends } = store();
  const blend = await create(blends, 'asha');
  const tracks = (ids: string[]) => ids.map((id) => ({ song: { ref: `saavn:${id}` as const, title: id, artist: 'x', artwork: '', duration: 1 }, for: [], kind: 'discovery' as const }));
  const build = (version: number, identities: string[]) => ({ blendId: blend.blendId, builtFor: '2026-10-05', expectedVersion: version, expectedInputVersion: 0, tracks: tracks(identities), pairs: [], gifts: [], glue: [], identities });
  assert.deepEqual(await blends.saveBuild(build(0, ['a', 'b'])), { saved: true });
  assert.deepEqual(await blends.saveBuild(build(0, ['c'])), { saved: false });
  await blends.saveBuild(build(1, ['c']));
  await blends.saveBuild(build(2, ['d']));
  const stored = await blends.get(blend.blendId, 'asha');
  assert.deepEqual(stored?.previousTracks, ['d', 'c']);
  assert.equal(stored?.stale, false);
});

test('build lease serializes same-version builders and a membership change fences publication', async () => {
  const { blends, now } = store();
  const blend = await create(blends, 'asha');
  const claim = { blendId: blend.blendId, userId: 'asha', inputVersion: 0, builtFor: '2026-10-05', token: 'lease-a', leaseUntil: now() + 30_000 };
  assert.deepEqual(await blends.claimBuild(claim), { claimed: true });
  assert.deepEqual(await blends.claimBuild({ ...claim, token: 'lease-b' }), { claimed: false });
  await join(blends, blend.code, 'ravi');
  assert.deepEqual(await blends.saveBuild({ blendId: blend.blendId, expectedVersion: 0, expectedInputVersion: 0, leaseToken: 'lease-a', builtFor: '2026-10-05', tracks: [], pairs: [], gifts: [], glue: [], identities: [] }), { saved: false });
});

test('learning follows the listener into every Blend and marks it stale; forget leaves them all', async () => {
  const { blends } = store();
  const first = await create(blends, 'asha');
  await join(blends, first.code, 'ravi');
  await blends.setLearning('ravi', false);
  const stored = await blends.get(first.blendId, 'asha');
  assert.equal(stored?.members.find((member) => member.userId === 'ravi')?.learning, false);
  await blends.forget('ravi');
  assert.equal((await blends.get(first.blendId, 'asha'))?.memberCount, 1);
  assert.deepEqual(await blends.listForUser('ravi'), []);
});

test('only the owner renames; a non-owner hears notfound; a blank name is invalid', async () => {
  const { blends } = store();
  const blend = await create(blends, 'asha');
  await join(blends, blend.code, 'ravi');
  await blends.rename(blend.blendId, 'asha', ' Road  trip ');
  assert.equal((await blends.get(blend.blendId, 'asha'))?.name, 'Road trip');
  assert.equal(await codeOf(blends.rename(blend.blendId, 'ravi', 'x')), 'notfound');
  assert.equal(await codeOf(blends.rename(blend.blendId, 'asha', '  ')), 'invalid');
});
