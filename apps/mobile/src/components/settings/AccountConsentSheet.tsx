import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MINIMUM_AGE } from '@shared/legal';
import { Frosted } from '../allegra/Frosted';
import { Tactile } from '../allegra/motion';
import { Glass, Signal } from '../../constants/allegraTheme';

/** One consent gate for every phone sign-in entry point. */
export const AccountConsentSheet: React.FC<{ visible: boolean; onAnswer: (agreed: boolean) => void }> = ({ visible, onAnswer }) => {
  const [checked, setChecked] = useState(false);
  useEffect(() => { if (visible) setChecked(false); }, [visible]);
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={() => onAnswer(false)}>
    <View style={styles.overlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => onAnswer(false)} accessibilityLabel="Cancel sign-in" />
      <View style={styles.panel}>
        <Frosted radius={26} intensity={60} tint={0.5} />
        <Text style={styles.title}>Keep your music</Text>
        <Text style={styles.body}>Your Google name and email, likes, playlists and listening preferences are kept in your Allegra account. You can stop learning from listening, download your data or delete your account from the website.</Text>
        <Text style={styles.body}>Read Allegra’s Privacy policy and Terms on the website before agreeing.</Text>
        <Tactile accessibilityRole="checkbox" accessibilityState={{ checked }} accessibilityLabel={`I am ${MINIMUM_AGE} or older and agree to Allegra’s Terms and Privacy policy`} onPress={() => setChecked(!checked)} style={styles.check}>
          <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={24} color={checked ? Signal.accent : Signal.inkSoft} />
          <Text style={[styles.body, styles.checkText]}>I am {MINIMUM_AGE} or older and agree to the Terms and Privacy policy.</Text>
        </Tactile>
        <View style={styles.actions}>
          <Tactile onPress={() => onAnswer(false)} style={styles.button} wrapperStyle={styles.cell}><Text style={styles.buttonText}>Cancel</Text></Tactile>
          <Tactile disabled={!checked} accessibilityState={{ disabled: !checked }} onPress={() => onAnswer(true)} style={[styles.button, checked ? styles.primary : styles.disabled]} wrapperStyle={styles.cell}><Text style={styles.buttonText}>Continue</Text></Tactile>
        </View>
      </View>
    </View>
  </Modal>;
};
const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Glass.scrim },
  panel: { width: '88%', maxWidth: 400, borderRadius: 26, overflow: 'hidden', padding: 24, gap: 16 },
  title: { color: Signal.ink, fontSize: 22, fontWeight: '700' },
  body: { color: Signal.inkSoft, fontSize: 14, lineHeight: 21 },
  check: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  checkText: { flex: 1 },
  actions: { flexDirection: 'row', gap: 12 },
  cell: { flex: 1 },
  button: { borderRadius: 999, paddingVertical: 14, alignItems: 'center', backgroundColor: Glass.fillLight },
  primary: { backgroundColor: Signal.accent },
  disabled: { opacity: 0.4 },
  buttonText: { color: Signal.ink, fontWeight: '600', fontSize: 15 },
});
