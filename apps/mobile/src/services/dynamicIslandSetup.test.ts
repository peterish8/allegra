import {
  IslandStatus, foldForSearch, isDownloadedSong, matchDownloads, islandAwakeMs, islandCover, islandLyricsPayload, islandLyricsTiming, islandSearchRows,
  islandSetupStep, islandSongRow, parseIslandStatus,
} from './dynamicIslandSetup';

test('the island keeps JavaScript awake only as long as asked, within a minute', () => {
  expect(islandAwakeMs({ ms: 20_000 })).toBe(20_000);
  expect(islandAwakeMs({ ms: 10 * 60_000 })).toBe(60_000);
  expect(islandAwakeMs({ ms: -5 })).toBe(0);
  expect(islandAwakeMs({ ms: 'soon' })).toBe(0);
  expect(islandAwakeMs(null)).toBe(0);
});

const ready: IslandStatus = {
  serviceEnabled: true, serviceRunning: true, showing: true, enabled: true,
  showWhenIdle: true, allowOnNativeIsland: false, hideInApp: true, showLyricStrip: true, showOnLockScreen: false,
  style: 'pill', widthPercent: 100, heightPercent: 100, nativeIsland: null,
  restrictedSettings: false,
};

test('The island is ready when both switches are on', () => {
  expect(islandSetupStep(ready)).toBe('ready');
  expect(islandSetupStep({ ...ready, serviceRunning: false })).toBe('ready');
});
test('Android setup is requested only while the island is enabled', () => {
  expect(islandSetupStep({ ...ready, serviceEnabled: false })).toBe('needs-service');
  expect(islandSetupStep({ ...ready, enabled: false, serviceEnabled: false })).toBe('off');
});
test('The phone island takes precedence unless explicitly overridden', () => {
  const native = { ...ready, nativeIsland: 'System island' };
  expect(islandSetupStep(native)).toBe('native');
  expect(islandSetupStep({ ...native, allowOnNativeIsland: true })).toBe('ready');
});
test('Missing native flags are false and an empty island name is absent', () => {
  expect(parseIslandStatus({})).toEqual({
    serviceEnabled: false, serviceRunning: false, showing: false, enabled: false,
    showWhenIdle: false, allowOnNativeIsland: false, hideInApp: false, nativeIsland: null, restrictedSettings: false,
    // A build without the switch always showed the lines, so that is what an absent value means.
    showLyricStrip: true,
    showOnLockScreen: false,
    // Builds before the setting had only the pill.
    style: 'pill',
    widthPercent: 100,
    heightPercent: 100,
  });
  expect(parseIslandStatus({ widthPercent: 200, heightPercent: 10 })).toMatchObject({ widthPercent: 150, heightPercent: 85 });
  expect(parseIslandStatus({ style: 'notch' })?.style).toBe('notch');
  expect(parseIslandStatus({ style: 'blob' })?.style).toBe('pill');
  expect(parseIslandStatus({ widthPercent: 112.4 })?.widthPercent).toBe(112);
  expect(parseIslandStatus({ showOnLockScreen: true })?.showOnLockScreen).toBe(true);
  expect(parseIslandStatus({ showLyricStrip: false })?.showLyricStrip).toBe(false);
  expect(parseIslandStatus({ enabled: 'true', serviceEnabled: 1 })?.enabled).toBe(false);
  expect(parseIslandStatus({ nativeIsland: '' })?.nativeIsland).toBeNull();
  expect(parseIslandStatus(ready)).toEqual(ready);
});
test.each([null, undefined, false, 'invalid'])('Unavailable status stays unavailable: %s', raw => {
  expect(parseIslandStatus(raw)).toBeNull();
});

describe('islandLyricsPayload', () => {
  test('timed lines go to the island in ms, shifted by the lyrics delay the way the app reads them', () => {
    const lines = [{ timestamp: 1.2, text: 'First line' }, { timestamp: 4.5, text: '  Second line ' }, { timestamp: 7, text: '   ' }];
    expect(islandLyricsPayload(lines, 0.5)).toEqual({ atMs: [700, 4000], texts: ['First line', 'Second line'] });
  });

  test('plain lyrics (every line at 0) and no lyrics send nothing', () => {
    expect(islandLyricsPayload([{ timestamp: 0, text: 'a' }, { timestamp: 0, text: 'b' }], 0)).toBeNull();
    expect(islandLyricsPayload([], 0)).toBeNull();
    expect(islandLyricsPayload(undefined, 0)).toBeNull();
  });

  test('a delay never pushes a line before the start of the song', () => {
    expect(islandLyricsPayload([{ timestamp: 0.2, text: 'Hi' }], 1)?.atMs).toEqual([0]);
  });
});

