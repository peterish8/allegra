import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { CHUNK_JSON_MAX, ImportPlanError, planImportOps, playlistIdFor, saveImport, saveImportResumable, utf8ByteLength } from './importPlan.ts';
import { LIBRARY_OPS_MAX, type LibraryOp } from './library.ts';
import { sha256Hex } from './sha256.ts';
import type { SongRef, SongSnapshot } from './songRef.ts';

test('sha256Hex matches the standard test vectors', () => {
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'), '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  for (const text of ['ç¥ ❤ 🎵', 'spotify-export:Road trip', 'x'.repeat(1000)]) assert.equal(sha256Hex(text), createHash('sha256').update(text, 'utf8').digest('hex'));
});

const song = (n: number, long = false): SongSnapshot => ({
  ref: `saavn:s${n}` as SongRef,
  title: long ? `A very long imported title number ${n} ${'x'.repeat(200)}` : `Song ${n}`,
  artist: long ? `Artist ${'y'.repeat(200)}` : 'Artist',
  artwork: 'https://c.saavncdn.com/x.jpg',
  duration: 200
});

test('1,000 likes with long titles chunk under 100 ops and 28 KB each', async () => {
  const { chunks, added } = planImportOps({ source: 'csv', liked: Array.from({ length: 1000 }, (_, n) => song(n, true)), playlists: [], alreadyLiked: new Set(), now: 5 });
  assert.equal(added, 1000);
  assert.equal(chunks.flat().length, 1000);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= LIBRARY_OPS_MAX);
    assert.ok(JSON.stringify({ ops: chunk, sentAt: 0 }).length <= CHUNK_JSON_MAX);
  }
  assert.ok(chunks.flat().every((op) => op.op === 'like' && op.origin === 'import' && op.at === 5));
});

test('chunk size measures the full UTF-8 envelope and keeps multibyte rows below the byte limit', () => {
  const multibyte: SongSnapshot[] = Array.from({ length: 150 }, (_, n) => ({
    ref: `saavn:hi${n}` as SongRef,
    title: `हिन्दी 🎵 ${'தமிழ்'.repeat(40)} ${n}`,
    artist: `தமிழ் कलाकार ${'🎧'.repeat(20)}`,
    artwork: `https://example.test/${'🎼'.repeat(35)}`,
    duration: 200
  }));
  const plan = planImportOps({ source: 'csv', liked: multibyte, playlists: [], alreadyLiked: new Set(), now: 1_797_000_000_123 });
  assert.ok(plan.chunks.length > 1);
  for (const chunk of plan.chunks) {
    const envelope = JSON.stringify({ ops: chunk, sentAt: 1_797_000_000_123 });
    assert.equal(utf8ByteLength(envelope), new TextEncoder().encode(envelope).byteLength);
    assert.ok(new TextEncoder().encode(envelope).byteLength <= CHUNK_JSON_MAX);
  }
});

test('a single operation that cannot fit the body budget is rejected explicitly', () => {
  assert.throws(() => planImportOps({
    source: 'csv',
    liked: [{ ...song(1), artwork: `https://example.test/${'x'.repeat(CHUNK_JSON_MAX)}` }],
    playlists: [],
    alreadyLiked: new Set(),
    now: 1
  }), (error: unknown) => {
    assert.ok(error instanceof ImportPlanError);
    assert.ok(error.operation && 'ref' in error.operation);
    assert.equal(error.operation.ref, song(1).ref);
    return true;
  });
});

test('playlist ids are deterministic import- ids, and each upsert precedes its songs across chunks', async () => {
  const id = playlistIdFor('spotify-export', 'Road trip');
  assert.match(id, /^import-[0-9a-f]{12}$/);
  assert.equal(playlistIdFor('spotify-export', 'Road trip'), id);
  assert.notEqual(playlistIdFor('csv', 'Road trip'), id);

  const { chunks } = planImportOps({
    source: 'spotify-export',
    liked: Array.from({ length: 95 }, (_, n) => song(n)),
    playlists: [{ name: 'Road trip', songs: Array.from({ length: 30 }, (_, n) => song(500 + n)) }],
    alreadyLiked: new Set(),
    now: 1
  });
  const flat: LibraryOp[] = chunks.flat();
  const upsert = flat.findIndex((op) => op.op === 'playlist_upsert');
  const firstAdd = flat.findIndex((op) => op.op === 'playlist_add');
  assert.ok(upsert >= 0 && upsert < firstAdd);
  assert.deepEqual(flat[upsert], { op: 'playlist_upsert', playlistId: id, name: 'Road trip', origin: 'import', at: 1 });
  assert.ok(chunks.length >= 2);
});

