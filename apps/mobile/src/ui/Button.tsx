/**
 * Buttons. Three shapes cover the app:
 *
 *   <Button label="Play" icon="play" />                 a pill with a label (and an optional leading icon)
 *   <IconButton icon="ellipsis-horizontal" label="More" />   a round icon-only control; `label` is its accessible name
 *   <TextButton label="See all" onPress={…} />           quiet inline text action (a shelf link, "Undo")
 *
 * Variants: `primary` (the chartreuse action — one per screen at most), `glass` (default: clear glass with a
 * hairline), `plain` (no surface; icons over artwork), `danger` (destructive). Every one presses through
 * `Tactile`: it sinks and dims under the finger for at least 70ms.
 */
import React from 'react';
import { ActivityIndicator, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Control, Radius, Signal, Space, Surface, TypeScale } from '../constants/allegraTheme';
import { Tactile } from '../components/allegra/motion';
import { Text } from './Text';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];
export type ButtonVariant = 'primary' | 'secondary' | 'glass' | 'plain' | 'danger';

const INK: Record<ButtonVariant, string> = {
  primary: Signal.waveInk,
  secondary: Signal.ink,
  glass: Signal.ink,
  plain: Signal.ink,
  danger: Signal.waveInk,
};

const SURFACE: Record<ButtonVariant, ViewStyle> = {
  primary: { backgroundColor: Signal.wave },
  secondary: { backgroundColor: Surface.control },
  // Compatibility alias while callers migrate; controls are opaque in V6.
  glass: { backgroundColor: Surface.control },
  plain: {},
  danger: { backgroundColor: Signal.danger },
};

export interface ButtonProps {
  label: string;
  onPress: () => void;
  icon?: IconName;
  variant?: ButtonVariant;
  /** Both sizes have a 48dp target; sm uses a quieter label and less padding. */
  size?: 'md' | 'sm';
  /** Stretch to the container's width. */
  block?: boolean;
  disabled?: boolean;
  /** Shows a spinner in place of the icon and ignores presses. */
  busy?: boolean;
  /** Overrides the accessible name when the label alone is ambiguous. */
  accessibilityLabel?: string;
  haptic?: 'select' | 'light';
  style?: StyleProp<ViewStyle>;
}

export const Button: React.FC<ButtonProps> = ({ label, onPress, icon, variant = 'secondary', size = 'md', block, disabled, busy, accessibilityLabel, haptic, style }) => {
  const ink = INK[variant];
  const iconSize = size === 'sm' ? 16 : 18;
  return (
    <Tactile
      onPress={busy ? undefined : onPress}
      disabled={disabled || busy}
      haptic={haptic}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled || !!busy, busy: !!busy }}
      wrapperStyle={block ? styles.block : undefined}
      style={[styles.button, size === 'sm' && styles.small, SURFACE[variant], disabled && styles.disabled, style]}
    >
      {busy ? <ActivityIndicator size="small" color={ink} /> : icon ? <Ionicons name={icon} size={iconSize} color={ink} /> : null}
      <Text variant="label" style={[styles.label, { color: ink }, size === 'sm' && styles.smallText]}>{label}</Text>
    </Tactile>
  );
};

/** Round icon buttons come in three sizes, so the same kind of control is the same size everywhere. */
const ICON_SIZES = Control.icon;
const GLYPH = Control.glyph;

export interface IconButtonProps {
  icon: IconName;
  /** The accessible name ("More", "Close", "Shuffle"). Required: an icon has no words of its own. */
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  /** `sm` 36, `md` 40 (default: toolbars, headers), `lg` 44 (the player's footer row). Touch area is at least 48. */
  size?: keyof typeof ICON_SIZES;
  /** Lit: a toggle that is on (lyrics shown, repeat on). White glass, never the accent. */
  selected?: boolean;
  /** Discs are reserved for people and player controls. */
  shape?: 'control' | 'disc';
  disabled?: boolean;
  /** Draw a custom glyph instead of an Ionicon (another icon family, a morphing icon). */
  children?: React.ReactNode;
  haptic?: 'select' | 'light';
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

export const IconButton: React.FC<IconButtonProps> = ({ icon, label, onPress, variant = 'plain', size = 'md', selected, shape = 'control', disabled, children, haptic, onLongPress, style }) => {
  const box = ICON_SIZES[size];
  const ink = selected ? Signal.bgDeep : INK[variant];
  return (
    <Tactile
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      haptic={haptic}
      wrapperStyle={styles.iconTarget}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected: !!selected }}
      style={[styles.icon, { width: box, height: box, borderRadius: shape === 'disc' ? box / 2 : Radius.control }, SURFACE[variant], selected && styles.selected, disabled && styles.disabled, style]}
    >
      {children ?? <Ionicons name={icon} size={GLYPH[size]} color={ink} />}
    </Tactile>
  );
};

export const TextButton: React.FC<{ label: string; onPress: () => void; icon?: IconName; tone?: 'secondary' | 'accent' | 'danger'; accessibilityLabel?: string }> = ({ label, onPress, icon, tone = 'secondary', accessibilityLabel }) => (
  <Tactile onPress={onPress} pressScale={0.97} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} style={styles.text}>
    <Text variant="secondary" tone={tone} style={styles.textLabel}>{label}</Text>
    {icon ? <Ionicons name={icon} size={14} color={tone === 'accent' ? Signal.wave : tone === 'danger' ? Signal.danger : Signal.inkSoft} /> : null}
  </Tactile>
);

/** Buttons side by side with the standard gap. */
export const ButtonRow: React.FC<{ children: React.ReactNode; style?: StyleProp<ViewStyle> }> = ({ children, style }) => (
  <View style={[styles.row, style]}>{children}</View>
);

const styles = StyleSheet.create({
  block: { alignSelf: 'stretch' },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.xs,
    minHeight: Control.button,
    paddingVertical: Space.sm,
    paddingHorizontal: Space.lg - Space.xxs,
    borderRadius: Radius.control,
  },
  small: { minHeight: Control.compactButton, paddingHorizontal: Space.md },
  label: { flexShrink: 1, textAlign: 'center' },
  smallText: { fontSize: TypeScale.secondary },
  disabled: { opacity: Control.disabledOpacity },
  icon: { alignItems: 'center', justifyContent: 'center' },
  iconTarget: { minWidth: Control.target, minHeight: Control.target, alignItems: 'center', justifyContent: 'center' },
  selected: { backgroundColor: Signal.wave, borderColor: Signal.wave },
  text: { minHeight: Control.target, flexDirection: 'row', alignItems: 'center', gap: Space.xxs, paddingVertical: Space.xxs },
  textLabel: { fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
});
