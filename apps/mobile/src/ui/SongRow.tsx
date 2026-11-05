import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Artwork from '../components/allegra/Artwork';
import { TactileRow } from '../components/allegra/motion';
import { Control, Radius, Signal, Space, Surface } from '../constants/allegraTheme';
import { IconButton, type IconName } from './Button';
import { Text } from './Text';

export interface SongRowProps {
  title: string;
  artist?: string;
  artwork?: string;
  meta?: string;
  playing?: boolean;
  downloaded?: boolean;
  onPress: () => void;
  onActions?: () => void;
  trailing?: React.ReactNode;
  actionIcon?: IconName;
  actionLabel?: string;
  onActionPress?: () => void;
}

/** Play target and action target are siblings, so TalkBack and taps reach both. */
export const SongRow: React.FC<SongRowProps> = React.memo(({ title, artist, artwork, meta, playing, downloaded, onPress, onActions, trailing, actionIcon, actionLabel, onActionPress }) => (
  <View style={styles.row}>
    <TactileRow onPress={onPress} onLongPress={onActions} accessibilityRole="button"
      accessibilityLabel={`${title}${artist ? ` by ${artist}` : ''}${playing ? ', playing' : ''}`}
      accessibilityHint={onActions ? 'Long press for song actions' : undefined}
      wrapperStyle={styles.mainTarget} style={styles.main}>
      <View style={styles.art}>
        <Artwork uri={artwork} title={title} artist={artist} size={Control.rowArtwork} style={StyleSheet.absoluteFill} />
        {playing ? <View style={styles.playing}><Ionicons name="musical-notes" size={12} color={Signal.waveInk} /></View> : null}
      </View>
      <View style={styles.copy}>
        <Text variant="row" style={playing && styles.active} numberOfLines={2}>{title}</Text>
        <View style={styles.meta}>
          {downloaded ? <Ionicons name="checkmark-done" size={14} color={Signal.inkMuted} accessibilityLabel="Downloaded" /> : null}
          <Text variant="secondary" tone="secondary" style={styles.metadata} numberOfLines={2}>{[artist, meta, playing ? 'Playing' : undefined].filter(Boolean).join(' · ')}</Text>
        </View>
      </View>
    </TactileRow>
    {trailing}
    {actionIcon && onActionPress ? <IconButton icon={actionIcon} label={actionLabel ?? `Actions for ${title}`} onPress={onActionPress} />
      : onActions ? <IconButton icon="ellipsis-vertical" label={`Actions for ${title}`} onPress={onActions} /> : null}
  </View>
));

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: Control.gutter, paddingRight: Space.xxs },
  mainTarget: { flex: 1, minWidth: 0 },
  main: { flexDirection: 'row', alignItems: 'center', minHeight: Control.row, gap: Space.sm, paddingVertical: Space.xs },
  art: { width: Control.rowArtwork, height: Control.rowArtwork, borderRadius: Radius.thumb },
  playing: { position: 'absolute', bottom: 0, right: 0, width: 20, height: 20, borderRadius: Radius.thumb, backgroundColor: Signal.wave, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0, gap: Space.xxs, paddingVertical: Space.xxs, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: Surface.divider },
  meta: { flexDirection: 'row', alignItems: 'center', gap: Space.xxs },
  metadata: { flex: 1 },
  active: { fontWeight: '600' },
});
