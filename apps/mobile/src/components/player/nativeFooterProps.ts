/**
 * The native bottom row of Now Playing (`NativePlayerFooter`, android/.../views/NativePlayerFooterView.kt) only reports
 * which control was used; what each one does stays in `NowPlayingControls`. Plain TypeScript so it is unit-testable.
 */

export type FooterAction = 'queue' | 'output' | 'timer' | 'lyrics' | 'lyricsLong';

const ACTIONS: readonly string[] = ['queue', 'output', 'timer', 'lyrics', 'lyricsLong'];

/** The action in a native event, or null for anything this build does not know. */
export const footerActionOf = (event: { nativeEvent?: { action?: unknown } } | undefined): FooterAction | null => {
  const action = event?.nativeEvent?.action;
  return typeof action === 'string' && ACTIONS.includes(action) ? (action as FooterAction) : null;
};

/** Native where the view exists; iOS and builds without it keep the React Native row. */
export const shouldUseNativeFooter = (available: boolean): boolean => available;

/** The sleep timer's label as the view wants it: nothing when there is no timer or no time left. */
export const footerSleepLabel = (hasTimer: boolean, sleepLabel?: string | null): string =>
  hasTimer && typeof sleepLabel === 'string' ? sleepLabel : '';
