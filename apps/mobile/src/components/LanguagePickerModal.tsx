/**
 * Luvs languages: a frosted sheet of chips, at least one always on.
 */

import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Glass, Signal } from '../constants/allegraTheme';
import { luvsEngine } from '../services/luvsEngine';
import { LuvLanguage, useLuvsPreferencesStore } from '../store/luvsPreferencesStore';
import { Button, Sheet, SheetScrollView, Tactile } from '../ui';

const AVAILABLE_LANGUAGES: LuvLanguage[] = [
  'English', 'Hindi', 'Tamil', 'Telugu', 'Punjabi',
  'Korean', 'Kannada', 'Malayalam', 'Bengali', 'Marathi',
];

interface LanguagePickerModalProps {
  visible: boolean;
  onClose: () => void;
}

export const LanguagePickerModal: React.FC<LanguagePickerModalProps> = ({ visible, onClose }) => {
  const preferredLanguages = useLuvsPreferencesStore(s => s.preferredLanguages);
  const setPreferredLanguages = useLuvsPreferencesStore(s => s.setPreferredLanguages);
  const [selectedLanguages, setSelectedLanguages] = useState<LuvLanguage[]>(() =>
    preferredLanguages.filter(l => l.weight > 0).map(l => l.language)
  );

  const toggleLanguage = (language: LuvLanguage) => {
    if (selectedLanguages.includes(language)) {
      if (selectedLanguages.length === 1) return;
      setSelectedLanguages(selectedLanguages.filter(l => l !== language));
    } else {
      setSelectedLanguages([...selectedLanguages, language]);
    }
  };

  const handleSave = () => {
    setPreferredLanguages(selectedLanguages);
    // The native engine keeps its own persisted copy, so it has to be told too —
    // the next feed it builds is filtered against this list.
    luvsEngine.setLanguages(selectedLanguages);
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Languages for Luvs">
      <Text style={styles.subtitle}>Luvs mixes songs in the ones you pick.</Text>

      <SheetScrollView style={styles.languageList} contentContainerStyle={styles.chips} showsVerticalScrollIndicator={false}>
        {AVAILABLE_LANGUAGES.map((language) => {
          const isSelected = selectedLanguages.includes(language);
          return (
            <Tactile
              key={language}
              style={[styles.chip, isSelected && styles.chipOn]}
              onPress={() => toggleLanguage(language)}
              haptic="select"
              accessibilityRole="checkbox"
              accessibilityLabel={language}
              accessibilityState={{ checked: isSelected }}
            >
              {isSelected ? <Ionicons name="checkmark" size={16} color={Signal.waveInk} /> : null}
              <Text style={[styles.chipText, isSelected && styles.chipTextOn]}>{language}</Text>
            </Tactile>
          );
        })}
      </SheetScrollView>

      <View style={styles.actions}>
        <View style={styles.action}>
          <Button label="Cancel" variant="glass" block onPress={onClose} />
        </View>
        <View style={styles.action}>
          <Button label="Save" variant="primary" block onPress={handleSave} />
        </View>
      </View>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  subtitle: { fontSize: 14, color: Signal.inkSoft, marginBottom: 18, marginLeft: 4 },
  languageList: { maxHeight: 360, flexGrow: 0 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingBottom: 4 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 11, paddingHorizontal: 16, borderRadius: 999, backgroundColor: Glass.fillLight, borderWidth: StyleSheet.hairlineWidth, borderColor: Glass.hairlineStrong },
  chipOn: { backgroundColor: Signal.wave, borderColor: Signal.wave },
  chipText: { fontSize: 15, fontWeight: '600', color: Signal.ink },
  chipTextOn: { color: Signal.waveInk },
  actions: { flexDirection: 'row', marginTop: 22, gap: 12 },
  action: { flex: 1 },
});
