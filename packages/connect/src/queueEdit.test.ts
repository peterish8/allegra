import assert from 'node:assert/strict';
import test from 'node:test';
import { applyQueueEdit, QUEUE_LIMIT } from './queueEdit.ts';
import type { SongRef, SongSnapshot } from '../../shared/songRef.ts';

const track = (id: string): SongSnapshot => ({
  ref: `saavn:${id}` as SongRef, title: `Song ${id}`, artist: 'Nila', artwork: '', duration: 180
});
const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(track) as [SongSnapshot, SongSnapshot, SongSnapshot, SongSnapshot];
const refs = (queue: readonly SongSnapshot[] | undefined): string[] | undefined => queue?.map((item) => item.ref);

test('add puts a song at the end, or straight after the current one', () => {
  assert.deepEqual(refs(applyQueueEdit([a, b], { kind: 'queue_add', song: c })), [a.ref, b.ref, c.ref]);
  assert.deepEqual(refs(applyQueueEdit([a, b], { kind: 'queue_add', song: c, next: true })), [c.ref, a.ref, b.ref]);
});

test('add carries the rest of an album behind its first song, in order', () => {
  assert.deepEqual(refs(applyQueueEdit([a], { kind: 'queue_add', song: b, more: [c, d] })), [a.ref, b.ref, c.ref, d.ref]);
  assert.deepEqual(refs(applyQueueEdit([a], { kind: 'queue_add', song: b, more: [c, d], next: true })), [b.ref, c.ref, d.ref, a.ref]);
});

test('an edit never trims the queue: the player holds more than the songs it reports', () => {
  const full = Array.from({ length: QUEUE_LIMIT }, (_, index) => track(`full-${index}`));
  assert.equal(applyQueueEdit(full, { kind: 'queue_add', song: c, next: true })?.length, QUEUE_LIMIT + 1);
});

test('remove takes the named song, found by its ref when the index is stale', () => {
  assert.deepEqual(refs(applyQueueEdit([a, b, c], { kind: 'queue_remove', index: 1, ref: b.ref })), [a.ref, c.ref]);
  assert.deepEqual(refs(applyQueueEdit([b, c], { kind: 'queue_remove', index: 2, ref: c.ref })), [b.ref]);
  assert.equal(applyQueueEdit([a, b], { kind: 'queue_remove', index: 0, ref: d.ref }), undefined);
});

test('the index picks between two copies of one song', () => {
  assert.deepEqual(refs(applyQueueEdit([a, b, a], { kind: 'queue_remove', index: 2, ref: a.ref })), [a.ref, b.ref]);
});

test('move places a song by its position among the others', () => {
  assert.deepEqual(refs(applyQueueEdit([a, b, c, d], { kind: 'queue_move', from: 3, to: 0, ref: d.ref })), [d.ref, a.ref, b.ref, c.ref]);
  assert.deepEqual(refs(applyQueueEdit([a, b, c, d], { kind: 'queue_move', from: 0, to: 2, ref: a.ref })), [b.ref, c.ref, a.ref, d.ref]);
  assert.deepEqual(refs(applyQueueEdit([a, b, c], { kind: 'queue_move', from: 0, to: 99, ref: a.ref })), [b.ref, c.ref, a.ref]);
  assert.equal(applyQueueEdit([a, b], { kind: 'queue_move', from: 0, to: 1, ref: d.ref }), undefined);
});

test('clear empties the queue', () => {
  assert.deepEqual(applyQueueEdit([a, b], { kind: 'queue_clear' }), []);
});
