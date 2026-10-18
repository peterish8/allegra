import { IslandStatus, islandLyricsPayload, islandSetupStep, parseIslandStatus } from './dynamicIslandSetup';

const ready: IslandStatus = {
  serviceEnabled: true, serviceRunning: true, showing: true, enabled: true,
  showWhenIdle: true, allowOnNativeIsland: false, nativeIsland: null, restrictedSettings: false,
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
    showWhenIdle: false, allowOnNativeIsland: false, nativeIsland: null, restrictedSettings: false,
  });
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
