/**
 * Text in one of the app's type roles. Size and weight come from the role, colour from the tone, so a screen
 * never picks its own `fontSize`, `fontWeight` or white-at-some-opacity. SF Pro is resolved per platform
 * (theme/appleTypography.ts); this sets only size and weight, never a family or letter spacing.
 */
import React from 'react';
import { StyleSheet, Text as RNText, TextProps as RNTextProps } from 'react-native';
import { OnMedia, Signal, Typography } from '../constants/allegraTheme';

export type TextVariant =
  | 'hero' | 'display' | 'page' | 'detail' | 'playerTitle' | 'lead' | 'title'
  | 'row' | 'body' | 'secondary' | 'caption' | 'meta' | 'label';

export type TextTone = 'primary' | 'secondary' | 'muted' | 'accent' | 'danger' | 'onAccent';

const TONES: Record<TextTone, string> = {
  primary: Signal.ink,
  secondary: Signal.inkSoft,
  muted: Signal.inkMuted,
  accent: Signal.wave,
  danger: Signal.danger,
  onAccent: Signal.waveInk,
};

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  tone?: TextTone;
  /** Explicit artwork context; default tones are tested against opaque app surfaces. */
  onMedia?: boolean;
  /** Digits that change in place (times, counts) keep their width. */
  tabular?: boolean;
  align?: 'left' | 'center' | 'right';
}

export const Text: React.FC<TextProps> = ({ variant = 'body', tone = 'primary', onMedia, tabular, align, style, ...rest }) => (
  <RNText
    {...rest}
    style={[
      Typography[variant],
      { color: onMedia && tone === 'primary' ? OnMedia.primary : onMedia && tone === 'secondary' ? OnMedia.secondary : onMedia && tone === 'muted' ? OnMedia.muted : TONES[tone] },
      tabular && styles.tabular,
      align && { textAlign: align },
      style,
    ]}
  />
);

/** The text colours by tone, for icons that sit beside text. */
export const toneColor = (tone: TextTone): string => TONES[tone];

const styles = StyleSheet.create({
  tabular: { fontVariant: ['tabular-nums'] },
});
