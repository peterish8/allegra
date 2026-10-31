jest.mock('react-native', () => ({ Platform: { OS: 'ios', Version: 17 } }));
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import { effectiveTier, tierFor } from './performanceTier';

const phone = (over: Partial<Parameters<typeof tierFor>[0]> = {}) =>
  ({ totalMemMb: 7600, lowRam: false, cores: 8, apiLevel: 34, ...over });

describe('tierFor', () => {
  it('keeps the full visuals on a current phone', () => {
    expect(tierFor(phone())).toBe('normal');
    expect(tierFor(phone({ totalMemMb: 3700 }))).toBe('normal'); // a 4GB phone reports ~3.7GB
    expect(tierFor(phone({ oldCores: false, slowFrames: false }))).toBe('normal');
  });

  it('takes the light path on old or budget phones', () => {
    expect(tierFor(phone({ totalMemMb: 2800 }))).toBe('low');
    expect(tierFor(phone({ lowRam: true }))).toBe('low');
    expect(tierFor(phone({ cores: 4 }))).toBe('low');
    expect(tierFor(phone({ apiLevel: 28 }))).toBe('low');
  });

  it('takes the light path on a Galaxy M31: plenty of memory and cores, but old CPU cores', () => {
    expect(tierFor(phone({ totalMemMb: 5600, cores: 8, apiLevel: 31, oldCores: true }))).toBe('low');
  });

  it('takes the light path once a phone kept missing frames', () => {
    expect(tierFor(phone({ slowFrames: true }))).toBe('low');
  });
});

describe('effectiveTier', () => {
  it('follows the device on auto and the listener otherwise', () => {
    expect(effectiveTier('low', 'auto')).toBe('low');
    expect(effectiveTier('normal', 'auto')).toBe('normal');
    expect(effectiveTier('normal', 'on')).toBe('low');
    expect(effectiveTier('low', 'off')).toBe('normal');
  });
});
