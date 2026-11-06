/** The native side of Display size (utils/displaySize): Android's Startup module. Elsewhere it is not offered. */
import { Platform } from 'react-native';
import { DisplaySize, scaleForSize, sizeForScale } from '../utils/displaySize';
import { getNativeModule } from './nativeModule';

interface DisplayScaleModule {
  getDisplayScale?: () => number;
  setDisplayScale?: (scale: number) => number;
}

const mod = (): DisplayScaleModule | null => (Platform.OS === 'android' ? getNativeModule<DisplayScaleModule>('Startup') : null);

/** Whether this build can change the app's display size. */
export const displaySizeAvailable = (): boolean => typeof mod()?.setDisplayScale === 'function';

export function readDisplaySize(): DisplaySize {
  try {
    return sizeForScale(mod()?.getDisplayScale?.());
  } catch {
    return 'default';
  }
}

/** Saves the size; the screen rebuilds at it a moment later. False when it could not be saved. */
export function saveDisplaySize(size: DisplaySize): boolean {
  try {
    const set = mod()?.setDisplayScale;
    if (!set) return false;
    set(scaleForSize(size));
    return true;
  } catch {
    return false;
  }
}
