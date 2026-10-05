import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  IMPORT_LIMITS,
  bundleFromSpotifyFiles,
  parseCsv,
  parseSpotifyLibrary,
  parseSpotifyPlaylists,
  playlistIdentity
} from './importParse.js';

const libraryText = readFileSync(new URL('./fixtures/spotify-export/YourLibrary.json', import.meta.url), 'utf8');
const playlistText = readFileSync(new URL('./fixtures/spotify-export/Playlist1.json', import.meta.url), 'utf8');
const csvText = readFileSync(new URL('./fixtures/spotify-export/exportify.csv', import.meta.url), 'utf8');
const library: unknown = JSON.parse(libraryText);
const playlistFile: unknown = JSON.parse(playlistText);

test('Spotify library keeps four tracks and counts its episode and local file', () => {
  const parsed = parseSpotifyLibrary(library);

  assert.equal(parsed.tracks.length, 4);
  assert.equal(parsed.skipped, 2);
  assert.equal(parsed.tracks[0].title, 'Tum Hi Ho');
  assert.equal(parsed.tracks[0].artist, 'Arijit Singh');
  assert.equal(parsed.tracks[0].durationSec, 248);
  assert.equal(parsed.tracks[2].artist, 'Arijit Singh, Asees Kaur');
});

test('Spotify playlists keep both synthetic playlists and their three tracks', () => {
  const parsed = parseSpotifyPlaylists(playlistFile);

  assert.equal(parsed.playlists.length, 2);
  assert.deepEqual(parsed.playlists.map((entry) => entry.tracks.length), [3, 3]);
  assert.equal(parsed.playlists[0].name, 'Synthetic Road Trip');
  assert.equal(parsed.playlists[1].tracks[0].durationSec, 341);
});

test('the CSV fixture parses six rows and joins semicolon-separated artists', () => {
  const parsed = parseCsv(csvText);

  assert.equal(parsed.source, 'csv');
  assert.equal(parsed.liked.length, 6);
  assert.equal(parsed.skipped, 0);
  assert.equal(parsed.liked[2].artist, 'Arijit Singh, Asees Kaur');
  assert.equal(parsed.liked[0].durationSec, 248);
});

test('CSV handles quoted commas and escaped quotes', () => {
  const parsed = parseCsv('title,artists,album name,duration (ms)\n"Hello, ""World""","A; B","Album, Deluxe",90000');

  assert.equal(parsed.liked[0].title, 'Hello, "World"');
  assert.equal(parsed.liked[0].artist, 'A, B');
  assert.equal(parsed.liked[0].album, 'Album, Deluxe');
  assert.equal(parsed.liked[0].durationSec, 90);
});

test('CSV accepts CRLF records', () => {
  const parsed = parseCsv('title,artist\r\nFirst,Artist One\r\nSecond,Artist Two\r\n');

  assert.deepEqual(parsed.liked.map((track) => track.title), ['First', 'Second']);
});

test('CSV ignores a UTF-8 BOM before the header', () => {
  const parsed = parseCsv('\uFEFFTrack Name,Artist Name(s)\nA Song,An Artist');

  assert.equal(parsed.liked.length, 1);
  assert.equal(parsed.liked[0].title, 'A Song');
});

test('CSV header aliases are case-insensitive', () => {
  const parsed = parseCsv('TITLE,ARTISTS,ALBUM NAME\nA Song,An Artist,An Album');

  assert.equal(parsed.liked[0].album, 'An Album');
});

test('CSV accepts a missing duration column', () => {
  const parsed = parseCsv('name,artist\nA Song,An Artist');

  assert.equal(parsed.liked[0].durationSec, undefined);
});

test('malformed Spotify values return empty results and count the bad input', () => {
  assert.deepEqual(parseSpotifyLibrary(42), { tracks: [], skipped: 1 });
  assert.deepEqual(parseSpotifyPlaylists(null), { playlists: [], skipped: 1 });
});

