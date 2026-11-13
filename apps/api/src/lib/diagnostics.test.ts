import assert from 'node:assert/strict';
import test from 'node:test';

import { correlationId, errorShape, redactSecret, redactUrl, timedWarn, type DiagLog } from './diagnostics.js';

interface CapturedLine {
  readonly level: 'warn' | 'error' | 'info';
  readonly fields: Record<string, unknown>;
  readonly message: string;
}

function capturingLog(): DiagLog & { readonly lines: CapturedLine[] } {
  const lines: CapturedLine[] = [];
  const capture = (level: CapturedLine['level']) => (fields: Record<string, unknown>, message: string): void => {
    lines.push({ level, fields, message });
  };
  return { lines, warn: capture('warn'), error: capture('error'), info: capture('info') };
}

test('redactSecret prints length and short hash', () => {
  assert.equal(redactSecret('fixture-session-key'), 'len=19,sha256=4ca18850');
  const printed = redactSecret('fixture-session-key');
  assert.equal(printed.includes('fixture-session-key'), false);
});

test('redactSecret marks absent', () => {
  assert.equal(redactSecret(''), 'absent');
  assert.equal(redactSecret(undefined), 'absent');
  assert.equal(redactSecret(null), 'absent');
});

test('redactUrl hides path and query', () => {
  const redacted = redactUrl('https://cdn.example/song.mp4?sig=fixture-signature');
  assert.equal(redacted, 'https://cdn.example/~8a863b64');
  assert.equal(redacted.includes('song.mp4'), false);
  assert.equal(redacted.includes('sig='), false);
  assert.equal(redacted.includes('fixture-signature'), false);
  assert.equal(redactUrl('https://cdn.example/song.mp4?sig=abc'), 'https://cdn.example/~575e81fc');
  assert.equal(redactUrl('not a url'), 'invalid-url');
});

test('redactUrl never prints userinfo', () => {
  const redacted = redactUrl('https://fixture-user:fixture-pass@cdn.example/x?token=fixture-token');
  assert.equal(redacted.includes('fixture-user'), false);
  assert.equal(redacted.includes('fixture-pass'), false);
  assert.equal(redacted.includes('fixture-token'), false);
  assert.equal(redacted.startsWith('https://cdn.example/~'), true);
});

test('correlationId keeps a valid vercel id', () => {
  assert.equal(correlationId('str', 'bom1::abcde-123'), 'bom1::abcde-123');
  assert.equal(correlationId('str', '  bom1-ok  '), 'bom1-ok');
  assert.equal(correlationId('str', 'a'.repeat(64)), 'a'.repeat(64));
});

test('correlationId replaces an invalid one', () => {
  assert.match(correlationId('str', 'bad id!'), /^str-[0-9a-f]{8}$/);
  assert.match(correlationId('str', null), /^str-[0-9a-f]{8}$/);
  assert.match(correlationId('str'), /^str-[0-9a-f]{8}$/);
});

test('errorShape reads cause code and never the message', () => {
  const error = Object.assign(new TypeError('terminated https://cdn.example/song.mp4?sig=fixture-signature'), {
    cause: { code: 'UND_ERR_SOCKET' }
  });
  const shape = errorShape(error);
  assert.deepEqual(shape, { name: 'TypeError', code: 'UND_ERR_SOCKET' });
  assert.equal(JSON.stringify(shape).includes('fixture-signature'), false);
  assert.deepEqual(errorShape('plain'), { name: 'string' });
});

test('timedWarn logs once and rethrows', async () => {
  const log = capturingLog();
  const value = await timedWarn(log, 'fixture-op', { song: 'song-1' }, async () => 'ok');
  assert.equal(value, 'ok');
  assert.equal(log.lines.length, 0);

  const failure = new Error('upstream said https://cdn.example/song.mp4?sig=fixture-signature and fixture-token');
  await assert.rejects(
    () => timedWarn(log, 'fixture-op', { song: 'song-1' }, async () => {
      throw failure;
    }),
    (thrown: unknown) => thrown === failure
  );

  assert.equal(log.lines.length, 1);
  const [line] = log.lines;
  assert.equal(line?.level, 'warn');
  assert.equal(line?.message, 'fixture-op failed');
  assert.equal(line?.fields.op, 'fixture-op');
  assert.equal(line?.fields.song, 'song-1');
  assert.equal(typeof line?.fields.ms, 'number');
  assert.deepEqual(line?.fields.error, { name: 'Error' });
  const serialized = JSON.stringify(log.lines);
  assert.equal(serialized.includes('sig='), false);
  assert.equal(serialized.includes('fixture-token'), false);
});
