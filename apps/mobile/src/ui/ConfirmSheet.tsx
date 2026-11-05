/**
 * The one way the app asks before doing something it can't undo. A short `Sheet` with the question, one line of
 * consequence, and two buttons: the action (named for what it does — "Delete playlist", never "OK") and Cancel.
 *
 *   <ConfirmSheet visible={asking} title="Delete “Road trip”?" body="Songs stay in your library."
 *     confirmLabel="Delete playlist" destructive onConfirm={remove} onClose={() => setAsking(false)} />
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Space } from '../constants/allegraTheme';
import { Sheet } from './Sheet';
import { Text } from './Text';
import { Button } from './Button';
import * as Haptics from '../utils/haptics';

export interface ConfirmSheetProps {
  visible: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export const ConfirmSheet: React.FC<ConfirmSheetProps> = ({ visible, title, body, confirmLabel, cancelLabel = 'Cancel', destructive, busy, onConfirm, onClose }) => (
  <Sheet visible={visible} onClose={onClose}>
    <View style={styles.content}>
      <Text variant="lead" accessibilityRole="header">{title}</Text>
      {body ? <Text variant="body" tone="secondary">{body}</Text> : null}
      <View style={styles.actions}>
        <Button
          label={confirmLabel}
          variant={destructive ? 'danger' : 'primary'}
          block
          busy={busy}
          onPress={() => { Haptics.commit(); onConfirm(); }}
        />
        <Button label={cancelLabel} variant="plain" block onPress={onClose} />
      </View>
    </View>
  </Sheet>
);

const styles = StyleSheet.create({
  content: { gap: Space.xs, paddingHorizontal: Space.xxs, paddingTop: Space.xxs },
  actions: { gap: Space.xs, marginTop: Space.md },
});
