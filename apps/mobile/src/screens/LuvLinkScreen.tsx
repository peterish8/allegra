import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackScreenProps } from '../types/navigation';
import { Signal } from '../constants/allegraTheme';
import LuvLinkPanel from '../components/luvLink/LuvLinkPanel';

const LuvLinkScreen: React.FC<RootStackScreenProps<'LuvLink'>> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back" style={styles.back}>
          <Ionicons name="chevron-back" size={23} color={Signal.ink} />
        </Pressable>
        <Text accessibilityRole="header" style={styles.heading}>LuvLink</Text>
        <View style={styles.spacer} />
      </View>
      <LuvLinkPanel />
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Signal.bgDeep },
  header: { minHeight: 54, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  heading: { color: Signal.ink, fontSize: 18, fontWeight: '700' },
  spacer: { flex: 1 },
});

export default LuvLinkScreen;
