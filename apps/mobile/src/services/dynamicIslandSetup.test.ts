import { IslandStatus, islandSetupStep, parseIslandStatus } from './dynamicIslandSetup';

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
