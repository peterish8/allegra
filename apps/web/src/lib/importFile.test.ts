import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { bundleFromSpotifyFiles, parseCsv } from '@shared/importParse';
import { unzipSync, zipSync, type UnzipFileInfo } from 'fflate';

import { readImportFile, readZipEntries } from './importFile.ts';

const fixtures = new URL('../../../../packages/shared/fixtures/', import.meta.url);
const fixture = (name: string): Buffer => readFileSync(new URL(name, fixtures));
const asFile = (bytes: Uint8Array, name: string) => Object.assign(new Blob([bytes]), { name });

test('the fixture ZIP reads to the same bundle as the JSON files parsed directly', async () => {
  const result = await readImportFile(asFile(fixture('spotify-export.zip'), 'my_spotify_data.zip'));
  assert.ok('bundle' in result);
  const direct = bundleFromSpotifyFiles([
    { name: 'Spotify Account Data/YourLibrary.json', json: JSON.parse(fixture('spotify-export/YourLibrary.json').toString('utf8')) },
    { name: 'Spotify Account Data/Playlist1.json', json: JSON.parse(fixture('spotify-export/Playlist1.json').toString('utf8')) }
  ]);
  assert.deepEqual(result.bundle, direct);
  assert.equal(result.bundle.liked.length, 4);
  assert.equal(result.bundle.playlists.length, 2);
  assert.match(result.fileHash, /^[0-9a-f]{64}$/);
});

test('an entry declared over 20 MB is refused by central-directory preflight before unzip is called', () => {
  const zip = zipSync({
    'MyData/YourLibrary.json': new Uint8Array(25 * 1024 * 1024),
    'MyData/junk.bin': new Uint8Array(1024)
  });
  let inflations = 0;
  const spy: typeof unzipSync = (data, options) => unzipSync(data, {
    ...options,
    filter: (file: UnzipFileInfo) => {
      return options?.filter ? options.filter(file) : true;
    }
  });
  const counted: typeof unzipSync = (...args) => { inflations += 1; return spy(...args); };
  assert.equal(readZipEntries(zip, counted), 'too_large');
  assert.equal(inflations, 0);
});

test('aggregate declared expansion and entry-count caps reject archives before extraction', () => {
  const expanded = zipSync({
    'one/YourLibrary.json': new Uint8Array(60 * 1024 * 1024),
    'two/Playlist1.json': new Uint8Array(50 * 1024 * 1024)
  });
  let calls = 0;
  const spy: typeof unzipSync = (bytes, options) => { calls += 1; return unzipSync(bytes, options); };
  assert.equal(readZipEntries(expanded, spy), 'too_large');
  assert.equal(calls, 0);

  const many = zipSync(Object.fromEntries(Array.from({ length: 501 }, (_, index) => [`junk/${index}.txt`, new Uint8Array(0)])));
  assert.equal(readZipEntries(many, spy), 'too_large');
  assert.equal(calls, 0);
});

test('a ZIP with nothing Allegra reads is empty; broken JSON is unreadable', async () => {
  const junk = zipSync({ 'MyData/ReadMe.pdf': new Uint8Array(10) });
  assert.deepEqual(await readImportFile(asFile(junk, 'a.zip')), { error: 'empty' });
  const broken = zipSync({ 'MyData/YourLibrary.json': new TextEncoder().encode('{ not json') });
  assert.deepEqual(await readImportFile(asFile(broken, 'b.zip')), { error: 'unreadable' });
  assert.deepEqual(await readImportFile(asFile(new Uint8Array([1, 2, 3]), 'c.zip')), { error: 'unreadable' });
});

test('a CSV reads through the shared parser; an unknown extension is unreadable', async () => {
  const csv = fixture('spotify-export/exportify.csv');
  const result = await readImportFile(asFile(csv, 'liked.csv'));
  assert.ok('bundle' in result);
  assert.deepEqual(result.bundle, parseCsv(csv.toString('utf8')));
  assert.deepEqual(await readImportFile(asFile(csv, 'liked.txt')), { error: 'unreadable' });
});

test('a single JSON file reads, as the library or as a playlist file', async () => {
  const library = await readImportFile(asFile(fixture('spotify-export/YourLibrary.json'), 'YourLibrary.json'));
  assert.ok('bundle' in library && library.bundle.liked.length === 4);
  const playlist = await readImportFile(asFile(fixture('spotify-export/Playlist1.json'), 'renamed.json'));
  assert.ok('bundle' in playlist && playlist.bundle.playlists.length === 2);
});
