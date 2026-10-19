/**
 * How much motion the phone can carry. Old and budget Android phones get the
 * light path: the shader renders fewer pixels at 30fps and rests while music
 * is paused, glass skips the live blur, and entrances fade instead of rise.
 * Everything still animates; it just costs less.
 *
 * Memory and core count alone called a Galaxy M31 (6 GB, eight cores) a
 * normal phone, though its Cortex-A73 cores could not hold 60fps under the
 * full visuals. The native profile also says whether every CPU core is an old
 * design (`oldCores`) and whether an earlier run kept missing frames
 * (`slowFrames`, android/.../startup/FrameWatch.kt). Settings → Reduce effects
 * overrides the device either way.
 */
import { Platform } from 'react-native';
import { getNativeModule } from '../services/nativeModule';
import { useSettingsStore, type ReduceEffects } from '../store/settingsStore';

export type PerformanceTier = 'low' | 'normal';

interface DeviceProfile {
  totalMemMb: number;
  lowRam: boolean;
  cores: number;
  apiLevel: number;
  /** Every CPU core is Cortex-A73 class or older. Absent on builds before it was reported. */
  oldCores?: boolean;
  /** An earlier run's frames kept missing 18 ms. */
  slowFrames?: boolean;
}

/** Pure rule, exported for tests. */
export const tierFor = (p: DeviceProfile): PerformanceTier =>
  p.lowRam || p.totalMemMb < 3500 || p.cores <= 4 || p.apiLevel < 29 || p.oldCores === true || p.slowFrames === true
    ? 'low'
    : 'normal';

/** The listener's choice wins; 'auto' is the device's own tier. */
export const effectiveTier = (device: PerformanceTier, choice: ReduceEffects): PerformanceTier =>
  choice === 'on' ? 'low' : choice === 'off' ? 'normal' : device;

let cached: PerformanceTier | null = null;

/** What the hardware alone suggests, read once. */
export const deviceTier = (): PerformanceTier => {
  if (cached) return cached;
  cached = 'normal';
  if (Platform.OS === 'android') {
    try {
      const profile = getNativeModule<{ deviceProfile?: () => DeviceProfile }>('Startup')?.deviceProfile?.();
      if (profile) cached = tierFor(profile);
      else if (Number(Platform.Version) < 29) cached = 'low';
    } catch {
      // Unknown device: keep the normal path.
    }
  }
  return cached;
};

/** The tier right now, for code outside React. */
export const performanceTier = (): PerformanceTier =>
  effectiveTier(deviceTier(), useSettingsStore.getState().reduceEffects);

/** The tier, re-rendering when Settings → Reduce effects changes. */
export const usePerformanceTier = (): PerformanceTier =>
  effectiveTier(deviceTier(), useSettingsStore(s => s.reduceEffects));

export const isLowEndDevice = (): boolean => performanceTier() === 'low';

export const useLowEndDevice = (): boolean => usePerformanceTier() === 'low';
