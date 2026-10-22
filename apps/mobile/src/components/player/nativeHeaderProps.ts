/**
 * What the native Now Playing header (`NativeHeader`, android/.../views/NativeHeaderView.kt) is handed and gives back,
 * decided in plain TypeScript so it is unit-testable. The numbers mirror `HeaderGeometry.kt`.
 */

export type HeaderAction = 'back' | 'together' | 'playingOn';

const ACTIONS: readonly string[] = ['back', 'together', 'playingOn'];

/** The action in a native event, or null for anything this build does not know. */
export const headerActionOf = (event: { nativeEvent?: { action?: unknown } } | undefined): HeaderAction | null => {
  const action = event?.nativeEvent?.action;
  return typeof action === 'string' && ACTIONS.includes(action) ? (action as HeaderAction) : null;
};

/** The grabber's box (5 dp with 6 dp above and below) and each chip with the 6 dp above it, in dp. */
const GRABBER_BOX_H = 17;
const CHIP_STEP = 36;

export const headerChipCount = (together: number | null | undefined, playingOn: string | null | undefined): number =>
  (typeof together === 'number' ? 1 : 0) + (playingOn ? 1 : 0);

export const headerHeight = (chips: number): number => GRABBER_BOX_H + Math.max(0, chips) * CHIP_STEP;

/** The device kind the Playing on chip's icon follows: a laptop for the web, a phone otherwise. */
export const headerPlayingKind = (kind: 'web' | 'android' | 'ios' | undefined): 'web' | 'phone' => (kind === 'web' ? 'web' : 'phone');

/** Native where the view exists; iOS and builds without it keep the React Native header. */
export const shouldUseNativeHeader = (available: boolean): boolean => available;