test('distinct same-name Spotify playlists retain distinct ids across re-imports and renames', () => {
  const leftId = playlistIdFor('spotify-export', 'Focus', 'spotify:playlist:left');
  const rightId = playlistIdFor('spotify-export', 'Focus', 'spotify:playlist:right');
  assert.notEqual(leftId, rightId);
  assert.equal(playlistIdFor('spotify-export', 'Renamed Focus', 'spotify:playlist:left'), leftId);
});

test('songs already liked are counted, not sent; duplicates are sent once', async () => {
  const plan = planImportOps({ source: 'csv', liked: [song(1), song(2), song(2)], playlists: [], alreadyLiked: new Set(['saavn:s1']), now: 1 });
  assert.equal(plan.already, 1);
  assert.equal(plan.added, 1);
  assert.deepEqual(plan.chunks.flat().map((op) => ('ref' in op ? op.ref : '')), ['saavn:s2']);
});

test('a 429 waits and retries the same chunk; another error fails', async () => {
  const sent: number[] = [];
  const slept: number[] = [];
  let calls = 0;
  const outcome = await saveImport([[{ op: 'like', ref: 'saavn:a', at: 1 }], [{ op: 'like', ref: 'saavn:b', at: 1 }]], {
    apply: async (ops) => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error('slow'), { status: 429, retryAfterSeconds: 2 });
      sent.push(ops.length);
    },
    sleep: async (ms) => { slept.push(ms); },
    onChunk: () => undefined
  });
  assert.equal(outcome, 'ok');
  assert.deepEqual(slept, [2000]);
  assert.deepEqual(sent, [1, 1]);
  assert.equal(await saveImport([[{ op: 'like', ref: 'saavn:a', at: 1 }]], {
    apply: async () => { throw Object.assign(new Error('down'), { status: 500 }); },
    sleep: async () => undefined,
    onChunk: () => undefined
  }), 'failed');
});

test('resumable save skips acknowledged chunks and advances only after a complete receipt', async () => {
  const chunks: LibraryOp[][] = [
    [{ op: 'like', ref: 'saavn:s1', song: song(1), origin: 'import', at: 1 }],
    [{ op: 'like', ref: 'saavn:s2', song: song(2), origin: 'import', at: 1 }]
  ];
  const sent: number[] = [];
  const acked: number[] = [];
  const outcome = await saveImportResumable(chunks, {
    acknowledged: new Set([0]), apply: async (_chunk, index) => { sent.push(index); return { applied: 1, rejected: [], superseded: [] }; },
    accepted: (reply, count) => {
      const value = reply as { applied: number; rejected: unknown[]; superseded: number[] };
      return value.rejected.length === 0 && value.applied + value.superseded.length === count;
    }, sleep: async () => undefined, onChunk: (index) => { acked.push(index); }
  });
  assert.equal(outcome, 'ok');
  assert.deepEqual(sent, [1]);
  assert.deepEqual(acked, [1]);
});

test('resumable save rejects HTTP-success-shaped partial receipts and stops before later chunks', async () => {
  const chunks: LibraryOp[][] = [
    [{ op: 'like', ref: 'saavn:s1', song: song(1), origin: 'import', at: 1 }],
    [{ op: 'like', ref: 'saavn:s2', song: song(2), origin: 'import', at: 1 }]
  ];
  const acked: number[] = [];
  const outcome = await saveImportResumable(chunks, {
    apply: async () => ({ applied: 0, rejected: [{ index: 0, reason: 'invalid' }], superseded: [] }),
    accepted: (reply, count) => {
      const value = reply as { applied: number; rejected: unknown[]; superseded: number[] };
      return value.rejected.length === 0 && value.applied + value.superseded.length === count;
    }, sleep: async () => undefined, onChunk: (index) => { acked.push(index); }
  });
  assert.equal(outcome, 'failed');
  assert.deepEqual(acked, []);
});
