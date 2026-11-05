/**
 * expo-haptics behind the Settings "Haptics" switch. Import this module in
 * place of expo-haptics (`import * as Haptics from '../utils/haptics'`) so
 * turning haptics off silences every tap, swipe and confirmation at once.
 */
import * as ExpoHaptics from 'expo-haptics';
import { Vibration } from 'react-native';
import { useSettingsStore } from '../store/settingsStore';

export { ImpactFeedbackStyle, NotificationFeedbackType } from 'expo-haptics';

const enabled = (): boolean => useSettingsStore.getState().hapticsEnabled ?? true;

export const selectionAsync = (): Promise<void> =>
  enabled() ? ExpoHaptics.selectionAsync() : Promise.resolve();

export const impactAsync = (style?: ExpoHaptics.ImpactFeedbackStyle): Promise<void> =>
  enabled() ? ExpoHaptics.impactAsync(style) : Promise.resolve();

export const notificationAsync = (type?: ExpoHaptics.NotificationFeedbackType): Promise<void> =>
  enabled() ? ExpoHaptics.notificationAsync(type) : Promise.resolve();

export const vibrate = (ms: number): void => {
  if (enabled()) Vibration.vibrate(ms);
};

// ─── The vocabulary ────────────────────────────────────────────────────────
// Name the moment, not the motor: the same action feels the same on the pill, in the player and in a sheet.
// New code uses these five; the raw calls above remain for code not moved yet.

const quietly = (p: Promise<void>): void => { p.catch(() => {}); };

/** A selection changed: a chip, a choice, a tab, a row picked from a list. */
export const tap = (): void => quietly(selectionAsync());
/** Something switched or was picked up: a like, a switch, a long press opening its sheet, a drag starting. */
export const toggle = (): void => quietly(impactAsync(ExpoHaptics.ImpactFeedbackStyle.Light));
/** A decisive action: play or pause anywhere, a skip by gesture, a sheet thrown shut. */
export const commit = (): void => quietly(impactAsync(ExpoHaptics.ImpactFeedbackStyle.Medium));
/** Done: a download finished, lyrics saved, songs added. */
export const success = (): void => quietly(notificationAsync(ExpoHaptics.NotificationFeedbackType.Success));
/** It can't: nothing to skip to, an action that won't run. */
export const refuse = (): void => quietly(notificationAsync(ExpoHaptics.NotificationFeedbackType.Warning));
