import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';

import { Signal } from '../../constants/allegraTheme';
import { useConnect } from '../../services/connect/ConnectProvider';
import { ConnectDeviceList } from './ConnectDeviceSheet';

/** The Stream header and the player picker share the same session and device actions. */
export function ConnectDropdown(): React.JSX.Element {
  const connect = useConnect();
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [focused, width, height, connect.signedIn]);
  const close = (): void => setOpen(false);
  return (
    <>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={connect.view?.activeDevice ? `Connect, playing on ${connect.view.activeDevice.name}` : 'Connect devices'}
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen(true)}
          style={styles.trigger}
        >
          <Ionicons name="hardware-chip-outline" size={19} color={connect.remotePlayback ? Signal.wave : Signal.ink} />
          <Text style={styles.label}>Connect</Text>
          <Ionicons name="chevron-down" size={13} color={Signal.inkMuted} />
        </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
        <Pressable style={styles.backdrop} onPress={close} accessibilityRole="button" accessibilityLabel="Close Connect devices" />
        <View accessibilityViewIsModal style={[styles.menu, { height: Math.min(height * 0.5 + insets.bottom, height - insets.top - 16), paddingBottom: Math.max(12, insets.bottom) }]}>
          <View style={styles.heading}>
            <Text accessibilityRole="header" style={styles.title}>Connect devices</Text>
            <Pressable onPress={close} style={styles.close} accessibilityRole="button" accessibilityLabel="Close Connect devices">
              <Ionicons name="close" size={22} color={Signal.inkMuted} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <ConnectDeviceList onClose={close} />
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)' },
  label: { fontSize: 13, fontWeight: '600', color: Signal.ink },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)' },
  menu: { position: 'absolute', bottom: 0, left: 0, right: 0, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 12, backgroundColor: Signal.bg, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.2)' },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 6, paddingBottom: 12 },
  title: { fontSize: 17, fontWeight: '600', color: Signal.ink },
});