describe('island lists', () => {
  test('only covers the island may load natively travel: files, content and https', () => {
    expect(islandCover('file:///data/cover.jpg')).toBe('file:///data/cover.jpg');
    expect(islandCover('content://media/1')).toBe('content://media/1');
    expect(islandCover('https://img/x.jpg')).toBe('https://img/x.jpg');
    expect(islandCover('http://img/x.jpg')).toBe('');
    expect(islandCover('/data/cover.jpg')).toBe('');
    expect(islandCover(undefined)).toBe('');
  });
  test('a downloaded song shows its own cover first, so it appears offline and at once', () => {
    expect(islandSongRow({ id: 'a', title: ' T ', artist: 'A', coverImageUri: 'file:///c.jpg', coverRemoteUri: 'https://r.jpg' }))
      .toEqual({ id: 'a', title: 'T', artist: 'A', cover: 'file:///c.jpg' });
    expect(islandSongRow({ id: 'b', coverRemoteUri: 'https://r.jpg' })).toEqual({ id: 'b', title: 'Unknown song', artist: '', cover: 'https://r.jpg' });
  });
  test('downloads are songs whose audio is on the phone', () => {
    expect(isDownloadedSong({ audioUri: 'file:///music/a.m4a' })).toBe(true);
    expect(isDownloadedSong({ audioUri: 'content://media/2' })).toBe(true);
    expect(isDownloadedSong({ audioUri: 'https://stream/a' })).toBe(false);
    expect(isDownloadedSong({ audioUri: 'file:///music/a.m4a', isHidden: true })).toBe(false);
    expect(isDownloadedSong({})).toBe(false);
  });
});

describe('island search over the downloads', () => {
  const downloads = [
    { id: '1', title: 'Tum Hi Ho', artist: 'Arijit Singh' },
    { id: '2', title: 'Kesariya', artist: 'Arijit Singh, Pritam' },
    { id: '3', title: 'Halo', artist: 'Beyoncé' },
    { id: '4', title: "Arijit's Medley", artist: 'Various' },
  ];
  const ids = (query: string) => matchDownloads(downloads, query).map(song => song.id);

  test('every typed word must match, in any case and without accents; title matches first', () => {
    expect(ids('arijit')).toEqual(['4', '1', '2']);
    expect(ids('KES arij')).toEqual(['2']);
    expect(ids('beyonce')).toEqual(['3']);
    expect(ids('  ')).toEqual([]);
    expect(ids('zzz')).toEqual([]);
  });

  test('folds text the same way as the island', () => {
    expect(foldForSearch('  Beyoncé – Halo! ')).toBe('beyonce halo');
  });

  test('stops at the limit', () => {
    expect(matchDownloads(downloads, 'a', 2)).toHaveLength(2);
  });

  test('search rows list the downloads first, marked, then the online answers with their own art', () => {
    const rows = islandSearchRows(
      [{ id: 'd1', title: 'Kesariya', artist: 'Arijit Singh', coverImageUri: 'file:///c.jpg' }],
      [
        { id: 'o1', title: 'Kesariya', artist: 'Arijit Singh', highResArt: 'https://yt/k.jpg' },
        { id: 'o2', title: 'Tum Hi Ho', artist: 'Arijit Singh', highResArt: '', thumbnail: 'https://yt/t.jpg' },
      ],
    );
    expect(rows).toEqual([
      { id: 'd1', title: 'Kesariya', artist: 'Arijit Singh', cover: 'file:///c.jpg', downloaded: true },
      { id: 'o1', title: 'Kesariya', artist: 'Arijit Singh', cover: 'https://yt/k.jpg' },
      { id: 'o2', title: 'Tum Hi Ho', artist: 'Arijit Singh', cover: 'https://yt/t.jpg' },
    ]);
  });
});


describe('island word timing', () => {
  test('keeps real word times and the triple-tap highlight mode on the same delayed clock', () => {
    const lines = [{ timestamp: 2, text: 'First word', words: [{ text: 'First ', start: 2, end: 3 }, { text: 'word', start: 3.5, end: 4 }] }];
    const payload = JSON.parse(islandLyricsTiming(lines, 0.5, 'letters'));
    expect(payload.highlight).toBe('letters');
    expect(payload.lines[0].atMs).toBe(1500);
    expect(payload.lines[0].segments).toEqual([
      { from: 0, to: 5, startMs: 1500, endMs: 2500 },
      { from: 6, to: 10, startMs: 3000, endMs: 3500 },
    ]);
    expect(JSON.parse(islandLyricsTiming(lines, 0.5, 'lines')).highlight).toBe('lines');
  });
  test('preserves instrumental markers for the native symbol renderer', () => {
    const payload = JSON.parse(islandLyricsTiming([{ timestamp: 3, text: '[INSTRUMENTAL]' }], 0, 'letters'));
    expect(payload.lines[0].text).toBe('[INSTRUMENTAL]');
  });
});
