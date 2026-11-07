/**
 * Your picture at the top left of Stream, Search and Library (1.42.0, Spotify's place). It opens the profile menu;
 * a dot on it says a newer build is waiting (About → Updates, inside the menu).
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Control, Signal, Surface, Tactile, Text } from '../../ui';
import { useAccount } from '../../services/account/AccountProvider';
import { useUpdateStore } from '../../store/updateStore';
import { useShellMenuStore } from '../../store/shellMenuStore';
import { profileButtonLabel, profileInitial } from '../../navigation/profileMenu';

/** The picture's size; its touch target is the full control target around it. */
export const PROFILE_PICTURE = 32;

export const ProfileButton: React.FC = () => {
  const { profile } = useAccount();
  const updateWaiting = useUpdateStore(s => s.available !== null);
  const open = useShellMenuStore(s => s.setProfileOpen);
  const initial = profileInitial(profile?.displayName);
  return (
    <Tactile onPress={() => open(true)} haptic="select" pressScale={0.92} accessibilityRole="button"
      accessibilityLabel={profileButtonLabel(updateWaiting)} wrapperStyle={styles.target} style={styles.target}>
      <View style={styles.picture}>
        {initial ? <Text variant="label" style={styles.initial}>{initial}</Text> : <Ionicons name="person" size={18} color={Signal.inkSoft} />}
      </View>
      {updateWaiting ? <View style={styles.dot} /> : null}
    </Tactile>
  );
};

const styles = StyleSheet.create({
  target: { width: Control.target, height: Control.target, alignItems: 'center', justifyContent: 'center' },
  picture: { width: PROFILE_PICTURE, height: PROFILE_PICTURE, borderRadius: PROFILE_PICTURE / 2, backgroundColor: Surface.control, alignItems: 'center', justifyContent: 'center' },
  initial: { fontWeight: '700' },
  dot: { position: 'absolute', top: 8, right: 8, width: 10, height: 10, borderRadius: 5, backgroundColor: Signal.ink, borderWidth: 2, borderColor: Surface.base },
});
