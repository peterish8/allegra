#!/usr/bin/env node

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Normalize and compare public SHA-256 certificate fingerprints. */
export function normalizeSha256Fingerprint(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replaceAll(':', '').replaceAll(/\s+/g, '').toUpperCase();
  return /^[A-F0-9]{64}$/.test(normalized) ? normalized : null;
}

export function matchesExpectedFingerprint(expected, actual) {
  const expectedFingerprint = normalizeSha256Fingerprint(expected);
  const actualFingerprint = normalizeSha256Fingerprint(actual);
  return expectedFingerprint !== null && actualFingerprint !== null && expectedFingerprint === actualFingerprint;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const expected = normalizeSha256Fingerprint(process.argv[2]);
  const actual = normalizeSha256Fingerprint(process.argv[3]);
  if (!expected || !actual || expected !== actual) {
    console.error('APK signing fingerprint is missing, malformed, or does not match the configured certificate.');
    if (expected) console.error(`Configured SHA-256 fingerprint: ${expected}`);
    if (actual) console.error(`APK SHA-256 fingerprint: ${actual}`);
    process.exitCode = 1;
  } else {
    console.log(`Verified APK SHA-256 fingerprint: ${actual}`);
  }
}
