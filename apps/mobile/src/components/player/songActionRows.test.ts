import { songActionGroups, songActionRows, type SongActionContext } from './songActionRows';

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

describe('a song file on this phone', () => {
  const file = (over: Partial<SongActionContext> = {}) => rows({ stream: false, library: true, ...over });
  test('gets the library rows a long press in Library or a playlist always had', () => {
    const r = file();
    for (const row of ['findLyrics', 'version', 'shareFile', 'coverPhoto', 'coverOnline', 'coverRemove', 'editInfo', 'hide', 'delete', 'playNext'] as const) expect(r.has(row)).toBe(true);
    expect(r.has('download')).toBe(false);
    expect(r.has('removeFromPlaylist')).toBe(false);
  });
  test('offers Remove from this playlist only from a playlist', () => {
    expect(file({ fromPlaylist: true }).has('removeFromPlaylist')).toBe(true);
  });
  test('leaves out Play next when the host cannot queue it', () => {
    expect(file({ canPlayNext: false }).has('playNext')).toBe(false);
  });
  test('the playing song uses the lyrics picker, not the search queue, and keeps its library rows', () => {
    const r = file({ current: true });
    expect(r.has('lyrics')).toBe(true);
    expect(r.has('findLyrics')).toBe(false);
    expect(r.has('editInfo')).toBe(true);
  });
  test('never reaches a stream or a song on another device', () => {
    expect(rows({ library: true }).has('delete')).toBe(false);
    expect(file({ remote: true, current: true }).has('delete')).toBe(true);
  });
});

describe('categories', () => {
  const groups = (over: Partial<SongActionContext>) => songActionGroups(songActionRows({ ...base, ...over }));
  test('keep a fixed order and drop empty groups', () => {
    expect(groups({}).map(g => g.id)).toEqual(['queue']);
    expect(groups({ stream: false, library: true, fromPlaylist: true, current: true }).map(g => g.id))
      .toEqual(['queue', 'playback', 'song', 'cover', 'sound', 'manage']);
  });
  test('put destructive rows last, with Manage as the final group', () => {
    const manage = groups({ stream: false, library: true, fromPlaylist: true }).at(-1);
    expect(manage?.id).toBe('manage');
    expect(manage?.rows).toEqual(['editInfo', 'removeFromPlaylist', 'hide', 'delete']);
  });
  test('list every row exactly once', () => {
    const r = songActionRows({ ...base, current: true, stream: false, library: true, fromPlaylist: true, ringtone: true });
    const listed = songActionGroups(r).flatMap(g => g.rows);
    expect(new Set(listed).size).toBe(listed.length);
    const top = new Set(['download', 'like', 'share']);
    expect([...r].filter(row => !top.has(row) && !listed.includes(row))).toEqual([]);
  });
});
