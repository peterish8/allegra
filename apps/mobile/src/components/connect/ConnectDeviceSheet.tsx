import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { PlayerSheet, SheetScrollView } from '../player/PlayerSheet';
import { useConnect } from '../../services/connect/ConnectProvider';
import { useAccount } from '../../services/account/AccountProvider';
import { signInMessage } from '../../services/account/signInFlow';
import * as Haptics from '../../utils/haptics';

const transferError = (reason: string | undefined, targetName: string): string => {
  switch (reason) {
    case 'not_found': return `Couldn't find this song online, so it can't play on ${targetName}.`;
    case 'timeout': return `${targetName} isn't reachable. Open Allegra on it and try again.`;
    case 'offline': return 'Allegra could not be reached. Check your connection and try again.';
    default: return 'Playback could not be moved. Try again in a moment.';
  }
};

export const ConnectDeviceSheet: React.FC = () => {
  const connect = useConnect();
  const account = useAccount();
  const [busyDevice, setBusyDevice] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const signIn = async (): Promise<void> => {
    setMessage(null);
    try {
      const outcome = await account.signInWithGoogle();
      if (outcome !== 'signed-in') setMessage(signInMessage[outcome]);
    } catch {
      setMessage('Sign-in could not be completed. Please try again.');
    }
  };

  const transfer = async (targetDeviceId: string): Promise<void> => {
    if (!connect.view || busyDevice) return;
    if (targetDeviceId === connect.view.activeDeviceId) {
      connect.closeDevices();
      return;
    }
    Haptics.selectionAsync().catch(() => undefined);
    setBusyDevice(targetDeviceId);
    setMessage(null);
    try {
      const result = await connect.transferTo(targetDeviceId);
      if (result.ok) connect.closeDevices();
      else setMessage(transferError('reason' in result ? result.reason : undefined, view.devices.find(device => device.deviceId === targetDeviceId)?.name ?? 'that device'));
    } catch {
      setMessage(transferError(undefined, view.devices.find(device => device.deviceId === targetDeviceId)?.name ?? 'that device'));
    } finally {
      setBusyDevice(null);
    }
  };

  const view = connect.view;
  return (
    <PlayerSheet visible={connect.devicesVisible} title="Connect devices" tall onClose={connect.closeDevices}>
      <SheetScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>Move playback between your phone and Allegra on the web.</Text>
        {!account.signedIn ? (
          <Pressable accessibilityRole="button" style={styles.action} onPress={signIn}>
            <Ionicons name="person-circle-outline" size={23} color="#fff" />
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle}>{account.loading ? 'Checking your account' : 'Sign in to Allegra'}</Text>
              <Text style={styles.rowHint}>Sign in with Google to play on your other devices.</Text>
            </View>
            {account.loading ? <ActivityIndicator color="#fff" /> : <Ionicons name="chevron-forward" size={20} color="#aaa" />}
          </Pressable>
        ) : view ? (
          <>
            {view.activeDevice ? (
              <View style={styles.active}>
                <Ionicons name="musical-notes" size={19} color="#d9e66a" />
                <Text style={styles.activeText} numberOfLines={1}>Playing on {view.activeDevice.name}</Text>
              </View>
            ) : <Text style={styles.empty}>Start playback on a signed-in device to connect it.</Text>}
            {[...view.devices].sort((a, b) => Number(b.deviceId === connect.deviceId) - Number(a.deviceId === connect.deviceId)).map(device => {
              const isActive = view.activeDeviceId === device.deviceId;
              const isThisPhone = device.deviceId === connect.deviceId;
              const trackUnavailable = Boolean(view.activeDeviceId && !view.song);
              const unavailable = !device.isOnline || !device.canPlay || (trackUnavailable && !isActive);
              const busy = busyDevice === device.deviceId;
              const trackUnavailableLabel = view.activeDeviceId === connect.deviceId
                ? 'This song is only on your phone'
                : 'This song is only on the playing device';
              const status = isActive
                ? 'Playing here'
                : trackUnavailable
                  ? trackUnavailableLabel
                  : !device.isOnline
                    ? 'Offline'
                    : !device.canPlay
                      ? 'In a Listen Together room'
                      : 'Ready';
              return (
                <Pressable
                  key={device.deviceId}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: unavailable || busy }}
                  disabled={unavailable || busy}
                  onPress={() => transfer(device.deviceId)}
                  style={({ pressed }) => [styles.device, pressed && styles.pressed, unavailable && styles.unavailable]}
                >
                  <Ionicons name={device.kind === 'web' ? 'laptop-outline' : 'phone-portrait-outline'} size={22} color={isActive ? '#d9e66a' : '#fff'} />
                  <View style={styles.rowCopy}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{device.name}{isThisPhone ? ' · this phone' : ''}</Text>
                    <Text style={styles.rowHint}>{status}</Text>
                  </View>
                  {busy ? <ActivityIndicator color="#fff" /> : isActive ? <Ionicons name="checkmark-circle" size={21} color="#d9e66a" /> : !unavailable ? <Ionicons name="arrow-forward-circle-outline" size={21} color="#ddd" /> : null}
                </Pressable>
              );
            })}
            {view.devices.length === 0 ? <Text style={styles.empty}>No other signed-in devices yet.</Text> : null}
          </>
        ) : (
          <View style={styles.loading}><ActivityIndicator color="#fff" /><Text style={styles.rowHint}>Connecting to Allegra…</Text></View>
        )}
        {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
      </SheetScrollView>
    </PlayerSheet>
  );
};

const styles = StyleSheet.create({
  content: { paddingTop: 6, paddingBottom: 12, gap: 8 },
  intro: { color: 'rgba(255,255,255,0.72)', fontSize: 14, lineHeight: 20, paddingHorizontal: 4, marginBottom: 4 },
  active: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 6, paddingVertical: 12 },
  activeText: { color: '#fff', fontSize: 15, fontWeight: '600', flex: 1 },
  device: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 64, paddingHorizontal: 14, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.07)' },
  action: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 66, paddingHorizontal: 14, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.07)' },
  rowCopy: { flex: 1 },
  rowTitle: { color: '#fff', fontSize: 15, fontWeight: '600' },
  rowHint: { color: 'rgba(255,255,255,0.6)', fontSize: 13, marginTop: 4 },
  empty: { color: 'rgba(255,255,255,0.6)', fontSize: 14, lineHeight: 20, padding: 12 },
  loading: { minHeight: 80, alignItems: 'center', justifyContent: 'center', gap: 12 },
  message: { color: '#ff9a91', fontSize: 13, lineHeight: 19, paddingHorizontal: 6, paddingTop: 4 },
  pressed: { backgroundColor: 'rgba(255,255,255,0.14)' },
  unavailable: { opacity: 0.58 },
});

export default ConnectDeviceSheet;
