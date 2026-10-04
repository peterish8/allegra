/**
 * The error that took the last React instance down, shown once after the screen came back.
 *
 * A fatal error in the React layer (a JavaScript crash, a UI-thread worklet that threw, a view that failed to
 * mount) used to leave a dead grey window while the music played on. `recovery/UiRecovery.kt` now writes the error
 * down and starts the screen again; this reads it at the next start and offers it to copy, so the listener can
 * report exactly what failed.
 */
import { Alert } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { getNativeModule } from './nativeModule';
import { diag } from '../utils/diag';
import { parseUiCrash, UiCrash } from './uiCrashRecord';

/** The recorded error, once (the native side forgets it as it is read). Null when there is none. */
export function takeUiCrash(): UiCrash | null {
  try {
    const mod = getNativeModule<{ takeUiCrash?: () => string | null }>('Startup');
    return parseUiCrash(mod?.takeUiCrash?.());
  } catch {
    return null;
  }
}

/** After the screen was brought back: say so, and let the listener copy what went wrong. */
export function reportRecoveredCrash(): void {
  const crash = takeUiCrash();
  if (!crash) return;
  diag('recovery', `screen restarted after: ${crash.summary}`);
  Alert.alert(
    'The screen was restarted',
    `Something on the screen stopped working, so it was started again. Your music kept playing.\n\n${crash.summary.slice(0, 300)}`,
    [
      { text: 'Copy details', onPress: () => { Clipboard.setStringAsync(crash.details).catch(() => {}); } },
      { text: 'OK', style: 'cancel' },
    ],
  );
}

/**
 * The app drew its first screen: this start no longer counts towards the native rescue screen
 * (`recovery/LaunchGuard.kt`), which opens after three starts in a row that never got this far.
 */
export function markStartHealthy(): void {
  try {
    getNativeModule<{ markHealthy?: () => void }>('Startup')?.markHealthy?.();
  } catch {
    // An older native build has no launch guard.
  }
}
