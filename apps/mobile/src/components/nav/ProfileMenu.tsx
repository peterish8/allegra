/**
 * The profile menu (1.42.0): Spotify's side menu, opened from your picture at the top left of Stream, Search and
 * Library. It holds what the You tab did: About and updates first, then Downloads, Import, Blends, LuvLink,
 * Connect devices and Settings (`navigation/profileMenu`).
 *
 * A panel slides in from the left over a dimmed app (transform and opacity only; a fade under Reduce Motion). Back,
 * a tap outside or picking a row closes it. About and Downloads open as their own sheets once it has closed.
 */
import React, { useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Glass, ListRow, Motion, Signal, Space, Surface, Tactile, Text } from '../../ui';
import { ShellFrost } from '../../constants/allegraTheme';
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
  // 1.44.0 (owner: "opening smooth"): the Modal stays up until the panel has slid all the way out (it used to vanish
  // the moment it was closed), it opens on a critically damped spring like the player sheet, and it follows a finger
  // swiping it shut, settling or closing with the finger's speed.
  const shown = useSharedValue(0);
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      shown.value = reduce ? withTiming(1, { duration: Motion.duration.fast }) : withSpring(1, Motion.spring.open);
    } else {
      shown.value = withTiming(0, { duration: Motion.duration.fast + 60, easing: Motion.ease.accelerate }, finished => {
        if (finished) runOnJS(setMounted)(false);
      });
    }
  }, [open, shown, reduce]);
  const scrim = useAnimatedStyle(() => ({ opacity: SCRIM_OPACITY * shown.value }));
  const panel = useAnimatedStyle(() => ({
    opacity: reduce ? shown.value : 1,
    transform: [{ translateX: reduce ? 0 : (shown.value - 1) * panelWidth }],
  }));
  const close = () => setOpen(false);
  const swipe = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-14, 14])
    .onUpdate(e => {
      shown.value = Math.min(1, Math.max(0, 1 + e.translationX / panelWidth));
    })
    .onEnd(e => {
      const shut = e.velocityX < -Motion.flingVelocity || shown.value < 0.6;
      if (shut) runOnJS(close)();
      else shown.value = withSpring(1, Motion.spring.settle);
    });
  const pick = (action: ProfileAction) => {
    close();
    if (action === 'about') setAbout(true);
    else if (action === 'downloads') setDownloads(true);
    else onAction(action);
  };
  const initial = profileInitial(profile?.displayName);
  const name = profile?.displayName?.trim() || (signedIn ? 'Your account' : 'Not signed in');

  return <>
    <Modal visible={mounted} transparent animationType="none" statusBarTranslucent onRequestClose={close}>
      <GestureHandlerRootView style={StyleSheet.absoluteFill}>
      <Tactile style={StyleSheet.absoluteFill} wrapperStyle={StyleSheet.absoluteFill} pressScale={1} onPress={close} accessible={false} importantForAccessibility="no" accessibilityElementsHidden>
        <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrim]} />
      </Tactile>
      <GestureDetector gesture={swipe}>
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
          <ListRow title={aboutRowTitle(updateWaiting)} subtitle="What's new, updates and feedback" icon="information-circle-outline" iconStyle="plain" chevron onPress={() => pick('about')} />
          {PROFILE_GROUPS.map(group => <View key={group.label}>
            <Text variant="meta" tone="secondary" style={styles.group}>{group.label}</Text>
            {group.items.map(item => (
              <ListRow key={item.id} title={item.title} subtitle={item.subtitle} icon={item.icon} iconStyle="plain" chevron onPress={() => pick(item.id)} />
            ))}
          </View>)}
        </ScrollView>
      </Animated.View>
      </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
    <AboutSheet visible={about} onClose={() => setAbout(false)} />
    <DownloadQueueModal visible={downloads} onClose={() => setDownloads(false)} />
  </>;
};

const styles = StyleSheet.create({
  scrim: { backgroundColor: Surface.scrim },
  // 1.44.0 (owner, Spotify's): true black, no greys; the rows' icons stand alone (ListRow iconStyle="plain").
  panel: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: ShellFrost.menuBlack },
  identity: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingHorizontal: Space.md, paddingBottom: Space.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Glass.hairline, marginBottom: Space.xs },
  picture: { width: PROFILE_PICTURE * 1.5, height: PROFILE_PICTURE * 1.5, borderRadius: PROFILE_PICTURE * 0.75, backgroundColor: Glass.fillLight, alignItems: 'center', justifyContent: 'center' },
  identityText: { flex: 1, minWidth: 0 },
  group: { paddingHorizontal: Space.md, paddingTop: Space.lg, paddingBottom: Space.xs },
});
