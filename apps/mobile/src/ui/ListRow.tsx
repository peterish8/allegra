/**
 * Rows. `ListRow` is any tappable line in a list (a song, an artist, a device, a playlist, a setting that opens
 * something): leading slot, a title and an optional subtitle, a trailing slot. `SheetOption` is the simpler row
 * inside a sheet or menu: an optional icon, a label, a tick when chosen. Both press through `TactileRow`: the row
 * lights a glass step under the finger and sinks 1.5%.
 *
 * Rows share one height with every song list (`ROW_HEIGHT`, 56 with a 44 cover; `OPTION_HEIGHT`, 52) so every list in
 * the app has the same rhythm: title and subtitle one line each, ending in "…". They grow with large text.
 */
import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Control, OnMedia, Radius, Signal, Space, Surface } from '../constants/allegraTheme';
import { TactileRow } from '../components/allegra/motion';
import Artwork from '../components/allegra/Artwork';
import { Text } from './Text';
import type { IconName } from './Button';

export const ROW_HEIGHT = Control.row;
export const OPTION_HEIGHT = Control.option;
export const ROW_ART = Control.rowArtwork;

export interface ListRowProps {
  title: string;
  subtitle?: string;
  onPress?: () => void;
  /** The row's actions sheet. Long press means "actions" everywhere in the app. */
  onLongPress?: () => void;
  /** A cover. Drawn through `Artwork`, so a missing cover gets the generated one, never a grey box. */
  artwork?: { uri?: string; title: string; artist?: string; round?: boolean };
  /** An icon in a glass disc, for rows without artwork. */
  icon?: IconName;
  /** `plain`: the icon alone, no disc (menus on black, like Spotify's side menu). */
  iconStyle?: 'disc' | 'plain';
  /** Anything on the right: a duration, a download ring, a ••• IconButton, a chevron (`chevron`). */
  trailing?: React.ReactNode;
  chevron?: boolean;
  /** The playing or chosen row: its title takes the accent. */
  active?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export const ListRow: React.FC<ListRowProps> = ({ title, subtitle, onPress, onLongPress, artwork, icon, iconStyle = 'disc', trailing, chevron, active, disabled, accessibilityLabel, style }) => (
  <TactileRow
    onPress={onPress}
    onLongPress={onLongPress}
    delayLongPress={350}
    disabled={disabled || (!onPress && !onLongPress)}
    accessibilityRole="button"
    accessibilityLabel={accessibilityLabel ?? (subtitle ? `${title}, ${subtitle}` : title)}
    accessibilityState={{ selected: !!active, disabled: !!disabled }}
    accessibilityHint={onLongPress ? 'Long press for more' : undefined}
    style={[styles.row, disabled && styles.disabled, style]}
  >
    {artwork ? (
      <View style={[styles.art, artwork.round && styles.round]}>
        <Artwork uri={artwork.uri} title={artwork.title} artist={artwork.artist} size={ROW_ART} style={[StyleSheet.absoluteFill, artwork.round ? styles.round : styles.cover]} />
      </View>
    ) : icon ? (
      <View style={[styles.iconDisc, iconStyle === 'plain' && styles.iconPlain]}><Ionicons name={icon} size={iconStyle === 'plain' ? 24 : 20} color={OnMedia.secondary} /></View>
    ) : null}
    <View style={styles.text}>
      <Text variant="row" tone="primary" style={active && styles.activeTitle} numberOfLines={1} ellipsizeMode="tail">{title}</Text>
      {subtitle ? <Text variant="secondary" tone="muted" numberOfLines={1} ellipsizeMode="tail">{subtitle}</Text> : null}
    </View>
    {trailing}
    {chevron ? <Ionicons name="chevron-forward" size={18} color={OnMedia.muted} /> : null}
  </TactileRow>
);

export interface SheetOptionProps {
  label: string;
  onPress: () => void;
  icon?: IconName;
  /** Ticked: the current choice. */
  selected?: boolean;
  /** A quieter line under the label. */
  hint?: string;
  destructive?: boolean;
  disabled?: boolean;
  /** Something on the right instead of the tick (a value, a switch). */
  trailing?: React.ReactNode;
  /** Navigation ("Go to the artist"): a chevron on the right. */
  chevron?: boolean;
}

export const SheetOption: React.FC<SheetOptionProps> = ({ label, onPress, icon, selected, hint, destructive, disabled, trailing, chevron }) => {
  const ink = destructive ? Signal.danger : OnMedia.primary;
  return (
    <TactileRow
      onPress={onPress}
      haptic="select"
      disabled={disabled}
      accessibilityRole={selected === undefined ? 'button' : 'radio'}
      accessibilityLabel={label}
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      style={[styles.option, disabled && styles.disabled]}
    >
      {icon ? <Ionicons name={icon} size={20} color={ink} style={styles.optionIcon} /> : null}
      <View style={styles.text}>
        <Text variant="body" style={{ color: ink }} numberOfLines={1}>{label}</Text>
        {hint ? <Text variant="caption" tone="muted" numberOfLines={2}>{hint}</Text> : null}
      </View>
      {trailing ?? (selected ? <Ionicons name="checkmark" size={20} color={OnMedia.primary} />
        : chevron ? <Ionicons name="chevron-forward" size={18} color={OnMedia.muted} /> : null)}
    </TactileRow>
  );
};

export interface CheckRowProps {
  label: string;
  /** A second line: a count, what it matched, why it can't be picked. */
  detail?: string;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
}

/** A row that is picked or not (import choices, songs to add, playlists to put a song in). A real tick, never "✓" text. */
export const CheckRow: React.FC<CheckRowProps> = ({ label, detail, checked, onToggle, disabled }) => (
  <TactileRow
    onPress={onToggle}
    haptic="select"
    disabled={disabled}
    accessibilityRole="checkbox"
    accessibilityLabel={detail ? `${label}, ${detail}` : label}
    accessibilityState={{ checked, disabled: !!disabled }}
    style={[styles.option, disabled && styles.disabled]}
  >
    <Ionicons name={checked ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={checked ? Signal.wave : OnMedia.muted} />
    <View style={styles.text}>
      <Text variant="body" numberOfLines={1}>{label}</Text>
      {detail ? <Text variant="caption" tone="muted" numberOfLines={2}>{detail}</Text> : null}
    </View>
  </TactileRow>
);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    minHeight: ROW_HEIGHT,
    paddingVertical: (ROW_HEIGHT - ROW_ART) / 2,
    paddingHorizontal: Space.sm,
    borderRadius: Radius.control,
  },
  art: { width: ROW_ART, height: ROW_ART, borderRadius: Radius.cover, overflow: 'hidden' },
  cover: { borderRadius: Radius.cover },
  round: { borderRadius: ROW_ART / 2 },
  iconDisc: { width: Control.icon.md, height: Control.icon.md, borderRadius: Radius.control, alignItems: 'center', justifyContent: 'center', backgroundColor: Surface.control },
  iconPlain: { backgroundColor: 'transparent' },
  activeTitle: { fontWeight: '600' },
  text: { flex: 1, minWidth: 0, gap: 2 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    minHeight: OPTION_HEIGHT,
    paddingHorizontal: Space.sm - 2,
    paddingVertical: Space.xs,
    borderRadius: Space.sm,
  },
  optionIcon: { width: 24, textAlign: 'center' },
  disabled: { opacity: Control.disabledOpacity },
});
