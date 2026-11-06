/**
 * The head of an actions sheet (Round 7 item 2): identity first. The cover (or a collection's mosaic), the name on one
 * line, what it is on one line ("Song · Mira Vale · 3:33"), and a close button. The sheet's primary pair and its
 * grouped actions follow it. Long press and ⋮ open the same sheet everywhere; it closes by dragging down, tapping the
 * dimmed page, Back, or ×.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Artwork from '../components/allegra/Artwork';
import { Radius, Space, Surface } from '../constants/allegraTheme';
import { IconButton } from './Button';
import { Text } from './Text';

export const IDENTITY_ART = 56;

export interface SheetIdentityProps {
  title: string;
  /** What it is and who made it, one line: "Song · Mira Vale · 3:33". */
  meta?: string;
  artwork?: { uri?: string; title: string; artist?: string; round?: boolean };
  /** A cover of the caller's own instead of `artwork` (a mix's mosaic). */
  cover?: React.ReactNode;
  onClose?: () => void;
}

/** "Song · Mira Vale · 3:33": the kind first, then whatever the caller knows, never an empty part. */
export const identityMeta = (kind: string, ...parts: (string | undefined | null | false)[]): string =>
  [kind, ...parts].filter((part): part is string => typeof part === 'string' && part.trim().length > 0).join(' · ');

export const SheetIdentity: React.FC<SheetIdentityProps> = ({ title, meta, artwork, cover, onClose }) => (
  <View style={styles.head} accessible={false}>
    {cover ?? (artwork ? (
      <View style={[styles.art, artwork.round && styles.round]}>
        <Artwork uri={artwork.uri} title={artwork.title} artist={artwork.artist} size={IDENTITY_ART} style={StyleSheet.absoluteFill} />
      </View>
    ) : null)}
    <View style={styles.text} accessible accessibilityRole="header" accessibilityLabel={meta ? `${title}, ${meta}` : title}>
      <Text variant="title" numberOfLines={1} ellipsizeMode="tail">{title}</Text>
      {meta ? <Text variant="secondary" tone="secondary" numberOfLines={1} ellipsizeMode="tail">{meta}</Text> : null}
    </View>
    {onClose ? <IconButton icon="close" label="Close" onPress={onClose} variant="plain" /> : null}
  </View>
);

/** A quiet line between a sheet's groups (actions · sharing · navigation). */
export const SheetDivider: React.FC = () => <View style={styles.divider} accessibilityElementsHidden importantForAccessibility="no" />;

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: Space.sm + 2, paddingLeft: Space.xxs, paddingTop: Space.xxs, paddingBottom: Space.xs },
  art: { width: IDENTITY_ART, height: IDENTITY_ART, borderRadius: Radius.thumb, overflow: 'hidden', backgroundColor: Surface.control },
  round: { borderRadius: IDENTITY_ART / 2 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Surface.divider, marginVertical: Space.xs - 2, marginHorizontal: Space.xs },
});
