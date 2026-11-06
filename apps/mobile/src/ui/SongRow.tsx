import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSpring } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import Artwork from '../components/allegra/Artwork';
import { TactileRow } from '../components/allegra/motion';
import { Control, Motion, Radius, Signal, Space, Surface } from '../constants/allegraTheme';
import { IconButton, type IconName } from './Button';
import { Text } from './Text';
import { songRowSubtitle } from './round7Rules';

export interface SongRowProps {
  title: string;
  artist?: string;
  artwork?: string;
  meta?: string;
  playing?: boolean;
  downloaded?: boolean;
  onPress: () => void;
  onActions?: () => void;
  /** A control between the main target and the ⋮, such as the Download button. It brings its own 48dp target. */
  trailing?: React.ReactNode;
  actionIcon?: IconName;
  actionLabel?: string;
  onActionPress?: () => void;
}

export { songRowSubtitle };

/**
 * Every song list's row (Round 7 item 9 and the lists rule): 56 tall, a 44 cover with 6dp corners, the title on one
 * line and the artist on one line, each ending in "…". The main target (cover, text and the blank space after it)
 * plays the song; Download and ⋮ are their own 48dp targets beside it, so TalkBack and taps reach each one. With large
 * text the row grows to fit its two lines and the controls keep their targets.
 */
export const SongRow: React.FC<SongRowProps> = React.memo(({ title, artist, artwork, meta, playing, downloaded, onPress, onActions, trailing, actionIcon, actionLabel, onActionPress }) => {
  const subtitle = songRowSubtitle(artist, meta, playing);
  // Pressing the song lights the whole row edge to edge, Download and ⋮ included (owner, 1.41.0), not only the main
  // target. Held at least 70ms so a quick tap is seen, like every other press.
  const pressed = useSharedValue(0);
  const downAt = React.useRef(0);
  const light = useAnimatedStyle(() => ({ opacity: pressed.value }));
  return (
    <View style={styles.row}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.pressed, light]} />
      <TactileRow onPress={onPress} onLongPress={onActions} accessibilityRole="button" pressedColor="transparent"
        onPressIn={() => { downAt.current = Date.now(); pressed.value = withSpring(1, Motion.spring.tactile); }}
        onPressOut={() => {
          const held = Date.now() - downAt.current;
          pressed.value = withDelay(Math.max(0, ROW_PRESS_HOLD_MS - held), withSpring(0, Motion.spring.tactile));
        }}
        accessibilityLabel={`${title}${artist ? ` by ${artist}` : ''}${playing ? ', playing' : ''}`}
        accessibilityHint={onActions ? 'Long press for song actions' : undefined}
        wrapperStyle={styles.mainTarget} style={styles.main}>
        <View style={styles.art}>
          <Artwork uri={artwork} title={title} artist={artist} size={Control.rowArtwork} style={styles.cover} />
          {playing ? <View style={styles.playing}><Ionicons name="musical-notes" size={12} color={Signal.waveInk} /></View> : null}
        </View>
        <View style={styles.copy}>
          <Text variant="row" style={playing && styles.active} numberOfLines={1} ellipsizeMode="tail">{title}</Text>
          {subtitle || downloaded ? (
            <View style={styles.meta}>
              {downloaded ? <Ionicons name="checkmark-done" size={14} color={Signal.inkMuted} accessibilityLabel="Downloaded" /> : null}
              <Text variant="secondary" tone="secondary" style={styles.metadata} numberOfLines={1} ellipsizeMode="tail">{subtitle}</Text>
            </View>
          ) : null}
        </View>
      </TactileRow>
      {trailing}
      {actionIcon && onActionPress ? <IconButton icon={actionIcon} label={actionLabel ?? `Actions for ${title}`} onPress={onActionPress} variant="plain" />
        : onActions ? <IconButton icon="ellipsis-vertical" label={`More actions for ${title}`} onPress={onActions} variant="plain" /> : null}
    </View>
  );
});

const COVER_INSET = (Control.row - Control.rowArtwork) / 2;
/** The shortest a press is shown for (the same hold as `Tactile`). */
const ROW_PRESS_HOLD_MS = 70;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: Control.row, paddingLeft: Space.xs, paddingRight: Space.xxs },
  pressed: { backgroundColor: Surface.control },
  mainTarget: { flex: 1, minWidth: 0, alignSelf: 'stretch' },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: Control.row, gap: Space.sm, paddingVertical: COVER_INSET, paddingHorizontal: Space.xs, borderRadius: Radius.control },
  art: { width: Control.rowArtwork, height: Control.rowArtwork, borderRadius: Radius.cover, overflow: 'hidden' },
  cover: { ...StyleSheet.absoluteFillObject, borderRadius: Radius.cover },
  playing: { position: 'absolute', bottom: 0, right: 0, width: 18, height: 18, borderTopLeftRadius: Radius.cover, backgroundColor: Signal.wave, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: Space.xxs },
  metadata: { flex: 1, minWidth: 0 },
  active: { fontWeight: '600' },
});
