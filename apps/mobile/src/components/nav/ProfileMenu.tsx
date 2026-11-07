/**
 * The profile menu (1.42.0): Spotify's side menu, opened from your picture at the top left of Stream, Search and
 * Library. It holds what the You tab did: About and updates first, then your DJ, Downloads, Import, Blends, LuvLink,
 * Connect devices and Settings (`navigation/profileMenu`).
 *
 * A panel slides in from the left over a dimmed app (transform and opacity only; a fade under Reduce Motion). Back,
 * a tap outside or picking a row closes it. About and Downloads open as their own sheets once it has closed.
 */
import React, { useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ListRow, Motion, Signal, Space, Surface, Tactile, Text } from '../../ui';
import { useAccount } from '../../services/account/AccountProvider';
import { useUpdateStore } from '../../store/updateStore';
import { useShellMenuStore } from '../../store/shellMenuStore';
import { PROFILE_GROUPS, aboutRowTitle, profileInitial, type ProfileAction } from '../../navigation/profileMenu';
import AboutSheet from '../about/AboutSheet';
import { DownloadQueueModal } from '../DownloadQueueModal';
import { PROFILE_PICTURE } from './ProfileButton';

/** The panel's width: most of a phone, never wider than a comfortable reading column. */
const PANEL_MAX = 340;
const SCRIM_OPACITY = 0.62;

export const ProfileMenu: React.FC<{ onAction: (action: Exclude<ProfileAction, 'about' | 'downloads'>) => void }> = ({ onAction }) => {
  const open = useShellMenuStore(s => s.profileOpen);
  const setOpen = useShellMenuStore(s => s.setProfileOpen);
  const { profile, signedIn } = useAccount();
  const updateWaiting = useUpdateStore(s => s.available !== null);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduce = useReducedMotion();
  const panelWidth = Math.min(PANEL_MAX, Math.round(width * 0.84));
  const [about, setAbout] = useState(false);
  const [downloads, setDownloads] = useState(false);
  const shown = useSharedValue(0);
  useEffect(() => {
    shown.value = withTiming(open ? 1 : 0, { duration: open ? Motion.duration.base : Motion.duration.fast, easing: open ? Motion.ease.decelerate : Motion.ease.accelerate });
  }, [open, shown]);
  const scrim = useAnimatedStyle(() => ({ opacity: SCRIM_OPACITY * shown.value }));
  const panel = useAnimatedStyle(() => ({
    opacity: reduce ? shown.value : 1,
    transform: [{ translateX: reduce ? 0 : (shown.value - 1) * panelWidth }],
  }));
  const close = () => setOpen(false);
  const pick = (action: ProfileAction) => {
    close();
    if (action === 'about') setAbout(true);
    else if (action === 'downloads') setDownloads(true);
    else onAction(action);
  };
  const initial = profileInitial(profile?.displayName);
  const name = profile?.displayName?.trim() || (signedIn ? 'Your account' : 'Not signed in');

  return <>
    <Modal visible={open} transparent animationType="none" statusBarTranslucent onRequestClose={close}>
      <Tactile style={StyleSheet.absoluteFill} wrapperStyle={StyleSheet.absoluteFill} pressScale={1} onPress={close} accessible={false} importantForAccessibility="no" accessibilityElementsHidden>
        <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrim]} />
      </Tactile>
      <Animated.View style={[styles.panel, { width: panelWidth, paddingTop: insets.top + Space.md }, panel]} accessibilityViewIsModal>
        <View style={styles.identity}>
          <View style={styles.picture}>
            {initial ? <Text variant="title">{initial}</Text> : <Ionicons name="person" size={26} color={Signal.inkSoft} />}
          </View>
          <View style={styles.identityText}>
            <Text variant="title" numberOfLines={1} accessibilityRole="header">{name}</Text>
            {profile?.email ? <Text variant="meta" tone="secondary" numberOfLines={1}>{profile.email}</Text> : null}
          </View>
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + Space.lg }}>
          <ListRow title={aboutRowTitle(updateWaiting)} subtitle="What's new, updates and feedback" icon="information-circle-outline" chevron onPress={() => pick('about')} />
          {PROFILE_GROUPS.map(group => <View key={group.label}>
            <Text variant="meta" tone="secondary" style={styles.group}>{group.label}</Text>
            {group.items.map(item => (
              <ListRow key={item.id} title={item.title} subtitle={item.subtitle} icon={item.icon} chevron onPress={() => pick(item.id)} />
            ))}
          </View>)}
        </ScrollView>
      </Animated.View>
    </Modal>
    <AboutSheet visible={about} onClose={() => setAbout(false)} />
    <DownloadQueueModal visible={downloads} onClose={() => setDownloads(false)} />
  </>;
};

const styles = StyleSheet.create({
  scrim: { backgroundColor: Surface.scrim },
  panel: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: Surface.raised },
  identity: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingHorizontal: Space.md, paddingBottom: Space.md },
  picture: { width: PROFILE_PICTURE * 1.5, height: PROFILE_PICTURE * 1.5, borderRadius: PROFILE_PICTURE * 0.75, backgroundColor: Surface.control, alignItems: 'center', justifyContent: 'center' },
  identityText: { flex: 1, minWidth: 0 },
  group: { paddingHorizontal: Space.md, paddingTop: Space.lg, paddingBottom: Space.xs },
});