test('malformed CSV quoting is counted instead of throwing', () => {
  const parsed = parseCsv('title,artist\n"unfinished,Artist');

  assert.deepEqual(parsed.liked, []);
  assert.equal(parsed.skipped, 1);
});

test('Spotify imports cap the combined track list at 10,000 and mark truncation', () => {
  const tracks = Array.from({ length: 12_000 }, (_, index) => ({
    trackName: 'Synthetic Track ' + index,
    artistName: 'Synthetic Artist'
  }));
  const parsed = bundleFromSpotifyFiles([{ name: 'YourLibrary.json', json: { tracks } }]);

  assert.equal(parsed.liked.length, IMPORT_LIMITS.tracks);
  assert.equal(parsed.truncated, true);
});

test('Spotify imports cap playlists at 200 and mark truncation', () => {
  const playlists = Array.from({ length: 250 }, (_, index) => ({
    name: 'Synthetic Playlist ' + index,
    items: []
  }));
  const parsed = bundleFromSpotifyFiles([{ name: 'Playlist1.json', json: { playlists } }]);

  assert.equal(parsed.playlists.length, IMPORT_LIMITS.playlists);
  assert.equal(parsed.truncated, true);
});

test('Spotify track titles are trimmed and capped at 200 characters', () => {
  const longTitle = 'x'.repeat(250);
  const parsed = parseSpotifyLibrary({
    tracks: [{ trackName: '  ' + longTitle + '  ', artistName: '  Artist  ' }]
  });

  assert.equal(parsed.tracks[0].title.length, 200);
  assert.equal(parsed.tracks[0].artist, 'Artist');
});

test('Spotify entries with an empty title are skipped', () => {
  const parsed = parseSpotifyLibrary({
    tracks: [{ trackName: '   ', artistName: 'Artist' }]
  });

  assert.deepEqual(parsed.tracks, []);
  assert.equal(parsed.skipped, 1);
});

test('bundling recognizes nested paths and processes playlist numbers in order', () => {
  const parsed = bundleFromSpotifyFiles([
    { name: 'Spotify Account Data/Playlist2.json', json: { playlists: [{ name: 'Second', items: [] }] } },
    { name: 'Spotify Account Data/Playlist1.json', json: { playlists: [{ name: 'First', items: [] }] } },
    { name: 'MyData/ReadMe.pdf', json: null }
  ]);

  assert.deepEqual(parsed.playlists.map((entry) => entry.name), ['First', 'Second']);
  assert.deepEqual(parsed.playlists.map((entry) => entry.sourceId), [
    'spotify-export:spotify account data/playlist1.json:0',
    'spotify-export:spotify account data/playlist2.json:0'
  ]);
});

test('same-name Spotify playlists remain independently selectable with stable source identities', () => {
  const parsed = bundleFromSpotifyFiles([{ name: 'Spotify/Playlist1.json', json: { playlists: [
    { name: 'Focus', uri: 'spotify:playlist:aaaaaaaaaaaaaaaaaaaaaa', items: [] },
    { name: 'Focus', uri: 'spotify:playlist:bbbbbbbbbbbbbbbbbbbbbb', items: [] }
  ] } }]);
  assert.equal(parsed.playlists.length, 2);
  assert.notEqual(playlistIdentity(parsed.playlists[0]!), playlistIdentity(parsed.playlists[1]!));
  assert.deepEqual(parsed.playlists.map((playlist) => playlist.sourceId), [
    'spotify:playlist:aaaaaaaaaaaaaaaaaaaaaa',
    'spotify:playlist:bbbbbbbbbbbbbbbbbbbbbb'
  ]);
});

test('playlist fallback identity is stable across display-name changes at the same source position', () => {
  const before = bundleFromSpotifyFiles([{ name: 'Spotify/Playlist1.json', json: { playlists: [{ name: 'Focus', items: [] }] } }]);
  const after = bundleFromSpotifyFiles([{ name: 'Spotify/Playlist1.json', json: { playlists: [{ name: 'Deep Focus', items: [] }] } }]);
  assert.equal(playlistIdentity(before.playlists[0]!), playlistIdentity(after.playlists[0]!));
});
