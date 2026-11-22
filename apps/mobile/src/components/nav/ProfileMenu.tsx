/**
 * The profile menu (1.42.0): Spotify's side menu, opened from your picture at the top left of Stream, Search and
 * Library. It holds what the You tab did: About and updates first, then stats, Downloads, Import and
 * Settings (`navigation/profileMenu`). Blends, LuvLink and Connect devices are not repeated: Create and the Stream
 * header have them.
 *
 * A panel slides in from the left over a dimmed app (transform and opacity only; a fade under Reduce Motion). Back,
 * a tap outside or picking a row closes it. About and Downloads open as their own sheets once it has closed.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Glass, ListRow, Motion, Signal, Space, Surface, Tactile, Text, isFling, projectMomentum, releaseSpring, rubberBand } from '../../ui';
import { Radius, ShellFrost } from '../../constants/allegraTheme';
import appConfig from '../../../app.json';
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
/** The panel runs this far past the left edge, so a pull past open rubber-bands with no gap behind it. */
const SKIRT = 48;
/** How far a pull past open may stretch (the rubber band's dimension, pt). */
const STRETCH = Motion.stretch.menu;
/** A thrown close counts as finished once it is this close to shut and this slow (in panel widths). */
const CLOSE_REST = { restDisplacementThreshold: 0.002, restSpeedThreshold: 0.02 } as const;

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
  // 2026-11 (same rules as every Sheet): the drag is 1:1 and rubber-bands past open instead of a hard stop; a release
  // is thrown — its rest is projected from the finger's speed, and the spring (closing too) starts at that speed.
  const shown = useSharedValue(0);
  const [mounted, setMounted] = useState(open);
  /** Set when a swipe closed it: its spring already runs at the finger's speed; `open` turning false must not restart it. */
  const swiped = useRef(false);
  const unmount = () => setMounted(false);
  useEffect(() => {
    if (open) {
      swiped.current = false;
      setMounted(true);
      shown.value = reduce ? withTiming(1, { duration: Motion.duration.fast }) : withSpring(1, Motion.spring.open);
    } else if (!swiped.current) {
      shown.value = withTiming(0, { duration: Motion.duration.fast + 60, easing: Motion.ease.accelerate }, finished => {
        if (finished) runOnJS(unmount)();
      });
    }
  }, [open, shown, reduce]);
  const scrim = useAnimatedStyle(() => ({ opacity: SCRIM_OPACITY * Math.min(1, shown.value) }));
  const panel = useAnimatedStyle(() => ({
    opacity: reduce ? Math.min(1, shown.value) : 1,
    transform: [{ translateX: reduce ? 0 : (shown.value - 1) * panelWidth }],
  }));
  const close = () => setOpen(false);
  const closedBySwipe = () => { swiped.current = true; close(); };
  const swipe = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-14, 14])
    .onUpdate(e => {
      'worklet';
      const x = e.translationX;
      // Past open (a pull right) it stretches a little and resists more the further it goes.
      shown.value = x > 0 ? 1 + rubberBand(x, STRETCH) / panelWidth : Math.max(0, 1 + x / panelWidth);
    })
    .onEnd(e => {
      'worklet';
      const projected = shown.value + projectMomentum(e.velocityX) / panelWidth;
      const shut = (isFling(e.velocityX) && e.velocityX < 0) || projected < 0.5;
      const velocity = e.velocityX / panelWidth;
      if (!shut) {
        shown.value = withSpring(1, releaseSpring(velocity, e.velocityX));
        return;
      }
      shown.value = withSpring(0, { ...releaseSpring(velocity, e.velocityX), ...CLOSE_REST }, finished => {
        if (finished) runOnJS(unmount)();
      });
      runOnJS(closedBySwipe)();
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
      <Animated.View style={[styles.panel, { width: panelWidth + SKIRT, paddingTop: insets.top + Space.md }, panel]} accessibilityViewIsModal>
        <View style={styles.identity}>
          <View style={styles.picture}>
            {initial ? <Text variant="title">{initial}</Text> : <Ionicons name="person" size={26} color={Signal.inkSoft} />}
          </View>
          <View style={styles.identityText}>
            <Text variant="title" numberOfLines={1} accessibilityRole="header">{name}</Text>
            {profile?.email ? <Text variant="meta" tone="secondary" numberOfLines={1}>{profile.email}</Text> : null}
          </View>
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: Space.lg }}>
          <View style={styles.about}>
            <ListRow
              title={aboutRowTitle(updateWaiting)}
              subtitle="What's new, updates and feedback"
              icon="information-circle-outline"
              iconStyle="plain"
              trailing={updateWaiting ? <View style={styles.badge}><Text variant="caption" style={styles.badgeText}>Update</Text></View> : undefined}
              chevron
              onPress={() => pick('about')}
            />
          </View>
          {PROFILE_GROUPS.map(group => <View key={group.label}>
            <Text variant="caption" tone="muted" style={styles.group}>{group.label}</Text>
            {group.items.map(item => (
              <ListRow key={item.id} title={item.title} subtitle={item.subtitle} icon={item.icon} iconStyle="plain" chevron onPress={() => pick(item.id)} />
            ))}
          </View>)}
        </ScrollView>
        <Text variant="caption" tone="muted" style={[styles.version, { paddingBottom: insets.bottom + Space.sm }]}>LuvLyrics {appConfig.expo.version}</Text>
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
  // True black like Spotify's side menu, closed off by a hairline on its right edge; no grey tiles behind the icons.
  panel: { position: 'absolute', top: 0, bottom: 0, left: -SKIRT, paddingLeft: SKIRT, backgroundColor: ShellFrost.menuBlack, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: Glass.hairline },
  identity: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingHorizontal: Space.md, paddingBottom: Space.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Glass.hairline, marginBottom: Space.sm },
  picture: { width: PROFILE_PICTURE * 1.75, height: PROFILE_PICTURE * 1.75, borderRadius: PROFILE_PICTURE * 0.875, backgroundColor: Glass.fillLight, alignItems: 'center', justifyContent: 'center' },
  identityText: { flex: 1, minWidth: 0 },
  // The one featured row: About and updates, in an outlined card so a waiting update is the first thing the eye finds.
  about: { marginHorizontal: Space.sm, borderRadius: Radius.sheet, borderWidth: StyleSheet.hairlineWidth, borderColor: Glass.hairlineStrong, overflow: 'hidden' },
  badge: { paddingHorizontal: Space.xs, paddingVertical: Space.xxs, borderRadius: Radius.pill, backgroundColor: Signal.ink },
  badgeText: { color: Signal.waveInk, fontWeight: '700' },
  group: { paddingHorizontal: Space.md, paddingTop: Space.lg, paddingBottom: Space.xs },
  version: { paddingHorizontal: Space.md, paddingTop: Space.xs },
});
