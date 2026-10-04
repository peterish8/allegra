/**
 * What Connect has to tell the listener about where a pick played, over every screen:
 *
 *   - a short notice ("Chrome on Windows is offline, so this plays here."), and
 *   - the question for a song only this phone has, picked while another device plays: play it
 *     here (the other device stops), or leave things as they are.
 *
 * Mounted once in RootNavigator, beside the device sheet.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { PlayerSheet } from '../player/PlayerSheet';
import { Toast } from '../Toast';
import { useConnect } from '../../services/connect/ConnectProvider';
import * as Haptics from '../../utils/haptics';

export const ConnectNoticeHost: React.FC = () => {
  const connect = useConnect();
  const { choice, toast, resolveChoice, dismissToast } = connect;

  const answer = (playHere: boolean): void => {
    Haptics.selectionAsync().catch(() => undefined);
    resolveChoice(playHere);
  };

  return (
    <>
      {/* A new notice is a new toast: it slides in again even when the words repeat. */}
      <Toast key={toast?.at ?? 0} visible={toast !== null} message={toast?.message ?? ''} type="info" onDismiss={dismissToast} duration={3200} />
      <PlayerSheet visible={choice !== null} title="Play on this phone?" onClose={() => resolveChoice(false)}>
        {choice ? (
          <View style={styles.content}>
            <Text style={styles.body}>
              “{choice.title}” is only on this phone, so {choice.deviceName} can’t play it. Playing it here stops {choice.deviceName}.
            </Text>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.action, pressed && styles.pressed]}
              onPress={() => answer(true)}
            >
              <Ionicons name="phone-portrait-outline" size={22} color="#fff" />
              <Text style={styles.actionTitle}>Play on this phone</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.action, pressed && styles.pressed]}
              onPress={() => answer(false)}
            >
              <Ionicons name="close" size={22} color="rgba(255,255,255,0.72)" />
              <Text style={styles.actionQuiet}>Keep playing on {choice.deviceName}</Text>
            </Pressable>
          </View>
        ) : null}
      </PlayerSheet>
    </>
  );
};

const styles = StyleSheet.create({
  content: { paddingTop: 6, paddingBottom: 12, gap: 8 },
  body: { color: 'rgba(255,255,255,0.78)', fontSize: 15, lineHeight: 21, paddingHorizontal: 4, marginBottom: 6 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 58, paddingHorizontal: 16, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.07)' },
  actionTitle: { color: '#fff', fontSize: 15, fontWeight: '600', flex: 1 },
  actionQuiet: { color: 'rgba(255,255,255,0.78)', fontSize: 15, flex: 1 },
  pressed: { backgroundColor: 'rgba(255,255,255,0.14)' },
});

export default ConnectNoticeHost;
