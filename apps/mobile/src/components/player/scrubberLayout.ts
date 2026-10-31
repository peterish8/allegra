/**
 * The song scrubber's layout numbers, shared by the React Native slider's time labels (NowPlayingControls) and the
 * spacer that sizes the native scrubber (NativeScrubber), so the two are the same height by construction. The Kotlin
 * view (`ScrubberMath`) draws the track in the same strip and the labels at the same insets.
 */
import type { TextStyle, ViewStyle } from 'react-native';

/** The touch strip the track sits in, in dp. */
export const SCRUBBER_HIT_H = 28;

/** Echo's secondary text on the player: near white, not grey (the native labels use alpha 219 of 255). */
export const TIME_INK = 'rgba(255,255,255,0.86)';

export const TIME_ROW_STYLE: ViewStyle = { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, paddingHorizontal: 4 };

export const TIME_TEXT_STYLE: TextStyle = { fontWeight: '600', fontSize: 13, fontVariant: ['tabular-nums'], color: TIME_INK };
