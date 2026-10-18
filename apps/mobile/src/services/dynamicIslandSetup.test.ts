import {
  IslandStatus, isDownloadedSong, islandCover, islandLyricsPayload, islandSetupStep, islandSongRow, parseIslandStatus,
} from './dynamicIslandSetup';

const ready: IslandStatus = {
  serviceEnabled: true, serviceRunning: true, showing: true, enabled: true,
  showWhenIdle: true, allowOnNativeIsland: false, hideInApp: true, showLyricStrip: true, nativeIsland: null,
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
  });
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
