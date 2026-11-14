#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function patchMobileVersionCode(source, versionCode) {
  if (!Number.isSafeInteger(versionCode) || versionCode <= 0 || versionCode > 2_100_000_000) {
    throw new Error('Android versionCode must be a positive integer no greater than 2100000000');
  }
  const matches = [...source.matchAll(/^([ \t]*)versionCode\s+.+$/gm)];
  if (matches.length !== 1) throw new Error('Expected one active versionCode line in android/app/build.gradle');
  const match = matches[0];
  const line = match[0];
  return source.replace(line, match[1] + 'versionCode ' + versionCode);
}

function main() {
  const [file, rawVersionCode] = process.argv.slice(2);
  if (!file || !rawVersionCode || !/^\d+$/.test(rawVersionCode)) {
    throw new Error('Usage: patch-mobile-version-code.mjs <build.gradle> <versionCode>');
  }
  const source = readFileSync(file, 'utf8');
  writeFileSync(file, patchMobileVersionCode(source, Number(rawVersionCode)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
