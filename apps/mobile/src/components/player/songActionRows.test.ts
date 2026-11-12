import { songActionRows, type SongActionContext } from './songActionRows';

const base: SongActionContext = { current: false, remote: false, stream: true, native: true, ringtone: false, artist: true, appendable: true };
const rows = (over: Partial<SongActionContext>) => songActionRows({ ...base, ...over });

test('a song from a shelf gets the queue rows and the song rows, not the playback ones', () => {
  const r = rows({});
  for (const row of ['playNext', 'addToQueue', 'download', 'like', 'share', 'addToPlaylist', 'radio', 'artist'] as const) expect(r.has(row)).toBe(true);
  for (const row of ['upNext', 'sleepTimer', 'reload', 'lyrics', 'equalizer', 'devices'] as const) expect(r.has(row)).toBe(false);
});

test('the playing song gets everything Now Playing’s ••• menu has, and no "play next" of itself', () => {
  const r = rows({ current: true });
  for (const row of ['upNext', 'sleepTimer', 'shuffleUpcoming', 'repeat', 'reload', 'lyrics', 'details', 'ambient', 'luvLink', 'devices', 'output', 'equalizer', 'tempo'] as const) {
    expect(r.has(row)).toBe(true);
  }
  expect(r.has('playNext')).toBe(false);
  expect(r.has('addToQueue')).toBe(false);
});

test('playing on another device keeps local audio controls out', () => {
  const r = rows({ current: true, remote: true });
  expect(r.has('devices')).toBe(true);
  for (const row of ['reload', 'shuffleUpcoming', 'equalizer', 'lyrics', 'playNext', 'radio'] as const) expect(r.has(row)).toBe(false);
});

test('rows that cannot work are left out', () => {
  expect(rows({ stream: false }).has('download')).toBe(false);
  expect(rows({ artist: false }).has('artist')).toBe(false);
  expect(rows({ current: true, native: false }).has('equalizer')).toBe(false);
  expect(rows({ current: true, ringtone: true }).has('ringtone')).toBe(true);
  expect(rows({ current: true }).has('ringtone')).toBe(false);
  // Add to queue joins the stream queue only; with a library queue (or nothing) playing, Play next remains.
  expect(rows({ appendable: false }).has('addToQueue')).toBe(false);
  expect(rows({ appendable: false }).has('playNext')).toBe(true);
});
